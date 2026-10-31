import { beforeAll, describe, expect, it } from "vitest";
import { as, asCommit, broadcasts, createTestDb, createUser, type Db } from "./harness";

let db: Db;
let host: string;
let guest: string;
let outsider: string;
let roomId: string;
let otherRoomId: string;
const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";

beforeAll(async () => {
  db = await createTestDb();
  host = await createUser(db, "h@duo.test", "Hana");
  guest = await createUser(db, "g@duo.test", "Gabe");
  outsider = await createUser(db, "o@duo.test", "Otto");
  const [r] = await asCommit(db, host, (q) =>
    q<{ room_id: string; invite_code: string }>("select * from public.create_room('Chat')"),
  );
  roomId = r!.room_id;
  await asCommit(db, guest, (q) => q("select * from public.redeem_invite($1)", [r!.invite_code]));
  const [o] = await asCommit(db, outsider, (q) => q<{ room_id: string }>("select * from public.create_room('Mine')"));
  otherRoomId = o!.room_id;
});

const reject = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

describe("realtime authorization (private room channels)", () => {
  it("members can receive on their room topic; outsiders and junk topics get nothing", async () => {
    await db.query("insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'x')", [`room:${roomId}`]);
    const member = await as(db, guest, (q) => q("select 1 from realtime.messages"), { topic: `room:${roomId}` });
    expect(member.length).toBeGreaterThan(0);
    const outsiderRows = await as(db, outsider, (q) => q("select 1 from realtime.messages"), { topic: `room:${roomId}` });
    expect(outsiderRows).toHaveLength(0);
    const junk = await as(db, guest, (q) => q("select 1 from realtime.messages"), { topic: "room:not-a-uuid'; drop table x" });
    expect(junk).toHaveLength(0);
  });

  it("members can send typing/presence on their topic; outsiders cannot", async () => {
    await as(
      db,
      host,
      (q) => q("insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing')", [`room:${roomId}`]),
      { topic: `room:${roomId}` },
    );
    await reject(
      as(
        db,
        outsider,
        (q) =>
          q("insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing')", [`room:${roomId}`]),
        { topic: `room:${roomId}` },
      ),
      /row-level security/,
    );
    // A member can't use their membership to talk on someone else's room topic.
    await reject(
      as(
        db,
        host,
        (q) =>
          q("insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing')", [
            `room:${otherRoomId}`,
          ]),
        { topic: `room:${otherRoomId}` },
      ),
      /row-level security/,
    );
  });

  it("row changes are broadcast only to the room's own topic", async () => {
    await db.query("delete from realtime.test_broadcasts");
    const [m] = await asCommit(db, host, (q) =>
      q<{ id: string }>(
        "insert into public.messages (room_id, client_id, body) values ($1, gen_random_uuid(), 'hey') returning id",
        [roomId],
      ),
    );
    await asCommit(db, guest, (q) => q("insert into public.message_reactions (message_id, emoji) values ($1, '❤️')", [m!.id]));
    await asCommit(db, guest, (q) => q("delete from public.message_reactions where message_id = $1", [m!.id]));
    await asCommit(db, guest, (q) => q("insert into public.message_receipts (room_id, read_seq) values ($1, 1)", [roomId]));
    const sent = await broadcasts(db);
    expect(sent.map((b) => `${b.tbl}:${b.event}`)).toEqual([
      "messages:INSERT",
      "message_reactions:INSERT",
      "message_reactions:DELETE",
      "message_receipts:INSERT",
    ]);
    expect(new Set(sent.map((b) => b.topic))).toEqual(new Set([`room:${roomId}`]));
  });
});

describe("private attachment storage", () => {
  const path = (room: string, name = "photo.png") => `${room}/${uuidA}/${name}`;
  const upload = (user: string, name: string) =>
    as(db, user, (q) => q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [name]));

  it("bucket is private with size + type limits", async () => {
    const [b] = (
      await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'attachments'",
      )
    ).rows;
    expect(b!.public).toBe(false);
    expect(Number(b!.file_size_limit)).toBe(26214400);
    expect(b!.allowed_mime_types).not.toContain("image/svg+xml");
    expect(b!.allowed_mime_types).not.toContain("text/html");
  });

  it("members can upload into their room folder only", async () => {
    await upload(guest, path(roomId));
    await reject(upload(outsider, path(roomId)), /row-level security/);
    await reject(upload(guest, path(otherRoomId)), /row-level security/);
    await reject(upload(guest, `${roomId}/../${otherRoomId}/x.png`), /row-level security/);
    await reject(upload(guest, `${roomId}/x.png`), /row-level security/);
  });

  it("outsiders can't list or read the room's files; only the uploader can delete", async () => {
    await asCommit(db, guest, (q) =>
      q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [path(roomId, "keep.png")]),
    );
    expect(await as(db, outsider, (q) => q("select 1 from storage.objects where name like $1", [`${roomId}/%`]))).toHaveLength(0);
    expect(
      await as(db, host, (q) => q("select 1 from storage.objects where name = $1", [path(roomId, "keep.png")])),
    ).toHaveLength(1);
    const hostDel = await as(db, host, (q) =>
      q("delete from storage.objects where name = $1 returning id", [path(roomId, "keep.png")]),
    );
    expect(hostDel).toHaveLength(0);
  });
});

describe("send_attachment_message", () => {
  const objectPath = () => `${roomId}/${uuidB}/cat.png`;

  beforeAll(async () => {
    await asCommit(db, guest, (q) =>
      q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [objectPath()]),
    );
  });

  const send = (user: string, opts: { path?: string; kind?: string; mime?: string } = {}) =>
    as(db, user, (q) =>
      q<{ id: string; kind: string }>(
        "select * from public.send_attachment_message($1, gen_random_uuid(), $2, 'look', null, $3, $4, 1234, 'cat.png', 640, 480)",
        [roomId, opts.kind ?? "image", opts.path ?? objectPath(), opts.mime ?? "image/png"],
      ),
    );

  it("creates the message and attachment atomically", async () => {
    await as(db, guest, async (q) => {
      const [m] = await q<{ id: string; kind: string }>(
        "select * from public.send_attachment_message($1, gen_random_uuid(), 'image', 'look', null, $2, 'image/png', 1234, 'cat.png', 640, 480)",
        [roomId, objectPath()],
      );
      expect(m!.kind).toBe("image");
      const att = await q("select 1 from public.attachments where message_id = $1", [m!.id]);
      expect(att).toHaveLength(1);
    });
  });

  it("refuses objects that don't exist or belong to someone else", async () => {
    await reject(send(guest, { path: `${roomId}/${uuidA}/missing.png` }), /upload_missing/);
    await reject(send(host), /upload_missing/); // host didn't upload it
  });

  it("refuses outsiders and mismatched kinds", async () => {
    await reject(send(outsider), /upload_missing|row-level security/);
    await reject(send(guest, { mime: "application/pdf" }), /invalid_kind/);
  });

  it("deleting the message removes its attachment rows and Moments", async () => {
    await as(db, guest, async (q) => {
      const [m] = await q<{ id: string }>(
        "select * from public.send_attachment_message($1, gen_random_uuid(), 'image', null, null, $2, 'image/png', 1234, 'cat.png', 640, 480)",
        [roomId, objectPath()],
      );
      await q("insert into public.moments (message_id) values ($1)", [m!.id]);
      await q("update public.messages set deleted_at = now() where id = $1", [m!.id]);
      expect(await q("select 1 from public.attachments where message_id = $1", [m!.id])).toHaveLength(0);
      expect(await q("select 1 from public.moments where message_id = $1", [m!.id])).toHaveLength(0);
    });
  });
});

describe("mark_receipts", () => {
  it("upserts own watermarks, never moves backwards, and outsiders are refused", async () => {
    await as(db, host, async (q) => {
      await q("select public.mark_receipts($1, 5, 3)", [roomId]);
      const [r] = await q<{ delivered_seq: string; read_seq: string }>("select * from public.mark_receipts($1, 2, 1)", [roomId]);
      expect(Number(r!.delivered_seq)).toBe(5);
      expect(Number(r!.read_seq)).toBe(3);
    });
    await reject(
      as(db, outsider, (q) => q("select public.mark_receipts($1, 1, 1)", [roomId])),
      /row-level security/,
    );
  });
});

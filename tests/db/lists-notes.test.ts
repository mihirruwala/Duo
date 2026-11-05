import { beforeAll, describe, expect, it } from "vitest";
import { as, asCommit, broadcasts, createTestDb, createUser, type Db } from "./harness";

let db: Db;
let host: string;
let guest: string;
let outsider: string;
let roomId: string;
let otherRoomId: string;

beforeAll(async () => {
  db = await createTestDb();
  host = await createUser(db, "h@duo.test", "Hana");
  guest = await createUser(db, "g@duo.test", "Gabe");
  outsider = await createUser(db, "o@duo.test", "Otto");
  const [r] = await asCommit(db, host, (q) =>
    q<{ room_id: string; invite_code: string }>("select * from public.create_room('Lists')"),
  );
  roomId = r!.room_id;
  await asCommit(db, guest, (q) => q("select * from public.redeem_invite($1)", [r!.invite_code]));
  const [o] = await asCommit(db, outsider, (q) => q<{ room_id: string }>("select * from public.create_room('Mine')"));
  otherRoomId = o!.room_id;
});

const reject = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

async function makeList(user = host, room = roomId, title = "Movies to watch") {
  const [l] = await asCommit(db, user, (q) =>
    q<{ id: string; created_by: string }>("insert into public.lists (room_id, title, emoji) values ($1, $2, '🎬') returning *", [
      room,
      title,
    ]),
  );
  return l!;
}

describe("shared lists", () => {
  it("both members see and edit the same lists; the creator is stamped by the server", async () => {
    const list = await makeList();
    expect(list.created_by).toBe(host);
    const seen = await as(db, guest, (q) => q("select id from public.lists where id = $1", [list.id]));
    expect(seen).toHaveLength(1);
    const [renamed] = await as(db, guest, (q) =>
      q<{ title: string }>("update public.lists set title = '  Films  ' where id = $1 returning title", [list.id]),
    );
    expect(renamed!.title).toBe("Films");
  });

  it("outsiders can't see, create in, edit or delete a room's lists", async () => {
    const list = await makeList();
    expect(await as(db, outsider, (q) => q("select 1 from public.lists where id = $1", [list.id]))).toHaveLength(0);
    await reject(
      as(db, outsider, (q) => q("insert into public.lists (room_id, title) values ($1, 'x')", [roomId])),
      /row-level security/,
    );
    const updated = await as(db, outsider, (q) =>
      q("update public.lists set title = 'pwned' where id = $1 returning id", [list.id]),
    );
    expect(updated).toHaveLength(0);
    const deleted = await as(db, outsider, (q) => q("delete from public.lists where id = $1 returning id", [list.id]));
    expect(deleted).toHaveLength(0);
    await reject(
      as(db, outsider, (q) => q("insert into public.list_items (list_id, body) values ($1, 'sneaky')", [list.id])),
      /row-level security/,
    );
  });

  it("an item's room comes from its list, never from the client", async () => {
    const list = await makeList();
    // room_id isn't even insertable...
    await reject(
      as(db, outsider, (q) =>
        q("insert into public.list_items (list_id, room_id, body) values ($1, $2, 'x')", [list.id, otherRoomId]),
      ),
      /permission denied/,
    );
    // ...and the trigger fills it in from the list.
    const [item] = await as(db, guest, (q) =>
      q<{ room_id: string; created_by: string }>(
        "insert into public.list_items (list_id, body) values ($1, ' Dune ') returning *",
        [list.id],
      ),
    );
    expect(item!.room_id).toBe(roomId);
    expect(item!.created_by).toBe(guest);
  });

  it("ticking an item off records who did it and when; unticking clears it", async () => {
    const list = await makeList();
    const [item] = await asCommit(db, host, (q) =>
      q<{ id: string }>("insert into public.list_items (list_id, body) values ($1, 'Paris') returning id", [list.id]),
    );
    const [done] = await asCommit(db, guest, (q) =>
      q<{ done: boolean; done_by: string; done_at: string | null }>(
        "update public.list_items set done = true where id = $1 returning *",
        [item!.id],
      ),
    );
    expect(done).toMatchObject({ done: true, done_by: guest });
    expect(done!.done_at).not.toBeNull();
    const [undone] = await asCommit(db, host, (q) =>
      q<{ done_by: string | null; done_at: string | null }>(
        "update public.list_items set done = false where id = $1 returning *",
        [item!.id],
      ),
    );
    expect(undone).toMatchObject({ done_by: null, done_at: null });
    // Server-owned columns can't be written directly.
    await reject(
      as(db, host, (q) => q("update public.list_items set done_by = $2 where id = $1", [item!.id, guest])),
      /permission denied/,
    );
  });

  it("rejects empty and oversized text", async () => {
    const list = await makeList();
    await reject(
      as(db, host, (q) => q("insert into public.list_items (list_id, body) values ($1, '   ')", [list.id])),
      /check/,
    );
    await reject(
      as(db, host, (q) => q("insert into public.list_items (list_id, body) values ($1, $2)", [list.id, "x".repeat(501)])),
      /check/,
    );
    await reject(
      as(db, host, (q) => q("insert into public.lists (room_id, title) values ($1, '')", [roomId])),
      /check/,
    );
  });

  it("deleting a list deletes its items; changes are broadcast to the room's private topic only", async () => {
    const list = await makeList();
    await asCommit(db, host, (q) => q("insert into public.list_items (list_id, body) values ($1, 'a'), ($1, 'b')", [list.id]));
    await db.query("delete from realtime.test_broadcasts");
    await asCommit(db, guest, (q) => q("delete from public.lists where id = $1", [list.id]));
    expect(await as(db, host, (q) => q("select 1 from public.list_items where list_id = $1", [list.id]))).toHaveLength(0);
    const b = await broadcasts(db);
    expect(b.map((x) => x.tbl).sort()).toEqual(["list_items", "list_items", "lists"]);
    expect(new Set(b.map((x) => x.topic))).toEqual(new Set([`room:${roomId}`]));
  });

  it("anon has no access at all", async () => {
    await reject(
      as(db, null, (q) => q("select 1 from public.lists")),
      /permission denied/,
    );
  });
});

describe("voice and video notes", () => {
  const uuid = "33333333-3333-4333-8333-333333333333";
  const path = (name: string) => `${roomId}/${uuid}/${name}`;

  beforeAll(async () => {
    for (const name of ["voice.webm", "clip.webm", "song.webm"]) {
      await asCommit(db, guest, (q) =>
        q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [path(name)]),
      );
    }
  });

  const send = (kind: string, mime: string, name: string, duration: number | null, waveform: number[] | null = null) =>
    as(db, guest, (q) =>
      q<{ id: string; kind: string; meta: Record<string, unknown> }>(
        "select * from public.send_attachment_message($1, gen_random_uuid(), $2, null, null, $3, $4, 2048, $5, null, null, $6, $7::smallint[])",
        [roomId, kind, path(name), mime, name, duration, waveform],
      ),
    );

  it("sends a voice note with its duration and waveform", async () => {
    const [m] = await send("voice", "audio/webm", "voice.webm", 4200, [0, 50, 100]);
    expect(m!.kind).toBe("voice");
    expect(m!.meta).toMatchObject({ duration_ms: 4200, waveform: [0, 50, 100], mime_type: "audio/webm" });
  });

  it("sends a video note", async () => {
    const [m] = await send("video", "video/webm", "clip.webm", 9000);
    expect(m!.kind).toBe("video");
  });

  it("only notes may carry audio or video, and the kind must match the type", async () => {
    await reject(send("file", "audio/webm", "song.webm", null), /invalid_kind/);
    await reject(send("voice", "video/webm", "clip.webm", 1000), /invalid_kind/);
    await reject(send("image", "audio/webm", "song.webm", null), /invalid_kind/);
  });

  it("a note needs a sane duration and waveform; other kinds can't have them", async () => {
    await reject(send("voice", "audio/webm", "voice.webm", null), /invalid_note/);
    await reject(send("voice", "audio/webm", "voice.webm", 10 * 60 * 1000 + 1), /invalid_note/);
    await reject(send("voice", "audio/webm", "voice.webm", 2000, [101]), /invalid_note/);
    await reject(
      send(
        "voice",
        "audio/webm",
        "voice.webm",
        2000,
        Array.from({ length: 65 }, () => 1),
      ),
      /invalid_note/,
    );
  });

  it("the attachments table accepts the note types but still refuses script-capable ones", async () => {
    await reject(
      as(db, guest, (q) =>
        q(
          "insert into public.attachments (room_id, storage_path, mime_type, size_bytes, file_name) values ($1, $2, 'image/svg+xml', 10, 'x.svg')",
          [roomId, path("x.svg")],
        ),
      ),
      /check/,
    );
    const {
      rows: [bucket],
    } = await db.query<{ allowed_mime_types: string[] }>(
      "select allowed_mime_types from storage.buckets where id = 'attachments'",
    );
    expect(bucket!.allowed_mime_types).toEqual(expect.arrayContaining(["audio/webm", "video/mp4"]));
    expect(bucket!.allowed_mime_types).not.toContain("image/svg+xml");
  });
});

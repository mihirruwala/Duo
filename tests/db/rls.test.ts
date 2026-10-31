import { beforeAll, describe, expect, it } from "vitest";
import { as, asCommit, createTestDb, createUser, type Db } from "./harness";

type RoomRow = { room_id: string; slug: string; invite_code: string };

let db: Db;
let host: string;
let guest: string;
let outsider: string;
let room: RoomRow;
let hostMessageId: string;
let guestImageMessageId: string;

beforeAll(async () => {
  db = await createTestDb();
  host = await createUser(db, "host@duo.test", "Hana");
  guest = await createUser(db, "guest@duo.test", "Gabe");
  outsider = await createUser(db, "outsider@duo.test", "Otto");

  room = (await asCommit(db, host, (q) => q<RoomRow>("select * from public.create_room('Movie night')")))[0]!;
  await asCommit(db, guest, (q) => q("select * from public.redeem_invite($1)", [room.invite_code]));

  const [m] = await asCommit(db, host, (q) =>
    q<{ id: string }>(
      "insert into public.messages (room_id, client_id, body) values ($1, gen_random_uuid(), 'hello') returning id",
      [room.room_id],
    ),
  );
  hostMessageId = m!.id;
  const [img] = await asCommit(db, guest, (q) =>
    q<{ id: string }>(
      "insert into public.messages (room_id, client_id, kind, meta) values ($1, gen_random_uuid(), 'image', '{}') returning id",
      [room.room_id],
    ),
  );
  guestImageMessageId = img!.id;
  await asCommit(db, guest, async (q) => {
    await q(
      `insert into public.attachments (room_id, message_id, storage_path, mime_type, size_bytes, file_name)
       values ($1::uuid, $2, $1::text || '/a/photo.png', 'image/png', 1234, 'photo.png')`,
      [room.room_id, guestImageMessageId],
    );
    await q("insert into public.moments (message_id) values ($1)", [guestImageMessageId]);
    await q("insert into public.message_reactions (message_id, emoji) values ($1, '🔥')", [hostMessageId]);
    await q("insert into public.message_receipts (room_id, read_seq) values ($1, 1)", [room.room_id]);
  });
});

async function expectError(p: Promise<unknown>, pattern: RegExp) {
  await expect(p).rejects.toThrow(pattern);
}

describe("room creation and invites", () => {
  it("generates 128-bit base64url slug and invite code", () => {
    expect(room.slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(room.invite_code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(room.slug).not.toEqual(room.invite_code);
  });

  it("allowlist contains exactly host + guest", async () => {
    const rows = await as(db, host, (q) =>
      q<{ user_id: string; role: string }>("select user_id, role from public.room_members where room_id = $1 order by role", [
        room.room_id,
      ]),
    );
    expect(rows).toEqual([
      { user_id: host, role: "host" },
      { user_id: guest, role: "guest" },
    ]);
  });

  it("invite is single-use: a third person is rejected even with the code", async () => {
    await expectError(
      as(db, outsider, (q) => q("select * from public.redeem_invite($1)", [room.invite_code])),
      /invalid_invite/,
    );
  });

  it("host cannot issue a new invite once the room is full", async () => {
    await expectError(
      as(db, host, (q) => q("select * from public.rotate_invite($1)", [room.room_id])),
      /room_full/,
    );
  });

  it("guessed / malformed invite codes fail identically", async () => {
    await expectError(
      as(db, outsider, (q) => q("select * from public.redeem_invite('AAAAAAAAAAAAAAAAAAAAAA')")),
      /invalid_invite/,
    );
    await expectError(
      as(db, outsider, (q) => q("select * from public.redeem_invite('x')")),
      /invalid_invite/,
    );
  });

  it("the member trigger rejects a third member even when RLS is bypassed", async () => {
    await expectError(
      db.query("insert into public.room_members (room_id, user_id, role) values ($1, $2, 'guest')", [room.room_id, outsider]),
      /room_full/,
    );
  });

  it("clients cannot add themselves to the allowlist", async () => {
    await expectError(
      as(db, outsider, (q) =>
        q("insert into public.room_members (room_id, user_id, role) values ($1, $2, 'guest')", [room.room_id, outsider]),
      ),
      /permission denied/,
    );
  });

  it("invite hash is never readable by clients, even the host", async () => {
    await expectError(
      as(db, host, (q) => q("select invite_code_hash from public.rooms")),
      /permission denied/,
    );
  });

  it("anon role cannot call room functions", async () => {
    await expectError(
      as(db, null, (q) => q("select * from public.create_room('x')")),
      /permission denied/,
    );
    await expectError(
      as(db, null, (q) => q("select * from public.redeem_invite($1)", [room.invite_code])),
      /permission denied/,
    );
  });

  it("an unused invite works for a fresh room and rotation invalidates the old code", async () => {
    const [r] = await asCommit(db, outsider, (q) => q<RoomRow>("select * from public.create_room('Solo')"));
    const [rot] = await asCommit(db, outsider, (q) =>
      q<{ invite_code: string }>("select * from public.rotate_invite($1)", [r!.room_id]),
    );
    await expectError(
      as(db, guest, (q) => q("select * from public.redeem_invite($1)", [r!.invite_code])),
      /invalid_invite/,
    );
    const joined = await as(db, guest, (q) => q<{ slug: string }>("select * from public.redeem_invite($1)", [rot!.invite_code]));
    expect(joined[0]!.slug).toEqual(r!.slug);
  });
});

describe("outsider isolation", () => {
  const tables = [
    "rooms",
    "room_members",
    "messages",
    "message_reactions",
    "message_receipts",
    "attachments",
    "moments",
    "control_sessions",
  ] as const;

  for (const table of tables) {
    it(`outsider sees no rows of ${table} for the room`, async () => {
      const col = table === "rooms" ? "id" : "room_id";
      const rows = await as(db, outsider, (q) => q(`select 1 from public.${table} where ${col} = $1`, [room.room_id]));
      expect(rows).toHaveLength(0);
    });
    it(`anon sees no rows of ${table}`, async () => {
      await expectError(
        as(db, null, (q) => q(`select 1 from public.${table}`)),
        /permission denied/,
      );
    });
  }

  it("members can see the room; a guessed slug yields nothing", async () => {
    const mine = await as(db, guest, (q) => q("select id from public.rooms where slug = $1", [room.slug]));
    expect(mine).toHaveLength(1);
    const theirs = await as(db, outsider, (q) => q("select id from public.rooms where slug = $1", [room.slug]));
    expect(theirs).toHaveLength(0);
    const guessed = await as(db, guest, (q) => q("select id from public.rooms where slug = public.gen_token()"));
    expect(guessed).toHaveLength(0);
  });

  it("outsider cannot read members' profiles, but members can read each other", async () => {
    expect(await as(db, outsider, (q) => q("select 1 from public.profiles where id in ($1, $2)", [host, guest]))).toHaveLength(0);
    const seen = await as(db, guest, (q) =>
      q<{ display_name: string }>("select display_name from public.profiles where id = $1", [host]),
    );
    expect(seen).toEqual([{ display_name: "Hana" }]);
  });

  it("outsider cannot post, react, save moments or attach files in the room", async () => {
    await expectError(
      as(db, outsider, (q) =>
        q("insert into public.messages (room_id, client_id, body) values ($1, gen_random_uuid(), 'hi')", [room.room_id]),
      ),
      /row-level security/,
    );
    await expectError(
      as(db, outsider, (q) => q("insert into public.message_reactions (message_id, emoji) values ($1, '👀')", [hostMessageId])),
      /row-level security/,
    );
    await expectError(
      as(db, outsider, (q) => q("insert into public.moments (message_id) values ($1)", [guestImageMessageId])),
      /row-level security/,
    );
    await expectError(
      as(db, outsider, (q) =>
        q(
          `insert into public.attachments (room_id, storage_path, mime_type, size_bytes, file_name)
           values ($1::uuid, $1::text || '/x/evil.png', 'image/png', 1, 'evil.png')`,
          [room.room_id],
        ),
      ),
      /row-level security/,
    );
  });

  it("outsider cannot modify or delete anything in the room", async () => {
    const upd = await as(db, outsider, (q) =>
      q("update public.messages set body = 'pwned' where id = $1 returning id", [hostMessageId]),
    );
    expect(upd).toHaveLength(0);
    const del = await as(db, outsider, (q) => q("delete from public.moments where room_id = $1 returning id", [room.room_id]));
    expect(del).toHaveLength(0);
    const delRoom = await as(db, outsider, (q) => q("delete from public.rooms where id = $1 returning id", [room.room_id]));
    expect(delRoom).toHaveLength(0);
  });

  it("rate-limit table is not accessible to clients", async () => {
    await expectError(
      as(db, host, (q) => q("select * from public.rate_limits")),
      /permission denied/,
    );
    await expectError(
      as(db, host, (q) => q("select public.rate_limit_hit('a','b',1,1)")),
      /permission denied/,
    );
  });
});

describe("messages", () => {
  it("cannot spoof sender_id", async () => {
    await expectError(
      as(db, guest, (q) =>
        q("insert into public.messages (room_id, sender_id, client_id, body) values ($1, $2, gen_random_uuid(), 'x')", [
          room.room_id,
          host,
        ]),
      ),
      /permission denied/,
    );
  });

  it("member cannot edit another member's message", async () => {
    const rows = await as(db, guest, (q) =>
      q("update public.messages set body = 'nope' where id = $1 returning id", [hostMessageId]),
    );
    expect(rows).toHaveLength(0);
  });

  it("editing own message stamps edited_at; protected columns cannot be changed", async () => {
    const [row] = await as(db, host, (q) =>
      q<{ body: string; edited_at: string | null }>(
        "update public.messages set body = 'hello!!' where id = $1 returning body, edited_at",
        [hostMessageId],
      ),
    );
    expect(row!.body).toBe("hello!!");
    expect(row!.edited_at).not.toBeNull();
    await expectError(
      as(db, host, (q) => q("update public.messages set room_id = gen_random_uuid() where id = $1", [hostMessageId])),
      /permission denied/,
    );
  });

  it("deleting leaves a content-free tombstone that cannot be revived", async () => {
    await as(db, host, async (q) => {
      const [row] = await q<{ body: string | null; deleted_at: string | null }>(
        "update public.messages set deleted_at = now() where id = $1 returning body, deleted_at",
        [hostMessageId],
      );
      expect(row!.body).toBeNull();
      expect(row!.deleted_at).not.toBeNull();
      await expect(q("update public.messages set body = 'back' where id = $1", [hostMessageId])).rejects.toThrow(
        /message_deleted/,
      );
    });
  });

  it("replies must point at a message in the same room", async () => {
    const [other] = await asCommit(db, outsider, (q) => q<RoomRow>("select * from public.create_room('Other')"));
    const [foreign] = await asCommit(db, outsider, (q) =>
      q<{ id: string }>(
        "insert into public.messages (room_id, client_id, body) values ($1, gen_random_uuid(), 'x') returning id",
        [other!.room_id],
      ),
    );
    await expectError(
      as(db, host, (q) =>
        q("insert into public.messages (room_id, client_id, body, reply_to) values ($1, gen_random_uuid(), 'x', $2)", [
          room.room_id,
          foreign!.id,
        ]),
      ),
      /invalid_reply/,
    );
  });

  it("GIF messages must reference GIPHY media", async () => {
    await expectError(
      as(db, host, (q) =>
        q(
          `insert into public.messages (room_id, client_id, kind, meta)
           values ($1, gen_random_uuid(), 'gif', '{"giphy_id":"1","url":"https://evil.example/x.gif"}')`,
          [room.room_id],
        ),
      ),
      /invalid_gif/,
    );
  });

  it("client_id makes sends idempotent", async () => {
    await as(db, host, async (q) => {
      const cid = "00000000-0000-4000-8000-000000000001";
      await q("insert into public.messages (room_id, client_id, body) values ($1, $2, 'once')", [room.room_id, cid]);
      await expect(
        q("insert into public.messages (room_id, client_id, body) values ($1, $2, 'twice')", [room.room_id, cid]),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  it("message sending is rate limited", async () => {
    await as(db, guest, async (q) => {
      let error: unknown;
      for (let i = 0; i < 70 && !error; i++) {
        try {
          await q("insert into public.messages (room_id, client_id, body) values ($1, gen_random_uuid(), 'spam')", [
            room.room_id,
          ]);
        } catch (e) {
          error = e;
        }
      }
      expect(String(error)).toMatch(/rate_limited/);
    });
  });

  it("reaction room_id is derived from the message, not the client", async () => {
    const [r] = await as(db, host, (q) =>
      q<{ room_id: string }>(
        "insert into public.message_reactions (message_id, emoji, room_id) values ($1, '😂', gen_random_uuid()) returning room_id",
        [guestImageMessageId],
      ),
    );
    expect(r!.room_id).toBe(room.room_id);
  });

  it("receipts only move forward", async () => {
    const [r] = await as(db, guest, (q) =>
      q<{ read_seq: string; delivered_seq: string }>(
        "update public.message_receipts set read_seq = 0, delivered_seq = 0 where room_id = $1 returning read_seq, delivered_seq",
        [room.room_id],
      ),
    );
    expect(Number(r!.read_seq)).toBe(1);
    expect(Number(r!.delivered_seq)).toBe(1);
  });

  it("only image/gif/sticker messages can become Moments", async () => {
    const [t] = await asCommit(db, host, (q) =>
      q<{ id: string }>(
        "insert into public.messages (room_id, client_id, body) values ($1, gen_random_uuid(), 'txt') returning id",
        [room.room_id],
      ),
    );
    await expectError(
      as(db, host, (q) => q("insert into public.moments (message_id) values ($1)", [t!.id])),
      /not_a_moment/,
    );
  });
});

describe("remote-control audit log", () => {
  it("full approve → revoke lifecycle with role checks", async () => {
    await as(db, guest, async (q) => {
      const [s] = await q<{ id: string; owner_id: string; status: string }>("select * from public.control_request($1)", [
        room.room_id,
      ]);
      expect(s!.owner_id).toBe(host);
      expect(s!.status).toBe("requested");
      // Controller cannot approve their own request.
      await expect(q("select * from public.control_transition($1, 'approved')", [s!.id])).rejects.toThrow(/invalid_transition/);
    });
  });

  it("owner approves, gets an expiry, then revokes; outsiders can't touch it", async () => {
    const [s] = await asCommit(db, guest, (q) => q<{ id: string }>("select * from public.control_request($1)", [room.room_id]));
    await expectError(
      as(db, outsider, (q) => q("select * from public.control_transition($1, 'revoked')", [s!.id])),
      /session_not_found/,
    );
    const [a] = await asCommit(db, host, (q) =>
      q<{ status: string; expires_at: string }>("select * from public.control_transition($1, 'approved')", [s!.id]),
    );
    expect(a!.status).toBe("approved");
    expect(new Date(a!.expires_at).getTime()).toBeGreaterThan(Date.now());
    const [r] = await asCommit(db, host, (q) =>
      q<{ status: string; end_reason: string }>("select * from public.control_transition($1, 'revoked', 'emergency_stop')", [
        s!.id,
      ]),
    );
    expect(r).toMatchObject({ status: "revoked", end_reason: "emergency_stop" });
    await expectError(
      as(db, host, (q) => q("select * from public.control_transition($1, 'approved')", [s!.id])),
      /invalid_transition/,
    );
  });

  it("clients cannot write the audit log directly", async () => {
    await expectError(
      as(db, guest, (q) =>
        q("insert into public.control_sessions (room_id, owner_id, controller_id, status) values ($1, $2, $3, 'approved')", [
          room.room_id,
          host,
          guest,
        ]),
      ),
      /permission denied/,
    );
  });
});

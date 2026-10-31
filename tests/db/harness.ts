import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Minimal emulation of what Supabase provides before our migrations run:
 * the anon/authenticated/service_role roles, auth.users, auth.uid(), and the
 * permissive default privileges Supabase grants on the public schema.
 * Emulating those defaults matters: it proves our migrations actually revoke them.
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(
      coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      ), ''
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Realtime (subset): authorization table + topic() + a recording stand-in for broadcast_changes.
  create schema realtime;
  create table realtime.messages (
    id bigserial primary key,
    topic text not null,
    extension text not null,
    payload jsonb,
    event text,
    private boolean default true
  );
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$
    select nullif(current_setting('realtime.topic', true), '')
  $$;
  create table realtime.test_broadcasts (id bigserial primary key, topic text, event text, tbl text, new_row jsonb, old_row jsonb);
  create function realtime.broadcast_changes(
    topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record
  ) returns void language plpgsql as $$
  begin
    insert into realtime.test_broadcasts (topic, event, tbl, new_row, old_row)
    values (topic_name, event_name, table_name, to_jsonb(new), to_jsonb(old));
  end;
  $$;
  grant usage on schema realtime to anon, authenticated, service_role;
  grant select, insert on realtime.messages to authenticated;
  grant usage on sequence realtime.messages_id_seq to authenticated;
  grant execute on function realtime.topic() to anon, authenticated;

  -- Storage (subset).
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner_id text default (auth.uid())::text,
    created_at timestamptz default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, delete on storage.objects to authenticated;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

export type Db = PGlite;

/** Rows our triggers handed to realtime.broadcast_changes (test stand-in), newest last. */
export async function broadcasts(db: Db) {
  return (
    await db.query<{ topic: string; event: string; tbl: string }>(
      "select topic, event, tbl from realtime.test_broadcasts order by id",
    )
  ).rows;
}

export async function createTestDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

export async function createUser(db: Db, email: string, displayName?: string): Promise<string> {
  const res = await db.query<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
    email,
    JSON.stringify(displayName ? { display_name: displayName } : {}),
  ]);
  return res.rows[0]!.id;
}

type Role = "authenticated" | "anon";

/**
 * Run `fn` inside a transaction as the given user, exactly like PostgREST does:
 * SET LOCAL ROLE + request.jwt.claims. The transaction is always rolled back
 * unless `commit` is set, so tests stay independent.
 */
export async function as<T>(
  db: Db,
  userId: string | null,
  fn: (q: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
  opts: { commit?: boolean; role?: Role; topic?: string } = {},
): Promise<T> {
  const role: Role = opts.role ?? (userId ? "authenticated" : "anon");
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('role', $1, true)`, [role]);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [userId ? JSON.stringify({ sub: userId, role }) : ""]);
    await tx.query(`select set_config('realtime.topic', $1, true)`, [opts.topic ?? ""]);
    const q = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => (await tx.query<R>(sql, params)).rows;
    const result = await fn(q);
    if (!opts.commit) await tx.rollback();
    return result;
  });
}

/** Convenience for the common "do it and keep it" case. */
export function asCommit<T>(db: Db, userId: string | null, fn: Parameters<typeof as<T>>[2]): Promise<T> {
  return as(db, userId, fn, { commit: true });
}

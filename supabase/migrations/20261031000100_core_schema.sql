-- DUO core schema: profiles, rooms, allowlist, chat, moments, control audit log, rate limits.
-- Every table has RLS enabled. Clients get explicit column-level privileges only;
-- anything sensitive (invite secrets, rate-limit counters) is reachable only through
-- SECURITY DEFINER functions with fixed search_path.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- 128-bit unguessable token, base64url (22 chars). Uses only core Postgres:
-- gen_random_uuid() is backed by a CSPRNG; two of them give 244 random bits,
-- which we compress through SHA-256 and truncate to 128 bits.
create or replace function public.gen_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(
    rtrim(
      encode(
        substring(
          sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8'))
          from 1 for 16
        ),
        'base64'
      ),
      '='
    ),
    '+/', '-_'
  );
$$;

create or replace function public.hash_token(token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(token, 'UTF8'));
$$;

create type public.member_role as enum ('host', 'guest');
create type public.message_kind as enum ('text', 'image', 'gif', 'sticker', 'file');
create type public.control_status as enum ('requested', 'approved', 'denied', 'revoked', 'expired', 'ended');

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window). Not reachable by clients directly.
-- ---------------------------------------------------------------------------

create table public.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  primary key (bucket, subject)
);
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;

-- Returns true when the call is allowed, false when the limit is exceeded.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as rl (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, now(), 1)
  on conflict (bucket, subject) do update
    set hits = case
                 when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1
                 else rl.hits + 1
               end,
        window_start = case
                 when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
                 else rl.window_start
               end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;

-- Raise a uniform, machine-readable error when a per-user limit is exceeded.
create or replace function public.enforce_user_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.rate_limit_hit(p_bucket, coalesce(auth.uid()::text, 'anon'), p_max, p_window_seconds) then
    raise exception 'rate_limited' using errcode = 'D0429', hint = p_bucket;
  end if;
end;
$$;
revoke all on function public.enforce_user_rate_limit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_hue smallint not null default floor(random() * 360)::smallint check (avatar_hue between 0 and 359),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := split_part(coalesce(new.email, 'friend'), '@', 1);
  end if;
  insert into public.profiles (id, display_name)
  values (new.id, left(v_name, 40));
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Rooms + allowlist
-- ---------------------------------------------------------------------------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default public.gen_token() check (slug ~ '^[A-Za-z0-9_-]{22}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  host_id uuid not null references public.profiles (id) on delete cascade,
  invite_code_hash bytea unique,
  invite_expires_at timestamptz,
  has_open_invite boolean generated always as (invite_code_hash is not null) stored,
  control_max_seconds integer not null default 900 check (control_max_seconds between 60 and 3600),
  created_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
create index rooms_host_id_idx on public.rooms (host_id);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_members enable row level security;
create index room_members_user_id_idx on public.room_members (user_id);
create unique index room_members_one_host_idx on public.room_members (room_id) where role = 'host';

-- Strict two-person allowlist, enforced even under concurrent inserts (row lock on the room).
create or replace function public.enforce_room_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.rooms where id = new.room_id for update;
  select count(*) into v_count from public.room_members where room_id = new.room_id;
  if v_count >= 2 then
    raise exception 'room_full' using errcode = 'D0409';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_room_member_limit() from public, anon, authenticated;

create trigger room_members_limit
  before insert on public.room_members
  for each row execute function public.enforce_room_member_limit();

-- SECURITY DEFINER so policies on room_members don't recurse.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;
revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated, service_role;

create or replace function public.shares_room_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  );
$$;
revoke all on function public.shares_room_with(uuid) from public, anon;
grant execute on function public.shares_room_with(uuid) to authenticated, service_role;

-- Create a room. Returns the plaintext invite code exactly once; only its hash is stored.
create or replace function public.create_room(p_name text)
returns table (room_id uuid, slug text, invite_code text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := public.gen_token();
  v_room public.rooms;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'D0401';
  end if;
  perform public.enforce_user_rate_limit('room.create', 10, 3600);

  insert into public.rooms (name, host_id, invite_code_hash, invite_expires_at)
  values (btrim(p_name), v_uid, public.hash_token(v_code), now() + interval '7 days')
  returning * into v_room;

  insert into public.room_members (room_id, user_id, role)
  values (v_room.id, v_uid, 'host');

  return query select v_room.id, v_room.slug, v_code, v_room.invite_expires_at;
end;
$$;
revoke all on function public.create_room(text) from public, anon;
grant execute on function public.create_room(text) to authenticated;

-- Host issues a fresh invite code (invalidating the old one) while the room is not full.
create or replace function public.rotate_invite(p_room_id uuid)
returns table (invite_code text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := public.gen_token();
  v_expires timestamptz := now() + interval '7 days';
  v_members integer;
begin
  perform public.enforce_user_rate_limit('invite.rotate', 20, 3600);
  perform 1 from public.rooms r where r.id = p_room_id and r.host_id = v_uid for update;
  if not found then
    raise exception 'room_not_found' using errcode = 'D0404';
  end if;
  select count(*) into v_members from public.room_members m where m.room_id = p_room_id;
  if v_members >= 2 then
    raise exception 'room_full' using errcode = 'D0409';
  end if;
  update public.rooms r
     set invite_code_hash = public.hash_token(v_code), invite_expires_at = v_expires
   where r.id = p_room_id;
  return query select v_code, v_expires;
end;
$$;
revoke all on function public.rotate_invite(uuid) from public, anon;
grant execute on function public.rotate_invite(uuid) to authenticated;

-- Redeem an invite. Single use: the code is destroyed when the guest joins.
-- Unknown, expired and consumed codes all produce the same error.
create or replace function public.redeem_invite(p_code text)
returns table (room_id uuid, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'D0401';
  end if;
  perform public.enforce_user_rate_limit('invite.redeem', 20, 3600);

  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_invite' using errcode = 'D0404';
  end if;

  select * into v_room
    from public.rooms r
   where r.invite_code_hash = public.hash_token(p_code)
     and r.invite_expires_at > now()
   for update;
  if not found then
    raise exception 'invalid_invite' using errcode = 'D0404';
  end if;

  if exists (select 1 from public.room_members m where m.room_id = v_room.id and m.user_id = v_uid) then
    return query select v_room.id, v_room.slug;
    return;
  end if;

  -- The member-limit trigger raises room_full if a guest already exists.
  insert into public.room_members (room_id, user_id, role) values (v_room.id, v_uid, 'guest');
  update public.rooms r set invite_code_hash = null, invite_expires_at = null where r.id = v_room.id;

  return query select v_room.id, v_room.slug;
end;
$$;
revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  room_id uuid not null references public.rooms (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  client_id uuid not null,
  kind public.message_kind not null default 'text',
  body text check (body is null or char_length(body) <= 4000),
  reply_to uuid references public.messages (id) on delete set null,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 4096),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (sender_id, client_id),
  constraint text_has_body check (kind <> 'text' or deleted_at is not null or char_length(btrim(coalesce(body, ''))) > 0)
);
alter table public.messages enable row level security;
create index messages_room_seq_idx on public.messages (room_id, seq desc);
create index messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;

create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('msg.send', 60, 60);
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  if new.reply_to is not null and not exists (
    select 1 from public.messages m where m.id = new.reply_to and m.room_id = new.room_id
  ) then
    raise exception 'invalid_reply' using errcode = 'D0422';
  end if;
  if new.kind = 'gif' and not (
       new.meta ? 'giphy_id'
       and (new.meta ->> 'url') ~ '^https://media[0-9]*\.giphy\.com/'
     ) then
    raise exception 'invalid_gif' using errcode = 'D0422';
  end if;
  if new.kind = 'sticker' and coalesce(new.meta ->> 'sticker_id', '') !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'invalid_sticker' using errcode = 'D0422';
  end if;
  return new;
end;
$$;
revoke all on function public.messages_before_insert() from public, anon, authenticated;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- Edits and deletes. Clients may only touch body / deleted_at (column grants below);
-- this trigger stamps edited_at and turns a delete into a content-free tombstone.
create or replace function public.messages_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'message_deleted' using errcode = 'D0409';
  end if;
  if new.deleted_at is not null then
    new.deleted_at := now();
    new.body := null;
    new.meta := '{}'::jsonb;
    return new;
  end if;
  if new.body is distinct from old.body then
    if old.kind <> 'text' then
      raise exception 'not_editable' using errcode = 'D0422';
    end if;
    new.edited_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.messages_before_update() from public, anon, authenticated;

create trigger messages_before_update
  before update on public.messages
  for each row execute function public.messages_before_update();

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;
create index message_reactions_room_idx on public.message_reactions (room_id);

create or replace function public.reactions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
begin
  perform public.enforce_user_rate_limit('msg.react', 120, 60);
  select m.room_id into v_room from public.messages m where m.id = new.message_id and m.deleted_at is null;
  if v_room is null then
    raise exception 'message_not_found' using errcode = 'D0404';
  end if;
  -- room_id is always derived from the message, never trusted from the client.
  new.room_id := v_room;
  new.created_at := now();
  if (select count(*) from public.message_reactions r where r.message_id = new.message_id and r.user_id = new.user_id) >= 12 then
    raise exception 'too_many_reactions' using errcode = 'D0422';
  end if;
  return new;
end;
$$;
revoke all on function public.reactions_before_insert() from public, anon, authenticated;

create trigger reactions_before_insert
  before insert on public.message_reactions
  for each row execute function public.reactions_before_insert();

create table public.message_receipts (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  delivered_seq bigint not null default 0,
  read_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.message_receipts enable row level security;

-- Watermarks only move forward; read implies delivered.
create or replace function public.receipts_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.delivered_seq := greatest(old.delivered_seq, new.delivered_seq);
    new.read_seq := greatest(old.read_seq, new.read_seq);
  end if;
  new.delivered_seq := greatest(new.delivered_seq, new.read_seq);
  new.updated_at := now();
  return new;
end;
$$;

create trigger receipts_normalize
  before insert or update on public.message_receipts
  for each row execute function public.receipts_normalize();

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  uploader_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in (
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  file_name text not null check (char_length(file_name) between 1 and 200 and file_name !~ '[/\\]'),
  width integer check (width is null or width between 1 and 20000),
  height integer check (height is null or height between 1 and 20000),
  created_at timestamptz not null default now(),
  constraint attachment_path_in_room check (storage_path like room_id::text || '/%')
);
alter table public.attachments enable row level security;
create index attachments_room_idx on public.attachments (room_id, created_at desc);
create index attachments_message_idx on public.attachments (message_id);

create table public.moments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  saved_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, message_id)
);
alter table public.moments enable row level security;

create or replace function public.moments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  select * into v_msg from public.messages m where m.id = new.message_id and m.deleted_at is null;
  if not found or v_msg.kind not in ('image', 'gif', 'sticker') then
    raise exception 'not_a_moment' using errcode = 'D0422';
  end if;
  new.room_id := v_msg.room_id;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.moments_before_insert() from public, anon, authenticated;

create trigger moments_before_insert
  before insert on public.moments
  for each row execute function public.moments_before_insert();

-- ---------------------------------------------------------------------------
-- Remote-control audit log. Transitions only via functions.
-- ---------------------------------------------------------------------------

create table public.control_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  controller_id uuid not null references public.profiles (id) on delete cascade,
  status public.control_status not null default 'requested',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  end_reason text check (end_reason is null or char_length(end_reason) <= 64),
  check (owner_id <> controller_id)
);
alter table public.control_sessions enable row level security;
create index control_sessions_room_idx on public.control_sessions (room_id, requested_at desc);
create unique index control_sessions_one_live_idx on public.control_sessions (room_id)
  where status in ('requested', 'approved');

-- Controller asks the other member for control. Any stale live session is closed first.
create or replace function public.control_request(p_room_id uuid)
returns public.control_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_row public.control_sessions;
begin
  perform public.enforce_user_rate_limit('control.request', 20, 600);
  if not public.is_room_member(p_room_id) then
    raise exception 'room_not_found' using errcode = 'D0404';
  end if;
  select m.user_id into v_owner from public.room_members m where m.room_id = p_room_id and m.user_id <> v_uid;
  if v_owner is null then
    raise exception 'no_peer' using errcode = 'D0409';
  end if;
  update public.control_sessions c
     set status = 'ended', ended_at = now(), end_reason = 'superseded'
   where c.room_id = p_room_id and c.status in ('requested', 'approved');
  insert into public.control_sessions (room_id, owner_id, controller_id)
  values (p_room_id, v_owner, v_uid)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.control_request(uuid) from public, anon;
grant execute on function public.control_request(uuid) to authenticated;

-- State machine:
--   requested --owner--> approved | denied
--   approved  --owner--> revoked
--   approved  --either-> ended | expired
--   requested --controller--> ended (cancelled)
create or replace function public.control_transition(p_session_id uuid, p_status public.control_status, p_reason text default null)
returns public.control_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.control_sessions;
  v_max integer;
begin
  select * into v_row from public.control_sessions c where c.id = p_session_id for update;
  if not found or v_uid not in (v_row.owner_id, v_row.controller_id) then
    raise exception 'session_not_found' using errcode = 'D0404';
  end if;

  if v_row.status = 'requested' and p_status in ('approved', 'denied') and v_uid = v_row.owner_id then
    select r.control_max_seconds into v_max from public.rooms r where r.id = v_row.room_id;
    update public.control_sessions c
       set status = p_status, decided_at = now(),
           expires_at = case when p_status = 'approved' then now() + make_interval(secs => v_max) end,
           ended_at = case when p_status = 'denied' then now() end
     where c.id = p_session_id returning * into v_row;
  elsif v_row.status = 'requested' and p_status = 'ended' and v_uid = v_row.controller_id then
    update public.control_sessions c
       set status = 'ended', ended_at = now(), end_reason = left(coalesce(p_reason, 'cancelled'), 64)
     where c.id = p_session_id returning * into v_row;
  elsif v_row.status = 'approved' and p_status = 'revoked' and v_uid = v_row.owner_id then
    update public.control_sessions c
       set status = 'revoked', ended_at = now(), end_reason = left(coalesce(p_reason, 'owner_revoked'), 64)
     where c.id = p_session_id returning * into v_row;
  elsif v_row.status = 'approved' and p_status in ('ended', 'expired') then
    update public.control_sessions c
       set status = p_status, ended_at = now(), end_reason = left(coalesce(p_reason, p_status::text), 64)
     where c.id = p_session_id returning * into v_row;
  else
    raise exception 'invalid_transition' using errcode = 'D0409';
  end if;
  return v_row;
end;
$$;
revoke all on function public.control_transition(uuid, public.control_status, text) from public, anon;
grant execute on function public.control_transition(uuid, public.control_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges (Supabase grants ALL to anon/authenticated by default; reset that)
-- ---------------------------------------------------------------------------

revoke all on table
  public.profiles, public.rooms, public.room_members, public.messages,
  public.message_reactions, public.message_receipts, public.attachments,
  public.moments, public.control_sessions
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_hue) on public.profiles to authenticated;

grant select (id, slug, name, host_id, invite_expires_at, has_open_invite, control_max_seconds, created_at)
  on public.rooms to authenticated;
grant update (name, control_max_seconds) on public.rooms to authenticated;
grant delete on public.rooms to authenticated;

grant select, delete on public.room_members to authenticated;

grant select on public.messages to authenticated;
grant insert (id, room_id, client_id, kind, body, reply_to, meta) on public.messages to authenticated;
grant update (body, deleted_at) on public.messages to authenticated;

grant select, delete on public.message_reactions to authenticated;
grant insert (message_id, emoji, room_id) on public.message_reactions to authenticated;

grant select on public.message_receipts to authenticated;
grant insert (room_id, delivered_seq, read_seq) on public.message_receipts to authenticated;
grant update (delivered_seq, read_seq) on public.message_receipts to authenticated;

grant select, delete on public.attachments to authenticated;
grant insert (id, room_id, message_id, storage_path, mime_type, size_bytes, file_name, width, height)
  on public.attachments to authenticated;
grant update (message_id) on public.attachments to authenticated;

grant select, delete on public.moments to authenticated;
grant insert (message_id, room_id) on public.moments to authenticated;

grant select on public.control_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_room_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy rooms_select on public.rooms for select to authenticated
  using (public.is_room_member(id));
create policy rooms_update on public.rooms for update to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy rooms_delete on public.rooms for delete to authenticated
  using (host_id = (select auth.uid()));

create policy room_members_select on public.room_members for select to authenticated
  using (public.is_room_member(room_id));
-- A guest may leave (removing themselves from the allowlist). Hosts delete the room instead.
create policy room_members_leave on public.room_members for delete to authenticated
  using (user_id = (select auth.uid()) and role = 'guest');

create policy messages_select on public.messages for select to authenticated
  using (public.is_room_member(room_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.is_room_member(room_id));
create policy messages_update on public.messages for update to authenticated
  using (sender_id = (select auth.uid()) and public.is_room_member(room_id))
  with check (sender_id = (select auth.uid()));

create policy reactions_select on public.message_reactions for select to authenticated
  using (public.is_room_member(room_id));
create policy reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));
create policy reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy receipts_select on public.message_receipts for select to authenticated
  using (public.is_room_member(room_id));
create policy receipts_insert on public.message_receipts for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));
create policy receipts_update on public.message_receipts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy attachments_select on public.attachments for select to authenticated
  using (public.is_room_member(room_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (uploader_id = (select auth.uid()) and public.is_room_member(room_id));
create policy attachments_update on public.attachments for update to authenticated
  using (uploader_id = (select auth.uid())) with check (uploader_id = (select auth.uid()));
create policy attachments_delete on public.attachments for delete to authenticated
  using (uploader_id = (select auth.uid()));

create policy moments_select on public.moments for select to authenticated
  using (public.is_room_member(room_id));
create policy moments_insert on public.moments for insert to authenticated
  with check (saved_by = (select auth.uid()) and public.is_room_member(room_id));
create policy moments_delete on public.moments for delete to authenticated
  using (public.is_room_member(room_id));

create policy control_sessions_select on public.control_sessions for select to authenticated
  using (public.is_room_member(room_id));

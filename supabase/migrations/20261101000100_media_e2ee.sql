-- End-to-end media encryption (LiveKit E2EE): a per-room 256-bit key that only the two members can
-- read (RLS + column grant). The SFU (LiveKit) never sees it, so it relays only ciphertext.
-- Honest scope: this database holds the key, so E2EE protects against the media server, not
-- against DUO's own backend. The key rotates whenever the allowlist changes.

create or replace function public.gen_media_key()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'base64');
$$;

alter table public.rooms
  add column media_key text not null default public.gen_media_key(),
  add column e2ee_enabled boolean not null default true;

grant select (media_key, e2ee_enabled) on public.rooms to authenticated;
grant update (e2ee_enabled) on public.rooms to authenticated;

-- Rotate on every membership change: a former guest can't decrypt future calls.
create or replace function public.rotate_media_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms r set media_key = public.gen_media_key() where r.id = coalesce(new.room_id, old.room_id);
  return null;
end;
$$;
revoke all on function public.rotate_media_key() from public, anon, authenticated;

create trigger room_members_rotate_media_key
  after insert or delete on public.room_members
  for each row execute function public.rotate_media_key();

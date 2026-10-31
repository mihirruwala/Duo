-- M3: chat realtime (broadcast from database to private room channels), private file storage,
-- and an atomic "send message with attachment" function.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Parse "room:<uuid>" safely (never raises on junk topics).
create or replace function public.room_id_from_topic(p_topic text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return substring(p_topic from 6)::uuid;
  end if;
  return null;
end;
$$;

-- First path segment of a storage object name, as a room id (null when malformed).
create or replace function public.room_id_from_path(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first text := split_part(p_name, '/', 1);
begin
  if v_first ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast row changes to the private channel "room:<room_id>".
-- Postgres-changes subscriptions can't apply RLS to DELETE events; broadcasting to an
-- authorized private topic means only room members ever receive anything.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_room_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := coalesce(new.room_id, old.room_id);
begin
  perform realtime.broadcast_changes(
    'room:' || v_room::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;
revoke all on function public.broadcast_room_change() from public, anon, authenticated;

create trigger messages_broadcast after insert or update or delete on public.messages
  for each row execute function public.broadcast_room_change();
create trigger reactions_broadcast after insert or delete on public.message_reactions
  for each row execute function public.broadcast_room_change();
create trigger receipts_broadcast after insert or update on public.message_receipts
  for each row execute function public.broadcast_room_change();
create trigger attachments_broadcast after insert or update or delete on public.attachments
  for each row execute function public.broadcast_room_change();
create trigger moments_broadcast after insert or delete on public.moments
  for each row execute function public.broadcast_room_change();
create trigger control_sessions_broadcast after insert or update on public.control_sessions
  for each row execute function public.broadcast_room_change();

-- Realtime Authorization: only room members may join (receive) or send (typing/presence)
-- on "room:<id>". Every other topic is denied.
create policy duo_room_members_receive on realtime.messages for select to authenticated
  using (public.is_room_member(public.room_id_from_topic((select realtime.topic()))));

create policy duo_room_members_send on realtime.messages for insert to authenticated
  with check (
    public.is_room_member(public.room_id_from_topic((select realtime.topic())))
    and realtime.messages.extension in ('broadcast', 'presence')
  );

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects live at "<room_id>/<uuid>/<file name>".
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  26214400,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy duo_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_room_member(public.room_id_from_path(name)));

create policy duo_attachments_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_room_member(public.room_id_from_path(name))
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]{1,200}$'
  );

create policy duo_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = (select auth.uid())::text and public.is_room_member(public.room_id_from_path(name)));

-- ---------------------------------------------------------------------------
-- Atomic image/file message: message + attachment row in one transaction.
-- SECURITY INVOKER: the caller's RLS policies apply to both inserts.
-- ---------------------------------------------------------------------------

create or replace function public.send_attachment_message(
  p_room_id uuid,
  p_client_id uuid,
  p_kind public.message_kind,
  p_body text,
  p_reply_to uuid,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes integer,
  p_file_name text,
  p_width integer,
  p_height integer
)
returns public.messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  if p_kind not in ('image', 'file') then
    raise exception 'invalid_kind' using errcode = 'D0422';
  end if;
  if p_kind = 'image' and p_mime_type not like 'image/%' then
    raise exception 'invalid_kind' using errcode = 'D0422';
  end if;
  -- The object must already exist in this room's folder (uploaded by this user).
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'attachments' and o.name = p_storage_path and o.owner_id = (select auth.uid())::text
  ) then
    raise exception 'upload_missing' using errcode = 'D0422';
  end if;

  insert into public.messages (room_id, client_id, kind, body, reply_to, meta)
  values (
    p_room_id, p_client_id, p_kind, nullif(btrim(coalesce(p_body, '')), ''), p_reply_to,
    jsonb_build_object('file_name', p_file_name, 'mime_type', p_mime_type, 'size_bytes', p_size_bytes,
                       'width', p_width, 'height', p_height)
  )
  returning * into v_msg;

  insert into public.attachments (room_id, message_id, storage_path, mime_type, size_bytes, file_name, width, height)
  values (p_room_id, v_msg.id, p_storage_path, p_mime_type, p_size_bytes, p_file_name, p_width, p_height);

  return v_msg;
end;
$$;
revoke all on function public.send_attachment_message(uuid, uuid, public.message_kind, text, uuid, text, text, integer, text, integer, integer) from public, anon;
grant execute on function public.send_attachment_message(uuid, uuid, public.message_kind, text, uuid, text, text, integer, text, integer, integer) to authenticated;

-- Deleting a message removes its attachment rows (the trigger can't see storage, so the
-- client deletes the object; orphaned objects stay private to the room either way).
create or replace function public.messages_tombstone_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.attachments a where a.message_id = new.id;
    delete from public.moments m where m.message_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function public.messages_tombstone_attachments() from public, anon, authenticated;

create trigger messages_tombstone_attachments after update of deleted_at on public.messages
  for each row execute function public.messages_tombstone_attachments();

create index if not exists messages_room_kind_idx on public.messages (room_id, kind, seq desc) where deleted_at is null;

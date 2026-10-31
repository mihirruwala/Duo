-- M3: receipt watermarks via RPC (upsert without touching non-updatable columns), and
-- attachment messages keep the client-generated id so optimistic UI can reconcile exactly.

create or replace function public.mark_receipts(p_room_id uuid, p_delivered_seq bigint, p_read_seq bigint)
returns public.message_receipts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.message_receipts;
begin
  insert into public.message_receipts as r (room_id, delivered_seq, read_seq)
  values (p_room_id, greatest(coalesce(p_delivered_seq, 0), 0), greatest(coalesce(p_read_seq, 0), 0))
  on conflict (room_id, user_id) do update
    set delivered_seq = excluded.delivered_seq, read_seq = excluded.read_seq
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.mark_receipts(uuid, bigint, bigint) from public, anon;
grant execute on function public.mark_receipts(uuid, bigint, bigint) to authenticated;

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
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'attachments' and o.name = p_storage_path and o.owner_id = (select auth.uid())::text
  ) then
    raise exception 'upload_missing' using errcode = 'D0422';
  end if;

  insert into public.messages (id, room_id, client_id, kind, body, reply_to, meta)
  values (
    p_client_id, p_room_id, p_client_id, p_kind, nullif(btrim(coalesce(p_body, '')), ''), p_reply_to,
    jsonb_build_object('file_name', p_file_name, 'mime_type', p_mime_type, 'size_bytes', p_size_bytes,
                       'width', p_width, 'height', p_height)
  )
  returning * into v_msg;

  insert into public.attachments (room_id, message_id, storage_path, mime_type, size_bytes, file_name, width, height)
  values (p_room_id, v_msg.id, p_storage_path, p_mime_type, p_size_bytes, p_file_name, p_width, p_height);

  return v_msg;
end;
$$;

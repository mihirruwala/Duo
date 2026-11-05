-- Voice and video notes: recorded in the browser, stored in the private attachments bucket like any
-- other file, sent atomically with their message. Only these two kinds may carry audio/video.

-- Allowed types (bucket + attachments row). Still no SVG/HTML.
update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/webm', 'audio/mp4', 'audio/ogg', 'video/webm', 'video/mp4'
]
where id = 'attachments';

alter table public.attachments drop constraint if exists attachments_mime_type_check;
alter table public.attachments add constraint attachments_mime_type_check check (mime_type in (
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/webm', 'audio/mp4', 'audio/ogg', 'video/webm', 'video/mp4'
));

-- The same atomic send, now also for notes. A note carries its length (MediaRecorder files often
-- don't know their own duration) and, for voice, a small waveform to draw.
drop function if exists public.send_attachment_message(uuid, uuid, public.message_kind, text, uuid, text, text, integer, text, integer, integer);

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
  p_height integer,
  p_duration_ms integer default null,
  p_waveform smallint[] default null
)
returns public.messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_msg public.messages;
  v_meta jsonb;
begin
  if p_kind not in ('image', 'file', 'voice', 'video') then
    raise exception 'invalid_kind' using errcode = 'D0422';
  end if;
  if (p_kind = 'image' and p_mime_type not like 'image/%')
     or (p_kind = 'voice' and p_mime_type not like 'audio/%')
     or (p_kind = 'video' and p_mime_type not like 'video/%')
     or (p_kind = 'file' and (p_mime_type like 'audio/%' or p_mime_type like 'video/%')) then
    raise exception 'invalid_kind' using errcode = 'D0422';
  end if;
  if p_kind in ('voice', 'video') then
    if p_duration_ms is null or p_duration_ms < 300 or p_duration_ms > 600000 then
      raise exception 'invalid_note' using errcode = 'D0422';
    end if;
  elsif p_duration_ms is not null or p_waveform is not null then
    raise exception 'invalid_note' using errcode = 'D0422';
  end if;
  if p_waveform is not null and (
       cardinality(p_waveform) > 64
       or exists (select 1 from unnest(p_waveform) w where w is null or w < 0 or w > 100)
     ) then
    raise exception 'invalid_note' using errcode = 'D0422';
  end if;
  -- The object must already exist in this room's folder (uploaded by this user).
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'attachments' and o.name = p_storage_path and o.owner_id = (select auth.uid())::text
  ) then
    raise exception 'upload_missing' using errcode = 'D0422';
  end if;

  v_meta := jsonb_build_object('file_name', p_file_name, 'mime_type', p_mime_type, 'size_bytes', p_size_bytes,
                               'width', p_width, 'height', p_height);
  if p_duration_ms is not null then
    v_meta := v_meta || jsonb_build_object('duration_ms', p_duration_ms);
  end if;
  if p_waveform is not null then
    v_meta := v_meta || jsonb_build_object('waveform', to_jsonb(p_waveform));
  end if;

  -- Keeps the client-generated id, so the optimistic message reconciles exactly.
  insert into public.messages (id, room_id, client_id, kind, body, reply_to, meta)
  values (p_client_id, p_room_id, p_client_id, p_kind, nullif(btrim(coalesce(p_body, '')), ''), p_reply_to, v_meta)
  returning * into v_msg;

  insert into public.attachments (room_id, message_id, storage_path, mime_type, size_bytes, file_name, width, height)
  values (p_room_id, v_msg.id, p_storage_path, p_mime_type, p_size_bytes, p_file_name, p_width, p_height);

  return v_msg;
end;
$$;
revoke all on function public.send_attachment_message(uuid, uuid, public.message_kind, text, uuid, text, text, integer, text, integer, integer, integer, smallint[]) from public, anon;
grant execute on function public.send_attachment_message(uuid, uuid, public.message_kind, text, uuid, text, text, integer, text, integer, integer, integer, smallint[]) to authenticated;

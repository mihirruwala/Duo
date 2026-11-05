-- Voice and video notes in chat. Enum values are added in their own migration: Postgres can't use
-- a new enum value in the same transaction that adds it.
alter type public.message_kind add value if not exists 'voice';
alter type public.message_kind add value if not exists 'video';

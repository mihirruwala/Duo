-- Shared lists: movies to watch, places to go, a shopping list... Both people in a room can add,
-- tick off, edit and delete. Changes reach the other person live on the room's private channel.

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  emoji text not null default '📝' check (char_length(emoji) between 1 and 16),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lists enable row level security;
create index lists_room_idx on public.lists (room_id, created_at);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  done boolean not null default false,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.list_items enable row level security;
create index list_items_list_idx on public.list_items (list_id, created_at);
create index list_items_room_idx on public.list_items (room_id);

-- Server-owned columns are stamped here, whatever the client sent.
create or replace function public.lists_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('list.write', 240, 60);
  if tg_op = 'INSERT' then
    if (select count(*) from public.lists l where l.room_id = new.room_id) >= 50 then
      raise exception 'too_many_lists' using errcode = 'D0422';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.lists_before_write() from public, anon, authenticated;
create trigger lists_before_write before insert or update on public.lists
  for each row execute function public.lists_before_write();

create or replace function public.list_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('list.write', 240, 60);
  if tg_op = 'INSERT' then
    -- room_id always comes from the list (never trusted from the client); RLS then checks membership.
    select l.room_id into new.room_id from public.lists l where l.id = new.list_id;
    if new.room_id is null then
      raise exception 'list_not_found' using errcode = 'D0404';
    end if;
    if (select count(*) from public.list_items i where i.list_id = new.list_id) >= 500 then
      raise exception 'list_full' using errcode = 'D0422';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.done_by := case when new.done then auth.uid() end;
    new.done_at := case when new.done then now() end;
  elsif new.done is distinct from old.done then
    new.done_by := case when new.done then auth.uid() end;
    new.done_at := case when new.done then now() end;
  end if;
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.list_items_before_write() from public, anon, authenticated;
create trigger list_items_before_write before insert or update on public.list_items
  for each row execute function public.list_items_before_write();

create trigger lists_broadcast after insert or update or delete on public.lists
  for each row execute function public.broadcast_room_change();
create trigger list_items_broadcast after insert or update or delete on public.list_items
  for each row execute function public.broadcast_room_change();

-- Privileges: reset Supabase's defaults, then grant only what the app needs.
revoke all on table public.lists, public.list_items from anon, authenticated;
grant select, delete on public.lists to authenticated;
grant insert (id, room_id, title, emoji) on public.lists to authenticated;
grant update (title, emoji) on public.lists to authenticated;
grant select, delete on public.list_items to authenticated;
grant insert (id, list_id, body, done) on public.list_items to authenticated;
grant update (body, done) on public.list_items to authenticated;

-- Both members share everything in their room's lists.
create policy lists_select on public.lists for select to authenticated
  using (public.is_room_member(room_id));
create policy lists_insert on public.lists for insert to authenticated
  with check (public.is_room_member(room_id));
create policy lists_update on public.lists for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
create policy lists_delete on public.lists for delete to authenticated
  using (public.is_room_member(room_id));

create policy list_items_select on public.list_items for select to authenticated
  using (public.is_room_member(room_id));
create policy list_items_insert on public.list_items for insert to authenticated
  with check (public.is_room_member(room_id));
create policy list_items_update on public.list_items for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
create policy list_items_delete on public.list_items for delete to authenticated
  using (public.is_room_member(room_id));

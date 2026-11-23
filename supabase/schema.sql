-- NC State Ag Scholarships · shared scholarship list
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
--
-- Anyone can READ scholarships. Only signed-in users whose email is in
-- scholarship_editors can INSERT / UPDATE / DELETE. The anon key shipped in the
-- static site can't bypass this — it's enforced by Postgres row-level security.

create table if not exists public.scholarships (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.scholarship_editors (
  email     text primary key,
  added_at  timestamptz not null default now()
);

alter table public.scholarships        enable row level security;
alter table public.scholarship_editors enable row level security;

create or replace function public.is_scholarship_editor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.scholarship_editors e
    where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "scholarships are public" on public.scholarships;
create policy "scholarships are public"
  on public.scholarships for select
  using (true);

drop policy if exists "editors insert" on public.scholarships;
create policy "editors insert"
  on public.scholarships for insert to authenticated
  with check (public.is_scholarship_editor());

drop policy if exists "editors update" on public.scholarships;
create policy "editors update"
  on public.scholarships for update to authenticated
  using (public.is_scholarship_editor())
  with check (public.is_scholarship_editor());

drop policy if exists "editors delete" on public.scholarships;
create policy "editors delete"
  on public.scholarships for delete to authenticated
  using (public.is_scholarship_editor());

-- Signed-in users may only see whether THEY are an editor (used to show the edit buttons).
drop policy if exists "see own editor row" on public.scholarship_editors;
create policy "see own editor row"
  on public.scholarship_editors for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Editors can manage the editor list from the SQL editor / table editor only
-- (no policy for insert/delete = not possible through the public API).

-- Live updates for other open dashboards.
do $$
begin
  alter publication supabase_realtime add table public.scholarships;
exception when duplicate_object then null;
end $$;

-- Add the people who should have edit access:
-- insert into public.scholarship_editors (email) values
--   ('advisor@ncsu.edu'),
--   ('student.lead@ncsu.edu');

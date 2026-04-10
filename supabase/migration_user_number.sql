-- Run once in Supabase SQL Editor if you already created study_sessions / study_trials
-- without user_number (older schema.sql). Skip on greenfield installs that used the new schema.sql.

-- 1) study_sessions: add and backfill user_number
alter table public.study_sessions
  add column if not exists user_number integer;

update public.study_sessions s
set user_number = sub.rn
from (
  select id, row_number() over (order by created_at nulls last, id) as rn
  from public.study_sessions
  where user_number is null
) sub
where s.id = sub.id;

alter table public.study_sessions
  alter column user_number set not null;

create sequence if not exists public.study_sessions_user_number_seq;
-- setval(..., 0) is invalid; empty table must use setval(seq, 1, false) so first nextval() is 1.
do $$
declare
  mx integer;
begin
  select coalesce(max(user_number), 0) into mx from public.study_sessions;
  if mx = 0 then
    perform setval('public.study_sessions_user_number_seq', 1, false);
  else
    perform setval('public.study_sessions_user_number_seq', mx, true);
  end if;
end $$;

alter table public.study_sessions
  alter column user_number set default nextval('public.study_sessions_user_number_seq');

alter sequence public.study_sessions_user_number_seq owned by public.study_sessions.user_number;

alter table public.study_sessions
  drop constraint if exists study_sessions_user_number_key;
alter table public.study_sessions
  add constraint study_sessions_user_number_key unique (user_number);

alter table public.study_sessions
  drop constraint if exists study_sessions_id_user_number_key;
alter table public.study_sessions
  add constraint study_sessions_id_user_number_key unique (id, user_number);

-- 2) study_trials: drop old FK on session_id, add user_number, composite FK
alter table public.study_trials
  drop constraint if exists study_trials_session_id_fkey;

alter table public.study_trials
  add column if not exists user_number integer;

update public.study_trials t
set user_number = s.user_number
from public.study_sessions s
where t.session_id = s.id and t.user_number is null;

alter table public.study_trials
  alter column user_number set not null;

alter table public.study_trials
  drop constraint if exists study_trials_session_user_fk;
alter table public.study_trials
  add constraint study_trials_session_user_fk foreign key (session_id, user_number)
    references public.study_sessions (id, user_number) on delete cascade;

-- Needed for client insert().select("user_number") under RLS.
drop policy if exists "study_sessions_anon_select" on public.study_sessions;
create policy "study_sessions_anon_select"
  on public.study_sessions for select
  to anon
  using (true);

grant select on table public.study_sessions to anon;

-- Refresh PostgREST so new columns (e.g. study_trials.user_number) are accepted on insert.
notify pgrst, 'reload schema';

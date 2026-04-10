-- Run in Supabase SQL Editor once. Then enable if tables already exist skip duplicates.

create table if not exists public.study_sessions (
  id uuid primary key,
  participant_key text,
  created_at timestamptz not null default now(),
  user_agent text,
  completed_at timestamptz
);

create table if not exists public.study_trials (
  id bigserial primary key,
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  trial_index int not null,
  condition_id text not null,
  encoding text not null,
  viewing_condition text not null,
  task_type text not null,
  is_correct boolean not null,
  reaction_time_ms int not null,
  perceived_difficulty int,
  correct_answer text not null,
  selected_answer text not null,
  stimulus_seed text,
  unique (session_id, trial_index)
);

alter table public.study_sessions enable row level security;
alter table public.study_trials enable row level security;

drop policy if exists "study_sessions_anon_insert" on public.study_sessions;
create policy "study_sessions_anon_insert"
  on public.study_sessions for insert
  to anon
  with check (true);

drop policy if exists "study_trials_anon_insert" on public.study_trials;
create policy "study_trials_anon_insert"
  on public.study_trials for insert
  to anon
  with check (true);

drop policy if exists "study_sessions_anon_update" on public.study_sessions;
create policy "study_sessions_anon_update"
  on public.study_sessions for update
  to anon
  using (true)
  with check (true);

grant usage on schema public to anon;
grant insert on table public.study_sessions to anon;
grant insert on table public.study_trials to anon;
grant update on table public.study_sessions to anon;

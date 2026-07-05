-- DALIguro SmartScan — phone→PC realtime pairing + result sync.
-- Two tables: a short-lived pairing session (PC creates, phone claims) and the
-- synced checked results. Row-level security scopes everything to the signed-in
-- teacher (Supabase Auth / magic-link => auth.uid() == teacher_user_id), so a
-- teacher only ever sees their own sessions and results, on any device.
--
-- Apply with: supabase db push  (or paste into the SQL editor).

-- ---- pairing sessions --------------------------------------
create table if not exists public.smartscan_sessions (
  id                 uuid primary key default gen_random_uuid(),
  teacher_user_id    uuid not null references auth.users(id) on delete cascade,
  school_id          uuid,
  assessment_id      text not null,
  -- SHA-256 hash of the pairing token; the raw token lives only in the QR/URL.
  session_token_hash text not null,
  status             text not null default 'active'
                       check (status in ('active','paired','expired','ended')),
  paired_device_name text,
  paired_at          timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  -- Unpaired sessions expire after 15 minutes (enforced in app + a cleanup job).
  expires_at         timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists smartscan_sessions_teacher_idx
  on public.smartscan_sessions (teacher_user_id, assessment_id);

alter table public.smartscan_sessions enable row level security;

create policy "sessions: owner read"   on public.smartscan_sessions
  for select using (auth.uid() = teacher_user_id);
create policy "sessions: owner insert" on public.smartscan_sessions
  for insert with check (auth.uid() = teacher_user_id);
create policy "sessions: owner update" on public.smartscan_sessions
  for update using (auth.uid() = teacher_user_id);
create policy "sessions: owner delete" on public.smartscan_sessions
  for delete using (auth.uid() = teacher_user_id);

-- ---- checked results ---------------------------------------
create table if not exists public.smartscan_checked_results (
  id                  uuid primary key default gen_random_uuid(),
  assessment_id       text not null,
  teacher_user_id     uuid not null references auth.users(id) on delete cascade,
  school_id           uuid,
  learner_id          text not null,
  learner_name        text,
  section_id          text,
  section_name        text,
  subject_id          text,
  subject_name        text,
  score               numeric not null default 0,
  total_items         integer not null default 0,
  percentage          numeric not null default 0,
  answer_map          jsonb not null default '{}'::jsonb,
  item_results        jsonb not null default '[]'::jsonb,
  qr_payload          jsonb,
  scan_session_id     uuid references public.smartscan_sessions(id) on delete set null,
  scan_source         text default 'phone_camera',
  scan_confidence     numeric,
  low_confidence_items jsonb default '[]'::jsonb,
  corrected_by_teacher boolean default false,
  checked_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- One final checked result per learner+assessment per teacher; rescans upsert.
  unique (assessment_id, learner_id, teacher_user_id)
);

create index if not exists smartscan_results_lookup_idx
  on public.smartscan_checked_results (teacher_user_id, assessment_id);

alter table public.smartscan_checked_results enable row level security;

create policy "results: owner read"   on public.smartscan_checked_results
  for select using (auth.uid() = teacher_user_id);
create policy "results: owner insert" on public.smartscan_checked_results
  for insert with check (auth.uid() = teacher_user_id);
create policy "results: owner update" on public.smartscan_checked_results
  for update using (auth.uid() = teacher_user_id);
create policy "results: owner delete" on public.smartscan_checked_results
  for delete using (auth.uid() = teacher_user_id);

-- keep updated_at fresh on every change
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists smartscan_results_touch on public.smartscan_checked_results;
create trigger smartscan_results_touch
  before update on public.smartscan_checked_results
  for each row execute function public.touch_updated_at();

-- ---- realtime ----------------------------------------------
-- PC dashboard subscribes to these; RLS still applies to realtime payloads.
alter publication supabase_realtime add table public.smartscan_sessions;
alter publication supabase_realtime add table public.smartscan_checked_results;

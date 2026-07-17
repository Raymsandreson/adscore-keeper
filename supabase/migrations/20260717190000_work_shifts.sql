-- Expediente (ponto): entrada/saída por membro. O cronômetro só conta
-- (atividade, ocioso, pausas, alertas) com expediente aberto.

create table if not exists public.work_shifts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,          -- ext uid do membro
  user_name  text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ws_user_day
  on public.work_shifts(user_id, started_at desc);

alter table public.work_shifts enable row level security;

create policy "ws_select" on public.work_shifts
  for select using (auth.uid() is not null);
create policy "ws_insert" on public.work_shifts
  for insert with check (auth.uid() is not null);
create policy "ws_update" on public.work_shifts
  for update using (auth.uid() is not null);

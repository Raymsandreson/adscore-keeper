-- Alertas do cronômetro: gerente/diretor pergunta ao membro por que está ocioso.
-- O cliente do membro escuta via realtime e toca alerta sonoro + dialog.

create table if not exists public.activity_timer_alerts (
  id          uuid primary key default gen_random_uuid(),
  to_user_id  uuid not null,          -- ext uid do membro alertado
  from_user_id uuid,                  -- ext uid de quem mandou
  from_name   text,
  message     text,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz
);

create index if not exists idx_ata_to_user
  on public.activity_timer_alerts(to_user_id, created_at desc);

alter table public.activity_timer_alerts enable row level security;

create policy "ata_select" on public.activity_timer_alerts
  for select using (auth.uid() is not null);
create policy "ata_insert" on public.activity_timer_alerts
  for insert with check (auth.uid() is not null);
create policy "ata_update" on public.activity_timer_alerts
  for update using (auth.uid() is not null);

-- Realtime para o listener do cliente
alter publication supabase_realtime add table public.activity_timer_alerts;

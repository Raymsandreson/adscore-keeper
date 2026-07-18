-- Banco de horas / cronômetro de atividades
-- Cada linha = uma SESSÃO de trabalho numa atividade (trilha de auditoria).
-- O "banco de horas" por membro/tipo é um GROUP BY sobre esta tabela.
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).

create table if not exists public.activity_time_entries (
  id             uuid primary key default gen_random_uuid(),
  activity_id    uuid,
  activity_type  text,
  activity_title text,
  lead_name      text,
  user_id        uuid not null,          -- ext uid (quem trabalhou)
  user_name      text,                   -- snapshot do nome do membro
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  active_seconds integer not null default 0,   -- tempo com interação real
  idle_seconds   integer not null default 0,   -- tempo ocioso / aguardando confirmação
  status         text not null default 'running'
                 check (status in ('running','paused','closed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.activity_time_entries is
  'Sessões de cronômetro por atividade (banco de horas por membro e tipo).';

create index if not exists idx_ate_activity
  on public.activity_time_entries(activity_id);
create index if not exists idx_ate_user_type_started
  on public.activity_time_entries(user_id, activity_type, started_at);
create index if not exists idx_ate_running
  on public.activity_time_entries(user_id) where status = 'running';

alter table public.activity_time_entries enable row level security;

-- Espelha o padrão de lead_activities no Externo: authenticated full.
create policy "ate_select" on public.activity_time_entries
  for select using (auth.uid() is not null);
create policy "ate_insert" on public.activity_time_entries
  for insert with check (auth.uid() is not null);
create policy "ate_update" on public.activity_time_entries
  for update using (auth.uid() is not null);
create policy "ate_delete" on public.activity_time_entries
  for delete using (auth.uid() is not null);

-- updated_at automático
create or replace function public.set_ate_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ate_updated_at on public.activity_time_entries;
create trigger trg_ate_updated_at
  before update on public.activity_time_entries
  for each row execute function public.set_ate_updated_at();

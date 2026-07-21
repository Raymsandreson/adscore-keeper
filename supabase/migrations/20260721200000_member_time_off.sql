-- Previsão de ausências da equipe (férias, compensação de horas, folga).
-- Aplicada no Supabase EXTERNO (kmedldlepwiityjsdahz) — tabelas de negócio moram lá.
-- user_id é o Cloud UUID (mesmo id usado nos seletores de assessor do app);
-- o bloqueio de atividades roda ANTES do remap Cloud→Externo.

create table if not exists public.member_time_off (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_name text,
  type text not null check (type in ('ferias', 'compensacao', 'folga')),
  start_date date not null,
  end_date date not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint member_time_off_period check (end_date >= start_date)
);

create index if not exists idx_member_time_off_user_period
  on public.member_time_off (user_id, start_date, end_date);

alter table public.member_time_off enable row level security;

-- Sessão do app no Externo é anônima (signInAnonymously) — política aberta a
-- authenticated, não auth.uid() = user_id.
drop policy if exists member_time_off_all on public.member_time_off;
create policy member_time_off_all on public.member_time_off
  for all to authenticated using (true) with check (true);

-- Uso do sistema por ÁREA (3ª categoria do cronômetro).
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz) — é onde mora
-- activity_time_entries / o banco de horas.
--
-- PROBLEMA: sem atividade aberta, TODO segundo virava ocioso
-- (ActivityTimerContext.tsx, ramo kind === 'gap': next.idleSeconds += deltaSec).
-- Quem estava consultando lead, conferindo processo, navegando no financeiro ou
-- lendo conversa do WhatsApp aparecia igual a quem estava parado. A contagem
-- ficava injusta com o membro e sem valor gerencial.
--
-- SOLUÇÃO: tabela SEPARADA, uma linha por (membro, dia, área). Enquanto não há
-- atividade aberta E há interação real (clique/scroll/tecla nos últimos 5 min,
-- tela desbloqueada, PC não suspenso), o segundo vai para cá em vez de virar
-- ocioso. Sem interação, continua caindo em idle_seconds como sempre.
--
-- Por que tabela nova e não coluna em activity_time_entries: nenhum consumidor
-- existente (refreshDayBase, TeamTimersPanel, BancoHorasPage, RPCs tv_*,
-- performance-coach do Railway) muda de valor. "Uso do sistema" NÃO é tempo
-- produtivo — não entra em active_seconds e não pontua no ranking do telão.
--
-- Rollback (<1min): drop table public.system_usage_entries;
--   (tabela isolada, nenhuma referência de FK; o cliente volta a somar em idle)

create table if not exists public.system_usage_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,                 -- ext uid (mesmo de activity_time_entries)
  user_name      text,                          -- snapshot do nome
  work_date      date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  area_key       text not null,                 -- src/lib/systemAreas.ts
  area_label     text,
  active_seconds integer not null default 0,    -- tempo INTERAGINDO nesta área, sem atv aberta
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, work_date, area_key)
);

comment on table public.system_usage_entries is
  'Uso do sistema por área e por dia, sem atividade vinculada. Não é tempo produtivo: complementa activity_time_entries para que "sem atividade" deixe de ser sinônimo de ocioso.';
comment on column public.system_usage_entries.area_key is
  'Chave da área do menu (systemAreas.ts): whatsapp, leads, processual, financeiro, marketing, contatos, equipe, pop, ...';

create index if not exists idx_sue_user_work_date
  on public.system_usage_entries(user_id, work_date);
create index if not exists idx_sue_work_date_area
  on public.system_usage_entries(work_date, area_key);

alter table public.system_usage_entries enable row level security;

-- Mesmo padrão de activity_time_entries no Externo: a sessão do cliente é
-- anônima (signInAnonymously), então a policy é por authenticated, não por
-- auth.uid() = user_id (isso devolveria 0 linhas em silêncio).
drop policy if exists "sue_select" on public.system_usage_entries;
create policy "sue_select" on public.system_usage_entries
  for select using (auth.uid() is not null);
drop policy if exists "sue_insert" on public.system_usage_entries;
create policy "sue_insert" on public.system_usage_entries
  for insert with check (auth.uid() is not null);
drop policy if exists "sue_update" on public.system_usage_entries;
create policy "sue_update" on public.system_usage_entries
  for update using (auth.uid() is not null);

create or replace function public.set_sue_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sue_updated_at on public.system_usage_entries;
create trigger trg_sue_updated_at
  before update on public.system_usage_entries
  for each row execute function public.set_sue_updated_at();

-- =============================================================================
-- Metas processuais por TIME
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz (onde vivem lead_processes,
-- teams, team_members, lead_checklist_instances e process_movements).
--
-- Uma meta = time + período + (marco processual alvo, qtd de processos) e/ou
-- (% médio de fluxo do POP concluído). O "realizado" sai da RPC
-- team_process_goals_progress.
--
-- Atribuição de processo → time (nesta ordem):
--   1) responsável processual do lead (leads.processual_responsible_id) que
--      esteja em team_members;
--   2) fallback: POP do processo (lead_processes.workflow_id) mapeado em
--      team_workflow_boards.
--
-- Rollback:
--   drop function if exists public.team_process_goals_progress(uuid, date, date);
--   drop table if exists public.team_workflow_boards;
--   drop table if exists public.team_process_goals;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Mapa POP → time (fallback de atribuição)
-- Unique em board_id: um POP pertence a no máximo UM time, senão o mesmo
-- processo entraria na conta de dois times.
-- -----------------------------------------------------------------------------
create table if not exists public.team_workflow_boards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_team_workflow_boards_board
  on public.team_workflow_boards (board_id);

create index if not exists idx_team_workflow_boards_team
  on public.team_workflow_boards (team_id);

-- -----------------------------------------------------------------------------
-- Metas por time
-- team_id SEM foreign key de propósito: sync_teams_snapshot faz
-- "delete from teams where id not in (...)" e um cascade apagaria metas
-- silenciosamente se o snapshot vier parcial. team_name é o retrato do nome
-- no momento do cadastro (fallback de exibição).
-- -----------------------------------------------------------------------------
create table if not exists public.team_process_goals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  team_name text,
  name text,

  period_type text not null default 'monthly'
    check (period_type in ('monthly', 'quarterly', 'custom')),
  period_start date not null,
  period_end date not null,

  -- null = qualquer marco conta
  marco_tipo text check (marco_tipo in (
    'peticao_inicial', 'audiencia_conciliacao', 'pericia', 'audiencia_instrucao',
    'sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior',
    'transito_julgado', 'pagamento'
  )),
  target_processes integer check (target_processes >= 0),
  target_flow_avg_pct numeric(5,2)
    check (target_flow_avg_pct >= 0 and target_flow_avg_pct <= 100),

  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint team_process_goals_periodo_valido
    check (period_end >= period_start),
  constraint team_process_goals_tem_alvo
    check (target_processes is not null or target_flow_avg_pct is not null)
);

-- Evita duas metas ativas para o mesmo time/período/marco.
create unique index if not exists uq_team_process_goals_ativa
  on public.team_process_goals (team_id, period_start, period_end, coalesce(marco_tipo, '*'))
  where is_active;

create index if not exists idx_team_process_goals_team_periodo
  on public.team_process_goals (team_id, period_start, period_end)
  where is_active;

create or replace function public.team_process_goals_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_team_process_goals_touch on public.team_process_goals;
create trigger trg_team_process_goals_touch
  before update on public.team_process_goals
  for each row execute function public.team_process_goals_touch();

-- -----------------------------------------------------------------------------
-- RLS — sessão do Externo é anônima promovida a authenticated (mesmo padrão das
-- demais tabelas escritas pelo cliente).
-- -----------------------------------------------------------------------------
alter table public.team_process_goals enable row level security;
alter table public.team_workflow_boards enable row level security;

drop policy if exists "authenticated manage team process goals" on public.team_process_goals;
create policy "authenticated manage team process goals"
  on public.team_process_goals for all to authenticated
  using (true) with check (true);

drop policy if exists "authenticated manage team workflow boards" on public.team_workflow_boards;
create policy "authenticated manage team workflow boards"
  on public.team_workflow_boards for all to authenticated
  using (true) with check (true);

-- -----------------------------------------------------------------------------
-- Apuração
--
-- realizado_processos  = processos DISTINTOS do time que registraram o marco
--                        alvo dentro do período (process_movements).
-- fluxo_medio_pct      = média simples, por processo, do % de itens de checklist
--                        do POP marcados. É FOTO DO AGORA: lead_checklist_instances
--                        não guarda data por item, então não há como recortar o
--                        percentual pelo período.
-- -----------------------------------------------------------------------------
create or replace function public.team_process_goals_progress(
  p_team_id uuid default null,
  p_period_start date default null,
  p_period_end date default null
)
returns table (
  goal_id uuid,
  team_id uuid,
  team_name text,
  name text,
  period_type text,
  period_start date,
  period_end date,
  marco_tipo text,
  target_processes integer,
  target_flow_avg_pct numeric,
  realizado_processos integer,
  fluxo_medio_pct numeric,
  processos_no_time integer,
  processos_com_fluxo integer,
  processos_com_marco integer
)
language sql
stable
security definer
set search_path = public
as $$
  with proc as (
    select
      lp.id,
      lp.lead_id,
      lp.workflow_id,
      coalesce(tm.team_id, twb.team_id) as team_id
    from lead_processes lp
    join leads l on l.id = lp.lead_id
    left join team_members tm on tm.user_id = l.processual_responsible_id
    left join team_workflow_boards twb on twb.board_id::text = lp.workflow_id
    where lp.deleted_at is null
  ),
  proc_time as (
    select * from proc where team_id is not null
  ),
  flow as (
    select
      p.id,
      p.team_id,
      count(*) filter (where coalesce((it.value->>'checked')::boolean, false))::numeric
        / nullif(count(*), 0) * 100 as pct
    from proc_time p
    join lead_checklist_instances i
      on i.lead_id = p.lead_id
     and i.board_id::text = p.workflow_id
    cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) it(value)
    group by p.id, p.team_id
  )
  select
    g.id,
    g.team_id,
    coalesce(t.name, g.team_name) as team_name,
    g.name,
    g.period_type,
    g.period_start,
    g.period_end,
    g.marco_tipo,
    g.target_processes,
    g.target_flow_avg_pct,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join proc_time p on p.id = pm.process_id
      where p.team_id = g.team_id
        and pm.data_movimentacao::date between g.period_start and g.period_end
        and (g.marco_tipo is null or pm.tipo_movimentacao = g.marco_tipo)
    ) as realizado_processos,
    (
      select round(avg(f.pct), 1)
      from flow f
      where f.team_id = g.team_id
    ) as fluxo_medio_pct,
    (
      select count(*)::integer from proc_time p where p.team_id = g.team_id
    ) as processos_no_time,
    (
      select count(*)::integer from flow f where f.team_id = g.team_id
    ) as processos_com_fluxo,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join proc_time p on p.id = pm.process_id
      where p.team_id = g.team_id
    ) as processos_com_marco
  from team_process_goals g
  left join teams t on t.id = g.team_id
  where g.is_active
    and (p_team_id is null or g.team_id = p_team_id)
    and (p_period_start is null or g.period_end >= p_period_start)
    and (p_period_end is null or g.period_start <= p_period_end)
  order by g.period_start desc, coalesce(t.name, g.team_name);
$$;

grant execute on function public.team_process_goals_progress(uuid, date, date) to authenticated, anon;

comment on table public.team_process_goals is
  'Meta processual por time: período + marco alvo (qtd de processos) e/ou % médio de fluxo do POP. Apuração via team_process_goals_progress.';
comment on table public.team_workflow_boards is
  'Mapa POP (kanban_boards board_type=workflow) → time. Fallback de atribuição quando o lead não tem responsável processual em nenhum time.';
comment on function public.team_process_goals_progress(uuid, date, date) is
  'Realizado x meta por time. fluxo_medio_pct é foto do estado atual dos checklists (não recortado pelo período).';

-- Índice de apoio ao join de checklist por lead+board (usado no cálculo do fluxo).
create index if not exists idx_lead_checklist_instances_lead_board
  on public.lead_checklist_instances (lead_id, board_id);

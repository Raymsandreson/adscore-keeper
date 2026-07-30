-- =============================================================================
-- Meta processual por time — Fase 2: alvo ABSOLUTO por marco.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Mudança de semântica pedida pelo usuário (30/07/2026): a meta deixa de ser
-- "quantos processos atingem o marco DENTRO do período" e passa a ser "hoje
-- temos N nesse marco, queremos chegar a M". O baseline (N no momento do
-- cadastro) fica gravado e a barra mede o acumulado atual contra M.
-- O ganho dentro do período continua sendo calculado (realizado_no_periodo).
--
-- Rollback:
--   drop function if exists public.team_process_marco_baseline(uuid);
--   drop view if exists public.vw_team_process_assignment;
--   alter table public.team_process_goals drop column if exists baseline_processes;
--   (a versão anterior de team_process_goals_progress está na migration
--    20260730220000_team_process_goals.sql)
-- =============================================================================

alter table public.team_process_goals
  add column if not exists baseline_processes integer check (baseline_processes >= 0);

comment on column public.team_process_goals.baseline_processes is
  'Quantos processos do time já estavam nesse marco quando a meta foi cadastrada (foto). Serve de ponto de partida da barra.';

-- -----------------------------------------------------------------------------
-- Atribuição processo → time, num único lugar (usada pela RPC de progresso e
-- pela de baseline). security_invoker: a view não empresta privilégio de dono.
-- Sem grant para anon/authenticated — só as funções SECURITY DEFINER leem.
-- -----------------------------------------------------------------------------
create or replace view public.vw_team_process_assignment
with (security_invoker = on) as
select
  lp.id as process_id,
  lp.lead_id,
  lp.workflow_id,
  coalesce(tm.team_id, twb.team_id) as team_id
from public.lead_processes lp
join public.leads l on l.id = lp.lead_id
left join public.team_members tm on tm.user_id = l.processual_responsible_id
left join public.team_workflow_boards twb on twb.board_id::text = lp.workflow_id
where lp.deleted_at is null
  and coalesce(tm.team_id, twb.team_id) is not null;

revoke all on public.vw_team_process_assignment from anon, authenticated;

comment on view public.vw_team_process_assignment is
  'Processo → time: responsável processual do lead; sem responsável em time, cai no POP mapeado em team_workflow_boards.';

-- -----------------------------------------------------------------------------
-- Baseline por marco de um time: quantos processos JÁ passaram por cada marco
-- (acumulado) e em quantos aquele marco é o estado atual (o mais recente).
-- Alimenta o formulário de cadastro — o usuário vê o "hoje" antes de definir o alvo.
-- -----------------------------------------------------------------------------
create or replace function public.team_process_marco_baseline(p_team_id uuid)
returns table (
  marco_tipo text,
  acumulado integer,
  atual integer
)
language sql
stable
security definer
set search_path = public
as $$
  with marcos(tipo) as (
    select unnest(array[
      'peticao_inicial', 'audiencia_conciliacao', 'pericia', 'audiencia_instrucao',
      'sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior',
      'transito_julgado', 'pagamento'
    ])
  ),
  proc as (
    select process_id from vw_team_process_assignment where team_id = p_team_id
  )
  select
    m.tipo,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join proc p on p.process_id = pm.process_id
      where pm.tipo_movimentacao = m.tipo
    ),
    (
      select count(*)::integer
      from lead_process_current_status cs
      join proc p on p.process_id = cs.process_id
      where cs.tipo_movimentacao = m.tipo
    )
  from marcos m;
$$;

grant execute on function public.team_process_marco_baseline(uuid) to authenticated, anon;

comment on function public.team_process_marco_baseline(uuid) is
  'Por marco: quantos processos do time já registraram o marco (acumulado) e em quantos ele é o marco mais recente (atual).';

-- -----------------------------------------------------------------------------
-- Progresso: barra principal agora é o ACUMULADO contra o alvo. O recorte do
-- período vira informação de ritmo (realizado_no_periodo).
-- -----------------------------------------------------------------------------
-- Colunas novas no retorno: Postgres não deixa trocar o row type via
-- CREATE OR REPLACE — precisa dropar antes.
drop function if exists public.team_process_goals_progress(uuid, date, date);

create function public.team_process_goals_progress(
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
  baseline_processes integer,
  realizado_processos integer,
  realizado_no_periodo integer,
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
  with flow as (
    select
      a.process_id,
      a.team_id,
      count(*) filter (where coalesce((it.value->>'checked')::boolean, false))::numeric
        / nullif(count(*), 0) * 100 as pct
    from vw_team_process_assignment a
    join lead_checklist_instances i
      on i.lead_id = a.lead_id
     and i.board_id::text = a.workflow_id
    cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) it(value)
    group by a.process_id, a.team_id
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
    g.baseline_processes,
    -- Acumulado: processos do time que já registraram o marco (sem recorte de data).
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join vw_team_process_assignment a on a.process_id = pm.process_id
      where a.team_id = g.team_id
        and (g.marco_tipo is null or pm.tipo_movimentacao = g.marco_tipo)
    ) as realizado_processos,
    -- Ritmo: os que registraram o marco dentro do período da meta.
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join vw_team_process_assignment a on a.process_id = pm.process_id
      where a.team_id = g.team_id
        and pm.data_movimentacao::date between g.period_start and g.period_end
        and (g.marco_tipo is null or pm.tipo_movimentacao = g.marco_tipo)
    ) as realizado_no_periodo,
    (
      select round(avg(f.pct), 1) from flow f where f.team_id = g.team_id
    ) as fluxo_medio_pct,
    (
      select count(*)::integer from vw_team_process_assignment a where a.team_id = g.team_id
    ) as processos_no_time,
    (
      select count(*)::integer from flow f where f.team_id = g.team_id
    ) as processos_com_fluxo,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join vw_team_process_assignment a on a.process_id = pm.process_id
      where a.team_id = g.team_id
    ) as processos_com_marco
  from team_process_goals g
  left join teams t on t.id = g.team_id
  where g.is_active
    and (p_team_id is null or g.team_id = p_team_id)
    and (p_period_start is null or g.period_end >= p_period_start)
    and (p_period_end is null or g.period_start <= p_period_end)
  order by g.period_start desc, coalesce(t.name, g.team_name), g.marco_tipo nulls first;
$$;

grant execute on function public.team_process_goals_progress(uuid, date, date) to authenticated, anon;

comment on function public.team_process_goals_progress(uuid, date, date) is
  'Realizado x meta por time. realizado_processos é ACUMULADO (alvo absoluto); realizado_no_periodo é o ganho dentro do período; fluxo_medio_pct é foto do estado atual dos checklists.';

-- =============================================================================
-- Metas processuais — fluxo médio ignora objetivo que saiu do POP.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Problema (30/07/2026): quando um objetivo é removido/recriado no POP, a
-- instância antiga do lead continua em lead_checklist_instances (10.704 órfãs,
-- 2.181 leads na medição desta data). O CTE `flow` juntava lead+board sem
-- checar se o objetivo ainda existe na fase, então o "% médio de fluxo do POP"
-- somava passos de objetivos que já não fazem parte do fluxo.
--
-- Correção: join em checklist_stage_links (board+stage+template). Só objetivo
-- vivo entra na conta — mesma regra que a ficha do processo passou a usar
-- (LeadFunnelProgressBar).
--
-- Efeito medido antes de aplicar (avg por time):
--   Processual Trabalhista  7.3 → 8.3   (534 processos)
--   Processual Previdenciário 6.6 → 6.3 (188 processos)
--
-- Rollback: a definição anterior está em
--   20260730233000_team_process_goals_baseline.sql (mesma assinatura e mesmo
--   row type — basta reexecutar aquele CREATE FUNCTION).
-- =============================================================================

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
    -- Só objetivo que ainda está ligado à fase no POP.
    join checklist_stage_links l
      on l.board_id = i.board_id
     and l.stage_id = i.stage_id
     and l.checklist_template_id = i.checklist_template_id
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
  'Realizado x meta por time. realizado_processos é ACUMULADO (alvo absoluto); realizado_no_periodo é o ganho dentro do período; fluxo_medio_pct é foto do estado atual dos checklists, contando só objetivo ainda ligado à fase no POP.';

-- Índice de apoio ao novo join (checklist_stage_links por board+stage+template).
create index if not exists idx_checklist_stage_links_board_stage_template
  on public.checklist_stage_links (board_id, stage_id, checklist_template_id);

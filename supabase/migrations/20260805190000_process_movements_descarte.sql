-- =============================================================================
-- process_movements: descarte reversível de marco classificado errado
-- Externo kmedldlepwiityjsdahz · 05/08/2026
--
-- POR QUE
-- Auditoria de 05/08/2026 cruzou as 603 linhas de fonte='escavador' com o jsonb
-- cru (a coluna `descricao` não guarda a classificacao_predita do Escavador, o
-- que escondia o problema). O classificador por palavra-chave não distingue a
-- DECISÃO do ATO DA PARTE que a provoca nem do EXPEDIENTE que a publica:
--
--   acordao_2grau     96 linhas, ~9 são acórdão. O resto é Certidão de
--                     Publicação (12), Diário Eletrônico (10), Contrarrazões
--                     (9), Recurso Ordinário (6)…
--   acordao_superior  20 linhas, NENHUMA é acórdão de tribunal superior.
--   acordo            54 linhas: "de Conciliação" (6) e "Una" (3) são AUDIÊNCIAS.
--   pagamento         44 linhas: "Levantamento da Suspensão" casa 'levantamento'.
--
-- A maior parte do estrago são marcos que NÃO DEVIAM EXISTIR. Trocar o tipo não
-- resolve — não há tipo certo pra "Certidão de Publicação". E process_movements é
-- append-only por design (nenhum caminho do app apaga), então não havia como
-- expressar "essa linha não é marco".
--
-- O QUE MUDA
-- Soft delete. A linha continua no banco (o histórico do erro é a única forma de
-- auditar o classificador depois) e sai das leituras. A regra de "o que é marco
-- válido" mora em UM lugar — a view process_movements_validos — em vez de virar
-- um `where` repetido em 5 consumidores. Foi exatamente a duplicação desse tipo
-- de regra que produziu o bug das duas escalas de marco_ordem (b3a0bdf52).
--
-- NÃO MEXE em: escala de marco_ordem, trigger trg_process_movements_marco_ordem,
-- régua das 10 estações, sync-process-compromissos, RLS, nem em nenhuma linha
-- de dado (a coluna nasce NULL em todas as 799 linhas = nada é descartado aqui).
--
-- ROLLBACK (reverte em <1min, sem perda):
--   create or replace view public.lead_process_current_status as
--     select distinct on (process_id) process_id, id as movement_id,
--       tipo_movimentacao, marco_ordem, data_movimentacao,
--       valor_indenizacao_fixado, link_decisao, descricao, numero_cnj,
--       case_id, lead_id
--     from process_movements pm
--     order by process_id, marco_ordem desc nulls last, data_movimentacao desc,
--              created_at desc;
--   -- e recriar as 4 funções trocando process_movements_validos por
--   -- process_movements (as definições vigentes estão versionadas em
--   -- 20260804150000_metas_processuais_individuais.sql).
--   drop view if exists public.process_movements_validos;
--   alter table public.process_movements
--     drop column if exists descartado_em,
--     drop column if exists descartado_motivo;
-- =============================================================================

-- ── 1. Colunas ──────────────────────────────────────────────────────────────
alter table public.process_movements
  add column if not exists descartado_em timestamptz,
  add column if not exists descartado_motivo text;

comment on column public.process_movements.descartado_em is
  'Preenchido = a linha não é marco válido e sai de todas as leituras. A linha '
  'NUNCA é apagada: o erro de classificação é a evidência pra auditar o '
  'classificador. Reverter = voltar a coluna pra NULL.';
comment on column public.process_movements.descartado_motivo is
  'Por que foi descartada. Ex.: "IA: certidão de publicação, não é o acórdão".';

-- ── 2. A regra, em um lugar só ──────────────────────────────────────────────
-- security_invoker=on, igual vw_process_assignment: dentro das RPCs SECURITY
-- DEFINER quem resolve é o dono da função (comportamento idêntico ao de hoje);
-- num SELECT direto, valem as policies de quem perguntou.
create or replace view public.process_movements_validos
with (security_invoker = on) as
select *
from public.process_movements
where descartado_em is null;

comment on view public.process_movements_validos is
  'Marcos válidos. TODO consumidor de marco deve ler daqui, nunca da tabela — '
  'a tabela guarda também o que foi descartado por erro de classificação.';

grant select on public.process_movements_validos to service_role;

-- ── 3. Consumidores ─────────────────────────────────────────────────────────
-- Definições puxadas com pg_get_viewdef/pg_get_functiondef do banco em
-- 05/08/2026 (o repo diverge do aplicado — ver memória migrations-repo-drift).
-- Única alteração em cada uma: process_movements → process_movements_validos.

create or replace view public.lead_process_current_status as
select distinct on (process_id)
  process_id,
  id as movement_id,
  tipo_movimentacao,
  marco_ordem,
  data_movimentacao,
  valor_indenizacao_fixado,
  link_decisao,
  descricao,
  numero_cnj,
  case_id,
  lead_id
from public.process_movements_validos pm
order by process_id, marco_ordem desc nulls last, data_movimentacao desc, created_at desc;

create or replace function public.process_marco_baseline(
  p_team_id uuid default null,
  p_user_id uuid default null
)
returns table(marco_tipo text, acumulado integer, atual integer)
language sql stable security definer set search_path to 'public'
as $function$
  with marcos(tipo) as (
    select unnest(array[
      'peticao_inicial', 'audiencia_conciliacao', 'pericia', 'audiencia_instrucao',
      'sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior',
      'transito_julgado', 'pagamento'
    ])
  ),
  proc as (
    select a.process_id
    from vw_process_assignment a
    where case
      when p_user_id is not null then a.user_id = p_user_id
      when p_team_id is not null then a.team_id = p_team_id
      else false
    end
  ),
  atual as (
    select distinct on (pm.process_id) pm.process_id, pm.tipo_movimentacao
    from process_movements_validos pm
    join proc p on p.process_id = pm.process_id
    order by pm.process_id, pm.marco_ordem desc nulls last, pm.data_movimentacao desc
  )
  select
    m.tipo,
    (
      select count(distinct pm.process_id)::integer
      from process_movements_validos pm
      join proc p on p.process_id = pm.process_id
      where pm.tipo_movimentacao = m.tipo
    ),
    (
      select count(*)::integer from atual a where a.tipo_movimentacao = m.tipo
    )
  from marcos m;
$function$;

create or replace function public.process_marco_processos(
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_marco text default null,
  p_modo text default 'acumulado'
)
returns table(
  process_id uuid, process_number text, title text, case_id uuid, lead_id uuid,
  lead_name text, responsavel text, data_movimentacao timestamptz, descricao text
)
language sql stable security definer set search_path to 'public'
as $function$
  with alvo as (
    select a.process_id, a.user_id
    from vw_process_assignment a
    where case
      when p_user_id is not null then a.user_id = p_user_id
      when p_team_id is not null then a.team_id = p_team_id
      else false
    end
  ),
  atual as (
    select distinct on (pm.process_id)
      pm.process_id, pm.tipo_movimentacao, pm.data_movimentacao, pm.descricao
    from process_movements_validos pm
    join alvo t on t.process_id = pm.process_id
    order by pm.process_id, pm.marco_ordem desc nulls last, pm.data_movimentacao desc
  )
  select
    lp.id,
    lp.process_number,
    lp.title,
    lp.case_id,
    lp.lead_id,
    l.lead_name,
    pr.full_name,
    src.data_movimentacao,
    left(src.descricao, 240)
  from alvo t
  join lead_processes lp on lp.id = t.process_id
  join leads l on l.id = lp.lead_id
  left join profiles pr on pr.user_id = t.user_id
  join lateral (
    select at.data_movimentacao, at.descricao
    from atual at
    where p_modo = 'atual'
      and at.process_id = lp.id
      and at.tipo_movimentacao = p_marco
    union all
    select pm.data_movimentacao, pm.descricao
    from process_movements_validos pm
    where p_modo is distinct from 'atual'
      and pm.process_id = lp.id
      and pm.tipo_movimentacao = p_marco
    order by 1 desc
    limit 1
  ) src on true
  order by src.data_movimentacao desc;
$function$;

create or replace function public.process_owners()
returns table(user_id uuid, full_name text, processos integer, processos_com_marco integer)
language sql stable security definer set search_path to 'public'
as $function$
  select
    a.user_id,
    coalesce(pr.full_name, '(sem nome)') as full_name,
    count(*)::integer as processos,
    count(*) filter (
      where exists (select 1 from process_movements_validos pm where pm.process_id = a.process_id)
    )::integer as processos_com_marco
  from vw_process_assignment a
  left join profiles pr on pr.user_id = a.user_id
  where a.user_id is not null
  group by a.user_id, pr.full_name
  order by count(*) desc;
$function$;

create or replace function public.process_goals_progress(
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_period_start date default null,
  p_period_end date default null
)
returns table(
  goal_id uuid, owner_kind text, team_id uuid, team_name text, user_id uuid,
  user_name text, name text, period_type text, period_start date, period_end date,
  marco_tipo text, target_processes integer, target_flow_avg_pct numeric,
  baseline_processes integer, realizado_processos integer, realizado_no_periodo integer,
  fluxo_medio_pct numeric, processos_no_time integer, processos_com_fluxo integer,
  processos_com_marco integer
)
language sql stable security definer set search_path to 'public'
as $function$
  with flow as (
    select
      a.process_id,
      a.team_id,
      a.user_id,
      count(*) filter (where coalesce((it.value->>'checked')::boolean, false))::numeric
        / nullif(count(*), 0) * 100 as pct
    from vw_process_assignment a
    join lead_checklist_instances i
      on i.lead_id = a.lead_id
     and i.board_id::text = a.workflow_id
    join checklist_stage_links l
      on l.board_id = i.board_id
     and l.stage_id = i.stage_id
     and l.checklist_template_id = i.checklist_template_id
    cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) it(value)
    group by a.process_id, a.team_id, a.user_id
  )
  select
    g.id,
    case when g.user_id is not null then 'user' else 'team' end as owner_kind,
    g.team_id,
    coalesce(t.name, g.team_name) as team_name,
    g.user_id,
    coalesce(pr.full_name, g.user_name) as user_name,
    g.name,
    g.period_type,
    g.period_start,
    g.period_end,
    g.marco_tipo,
    g.target_processes,
    g.target_flow_avg_pct,
    g.baseline_processes,
    (
      select count(distinct pm.process_id)::integer
      from process_movements_validos pm
      join vw_process_assignment a on a.process_id = pm.process_id
      where (case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end)
        and (g.marco_tipo is null or pm.tipo_movimentacao = g.marco_tipo)
    ) as realizado_processos,
    (
      select count(distinct pm.process_id)::integer
      from process_movements_validos pm
      join vw_process_assignment a on a.process_id = pm.process_id
      where (case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end)
        and pm.data_movimentacao::date between g.period_start and g.period_end
        and (g.marco_tipo is null or pm.tipo_movimentacao = g.marco_tipo)
    ) as realizado_no_periodo,
    (
      select round(avg(f.pct), 1) from flow f
      where case when g.user_id is not null then f.user_id = g.user_id else f.team_id = g.team_id end
    ) as fluxo_medio_pct,
    (
      select count(*)::integer from vw_process_assignment a
      where case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end
    ) as processos_no_time,
    (
      select count(*)::integer from flow f
      where case when g.user_id is not null then f.user_id = g.user_id else f.team_id = g.team_id end
    ) as processos_com_fluxo,
    (
      select count(distinct pm.process_id)::integer
      from process_movements_validos pm
      join vw_process_assignment a on a.process_id = pm.process_id
      where case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end
    ) as processos_com_marco
  from team_process_goals g
  left join teams t on t.id = g.team_id
  left join profiles pr on pr.user_id = g.user_id
  where g.is_active
    and (p_team_id is null or g.team_id = p_team_id)
    and (p_user_id is null or g.user_id = p_user_id)
    and (p_period_start is null or g.period_end >= p_period_start)
    and (p_period_end is null or g.period_start <= p_period_end)
  order by g.period_start desc,
           coalesce(t.name, g.team_name, pr.full_name, g.user_name),
           g.marco_tipo nulls first;
$function$;

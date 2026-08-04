-- Telão /tv/atividades — detalhe por critério, fase 2.
-- tv_ranking_detalhe passa a atender também 'status', 'fases' e 'objetivos'
-- (antes só 'passos', 'concluidas' e 'atrasadas'). Com isso todos os números
-- da linha do assessor (status · fases · obj · passos · concl · atr) abrem a
-- lista itemizada do que compôs o número.
--
-- Fidelidade: replica EXATAMENTE os filtros do tv_atividades_ranking vigente
-- (lido via pg_get_functiondef em 04/08/2026):
--   status    = lead_pop_result_history.to_result ∈ settings.resultado_esperado_ids
--               do board, no MÊS CORRENTE (não usa p_since), 1 por lead
--               (ranking usa count(distinct lead_id)); + lead_processes com
--               resultado_atingido_status='confirmado' no mês, por
--               responsible_user_id
--   fases     = grupo (lead, board, stage) 100% concluído, com o último
--               completed_at no período; atribuída a quem marcou o último
--               passo não-retroativo da última instância do grupo
--   objetivos = lead_checklist_instances is_completed e completed_at >= p_since,
--               atribuída a quem marcou o último passo não-retroativo da
--               instância no período
--   passos / concluidas / atrasadas = inalterados
--
-- As CTEs de apoio (board_kpi, inst_last, fase_grupos…) são guardadas por
-- `p_criterio = ...` pra não pagar o scan quando o critério pedido é outro.
--
-- Aditivo: só substitui o corpo da própria tv_ranking_detalhe; nenhuma outra
-- função ou tabela é tocada. Rollback: reaplicar
--   supabase/migrations/20260729230000_tv_ranking_detalhe.sql
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

create or replace function public.tv_ranking_detalhe(
  p_nome text,
  p_criterio text,
  p_since timestamptz default date_trunc('day', now())
)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with ext_users as (
  -- ext UUIDs cujo nome agregado no ranking bate com p_nome
  select pr.user_id as ext_user
  from profiles pr
  where btrim(pr.full_name) = btrim(p_nome)
  union
  select coalesce(m.ext_uuid, g.user_id)
  from (
    select manager_user_id as user_id, manager_name as nome
    from team_managers where manager_user_id is not null
    union
    select user_id, name from org_directors
  ) g
  left join auth_uuid_mapping m on m.cloud_uuid = g.user_id
  where btrim(g.nome) = btrim(p_nome)
  union
  -- contas sem profile (ex.: duplicatas antigas): o ranking nomeia por
  -- coalesce(full_name, max(assigned_to_name)) — replicar aqui
  select la.assigned_to
  from lead_activities la
  left join profiles pr on pr.user_id = la.assigned_to
  where la.deleted_at is null and la.assigned_to is not null
  group by la.assigned_to, pr.full_name
  having btrim(coalesce(pr.full_name, max(la.assigned_to_name))) = btrim(p_nome)
),
log_users as (
  -- user_activity_log.user_id que o ranking atribui a essa pessoa:
  -- coalesce(map(cloud→ext), user_id) ∈ ext_users. Quem TEM mapeamento só
  -- conta pelo destino do mapa (evita dobrar em conta duplicada).
  select m.cloud_uuid as user_id
  from auth_uuid_mapping m
  join ext_users e on e.ext_user = m.ext_uuid
  union
  select e.ext_user
  from ext_users e
  where not exists (select 1 from auth_uuid_mapping m where m.cloud_uuid = e.ext_user)
),
mes_ini as (
  -- 'status' no ranking é sempre do mês corrente, independente do período
  select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date as d
),
board_kpi as (
  -- resultados que o POP considera "status esperado" (o que pontua)
  select b.id as board_id, x.expected
  from kanban_boards b
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(b.settings->'resultado_esperado_ids') = 'array'
              and jsonb_array_length(b.settings->'resultado_esperado_ids') > 0
         then b.settings->'resultado_esperado_ids'
         when coalesce(b.settings->>'resultado_esperado_id', '') <> ''
         then jsonb_build_array(b.settings->>'resultado_esperado_id')
         else '[]'::jsonb end
  ) as x(expected)
  where p_criterio = 'status'
),
res_labels as (
  -- id do resultado → rótulo legível ("Deferido", "Acordo"…)
  select b.id as board_id, x->>'id' as res_id, x->>'label' as label
  from kanban_boards b
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(b.settings->'resultados') = 'array'
         then b.settings->'resultados' else '[]'::jsonb end
  ) as x
  where p_criterio = 'status'
),
status_lead as (
  -- 1 linha por lead (ranking conta distinct lead_id), a mais recente
  select distinct on (h.lead_id)
    h.lead_id, h.board_id, h.to_result, h.changed_at
  from lead_pop_result_history h
  join board_kpi k on k.board_id = h.board_id and k.expected = h.to_result
  where p_criterio = 'status'
    and h.changed_by in (select user_id from log_users)
    and coalesce(h.effective_date, (h.changed_at at time zone 'America/Sao_Paulo')::date)
        >= (select d from mes_ini)
  order by h.lead_id, h.changed_at desc
),
inst_last as (
  -- quem marcou o último passo (não-retroativo) de cada instância no período
  select ual.entity_id as instance_id,
    (array_agg(ual.user_id order by ual.created_at desc))[1] as cloud_user
  from user_activity_log ual
  where p_criterio in ('objetivos', 'fases')
    and ual.action_type = 'checklist_item_checked'
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
    and ual.created_at >= p_since
  group by ual.entity_id
),
fase_grupos as (
  select lci.lead_id, lci.board_id, lci.stage_id,
    (array_agg(lci.id order by lci.completed_at desc nulls last))[1] as last_instance,
    max(lci.completed_at) as quando
  from lead_checklist_instances lci
  where p_criterio = 'fases' and lci.stage_id is not null
  group by lci.lead_id, lci.board_id, lci.stage_id
  having bool_and(lci.is_completed) and max(lci.completed_at) >= p_since
),
itens as (
  -- PASSOS: cada checklist_item_checked do período
  select extract(epoch from ual.created_at) as ord,
    jsonb_build_object(
      'tipo', 'passo',
      'quando', ual.created_at,
      'titulo', nullif(btrim(coalesce(ual.metadata->>'item_label', '')), ''),
      'lead_id', lci.lead_id,
      'lead_nome', l.lead_name
    ) as item
  from user_activity_log ual
  left join lead_checklist_instances lci on lci.id = ual.entity_id
  left join leads l on l.id = lci.lead_id
  where p_criterio = 'passos'
    and ual.action_type = 'checklist_item_checked'
    and ual.created_at >= p_since
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
    and ual.user_id in (select user_id from log_users)

  union all

  -- CONCLUÍDAS no período
  select extract(epoch from la.completed_at) as ord,
    jsonb_build_object(
      'tipo', 'concluida',
      'activity_id', la.id,
      'quando', la.completed_at,
      'titulo', la.title,
      'lead_nome', coalesce(nullif(btrim(la.client_name_override), ''), la.lead_name)
    )
  from lead_activities la
  where p_criterio = 'concluidas'
    and la.deleted_at is null
    and la.assigned_to in (select ext_user from ext_users)
    and la.status = 'concluida'
    and la.completed_at >= p_since

  union all

  -- ATRASADAS (backlog total; ord negativo = mais atrasada primeiro no desc)
  select -extract(epoch from la.deadline::timestamp) as ord,
    jsonb_build_object(
      'tipo', 'atrasada',
      'activity_id', la.id,
      'deadline', la.deadline,
      'dias_atraso', (current_date - la.deadline),
      'titulo', la.title,
      'lead_nome', coalesce(nullif(btrim(la.client_name_override), ''), la.lead_name)
    )
  from lead_activities la
  where p_criterio = 'atrasadas'
    and la.deleted_at is null
    and la.assigned_to in (select ext_user from ext_users)
    and la.status <> 'concluida'
    and la.deadline < current_date

  union all

  -- STATUS ESPERADO batido no lead (mês corrente)
  select extract(epoch from s.changed_at) as ord,
    jsonb_build_object(
      'tipo', 'status',
      'quando', s.changed_at,
      'titulo', coalesce(rl.label, s.to_result),
      'lead_id', s.lead_id,
      'lead_nome', l.lead_name,
      'contexto', b.name
    )
  from status_lead s
  left join res_labels rl on rl.board_id = s.board_id and rl.res_id = s.to_result
  left join kanban_boards b on b.id = s.board_id
  left join leads l on l.id = s.lead_id

  union all

  -- STATUS ESPERADO batido no processo (mês corrente)
  select extract(epoch from coalesce(p.resultado_atingido_data, current_date)::timestamp) as ord,
    jsonb_build_object(
      'tipo', 'status',
      'quando', coalesce(p.resultado_atingido_data, current_date)::timestamp,
      'titulo', coalesce(rl.label, p.resultado_atingido_id),
      'lead_id', p.lead_id,
      'lead_nome', coalesce(l.lead_name, p.title),
      'contexto', coalesce(nullif(btrim(p.process_number), ''), p.workflow_name)
    )
  from lead_processes p
  join board_kpi k on k.board_id::text = p.workflow_id and k.expected = p.resultado_atingido_id
  left join res_labels rl on rl.board_id::text = p.workflow_id and rl.res_id = p.resultado_atingido_id
  left join leads l on l.id = p.lead_id
  where p_criterio = 'status'
    and p.resultado_atingido_status = 'confirmado'
    and p.responsible_user_id in (select ext_user from ext_users)
    and coalesce(p.resultado_atingido_data, (now() at time zone 'America/Sao_Paulo')::date)
        >= (select d from mes_ini)

  union all

  -- OBJETIVOS concluídos no período
  select extract(epoch from lci.completed_at) as ord,
    jsonb_build_object(
      'tipo', 'objetivo',
      'quando', lci.completed_at,
      'titulo', ct.name,
      'lead_id', lci.lead_id,
      'lead_nome', l.lead_name
    )
  from lead_checklist_instances lci
  join inst_last il on il.instance_id = lci.id
  left join checklist_templates ct on ct.id = lci.checklist_template_id
  left join leads l on l.id = lci.lead_id
  where p_criterio = 'objetivos'
    and lci.is_completed
    and lci.completed_at >= p_since
    and il.cloud_user in (select user_id from log_users)

  union all

  -- FASES fechadas no período (todos os objetivos da fase concluídos)
  select extract(epoch from fg.quando) as ord,
    jsonb_build_object(
      'tipo', 'fase',
      'quando', fg.quando,
      'titulo', coalesce(st.nome, fg.stage_id),
      'lead_id', fg.lead_id,
      'lead_nome', l.lead_name,
      'contexto', b.name
    )
  from fase_grupos fg
  join inst_last il on il.instance_id = fg.last_instance
  left join kanban_boards b on b.id = fg.board_id
  left join lateral (
    select x->>'name' as nome
    from jsonb_array_elements(
      case when jsonb_typeof(b.stages) = 'array' then b.stages else '[]'::jsonb end
    ) as x
    where x->>'id' = fg.stage_id
    limit 1
  ) st on true
  left join leads l on l.id = fg.lead_id
  where p_criterio = 'fases'
    and il.cloud_user in (select user_id from log_users)
)
select coalesce(jsonb_agg(item order by ord desc), '[]'::jsonb) from itens;
$function$;

grant execute on function public.tv_ranking_detalhe(text, text, timestamptz) to authenticated;

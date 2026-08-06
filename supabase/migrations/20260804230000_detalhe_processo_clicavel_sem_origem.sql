-- Detalhe do telão: o chip do processo vira atalho mesmo sem origem gravada.
--
-- Motivo (Raym, 04/08/2026): o aviso dizia "marcação anterior a 04/08" em itens
-- marcados HOJE, com o telão no período de hoje — leitura errada. A origem
-- (atividade | processo) passa a existir a partir do DEPLOY, não de uma data do
-- calendário, e passo marcado pelo funil/WhatsApp nunca vai ter origem. O aviso
-- virou só "origem não registrada" no front.
--
-- Em compensação, o que dá pra afirmar sem origem passa a ser clicável: quando
-- o POP do checklist é o POP de um processo do lead, aquele processo É o
-- processo do passo (vínculo determinístico). `passo_processo_id` devolve o id
-- SÓ por esse caminho — o fallback "lead tem 1 processo só" do
-- `passo_processo_rotulo` continua servindo para escrever o rótulo, mas não
-- vira link. Isso NÃO afirma origem: o passo pode ter sido marcado dentro de
-- uma atividade que usa o mesmo POP.
--
-- Medido depois de aplicar: 12 dos 13 objetivos da Andressa (hoje) já abrem o
-- processo, com 0 itens com origem gravada.
-- Rollback: reaplicar 20260804220000 e dropar passo_processo_id.
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

create or replace function public.passo_processo_id(p_lead_id uuid, p_board_id uuid)
returns uuid
language sql
stable
set search_path to 'public'
as $function$
  select lp.id
  from lead_processes lp
  where lp.lead_id = p_lead_id and lp.deleted_at is null
    and lp.workflow_id = p_board_id::text
  order by lp.created_at
  limit 1;
$function$;

grant execute on function public.passo_processo_id(uuid, uuid) to authenticated;

-- tv_ranking_detalhe: origem da marcação (atividade | processo) nos ramos de
-- passo, objetivo e fase; process_id também em concluídas/atrasadas/status.
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
  select la.assigned_to
  from lead_activities la
  left join profiles pr on pr.user_id = la.assigned_to
  where la.deleted_at is null and la.assigned_to is not null
  group by la.assigned_to, pr.full_name
  having btrim(coalesce(pr.full_name, max(la.assigned_to_name))) = btrim(p_nome)
),
log_users as (
  select m.cloud_uuid as user_id
  from auth_uuid_mapping m
  join ext_users e on e.ext_user = m.ext_uuid
  union
  select e.ext_user
  from ext_users e
  where not exists (select 1 from auth_uuid_mapping m where m.cloud_uuid = e.ext_user)
),
periodo_ini as (
  select (p_since at time zone 'America/Sao_Paulo')::date as d
),
board_kpi as (
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
  select b.id as board_id, x->>'id' as res_id, x->>'label' as label
  from kanban_boards b
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(b.settings->'resultados') = 'array'
         then b.settings->'resultados' else '[]'::jsonb end
  ) as x
  where p_criterio = 'status'
),
status_lead as (
  select distinct on (h.lead_id)
    h.lead_id, h.board_id, h.to_result, h.changed_at
  from lead_pop_result_history h
  join board_kpi k on k.board_id = h.board_id and k.expected = h.to_result
  where p_criterio = 'status'
    and h.changed_by in (select user_id from log_users)
    and coalesce(h.effective_date, (h.changed_at at time zone 'America/Sao_Paulo')::date)
        >= (select d from periodo_ini)
  order by h.lead_id, h.changed_at desc
),
inst_last as (
  -- ultimo passo nao-retroativo da instancia no periodo: define a quem o
  -- objetivo/fase e creditado E de onde a marcacao saiu (atividade ou processo).
  select ual.entity_id as instance_id,
    (array_agg(ual.user_id order by ual.created_at desc))[1] as cloud_user,
    (array_agg(ual.metadata->>'activity_id' order by ual.created_at desc))[1] as activity_id,
    (array_agg(ual.metadata->>'process_id' order by ual.created_at desc))[1] as process_id,
    (array_agg(ual.metadata->>'origem' order by ual.created_at desc))[1] as origem
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
  select extract(epoch from ual.created_at) as ord,
    jsonb_build_object(
      'tipo', 'passo',
      'quando', ual.created_at,
      'titulo', nullif(btrim(coalesce(ual.metadata->>'item_label', '')), ''),
      'lead_id', lci.lead_id,
      'lead_nome', l.lead_name,
      'objetivo', ct.name,
      'fase', board_stage_nome(lci.board_id, lci.stage_id),
      'pop', b.name,
      'processo', coalesce(
        nullif(btrim(lp.process_number), ''), lp.title,
        passo_processo_rotulo(lci.lead_id, lci.board_id)
      ),
      'process_id', coalesce(lp.id, passo_processo_id(lci.lead_id, lci.board_id)),
      'origem', ual.metadata->>'origem',
      'activity_id', la.id,
      'atividade', la.title
    ) as item
  from user_activity_log ual
  left join lead_checklist_instances lci on lci.id = ual.entity_id
  left join leads l on l.id = lci.lead_id
  left join checklist_templates ct on ct.id = lci.checklist_template_id
  left join kanban_boards b on b.id = lci.board_id
  left join lead_activities la
    on la.id::text = ual.metadata->>'activity_id' and la.deleted_at is null
  left join lead_processes lp
    on lp.id::text = ual.metadata->>'process_id' and lp.deleted_at is null
  where p_criterio = 'passos'
    and ual.action_type = 'checklist_item_checked'
    and ual.created_at >= p_since
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
    and ual.user_id in (select user_id from log_users)

  union all

  select extract(epoch from la.completed_at) as ord,
    jsonb_build_object(
      'tipo', 'concluida',
      'activity_id', la.id,
      'quando', la.completed_at,
      'titulo', la.title,
      'lead_nome', coalesce(nullif(btrim(la.client_name_override), ''), la.lead_name),
      'processo', nullif(btrim(la.process_title), ''),
      'process_id', la.process_id
    )
  from lead_activities la
  where p_criterio = 'concluidas'
    and la.deleted_at is null
    and la.assigned_to in (select ext_user from ext_users)
    and la.status = 'concluida'
    and la.completed_at >= p_since

  union all

  select -extract(epoch from la.deadline::timestamp) as ord,
    jsonb_build_object(
      'tipo', 'atrasada',
      'activity_id', la.id,
      'deadline', la.deadline,
      'dias_atraso', (current_date - la.deadline),
      'titulo', la.title,
      'lead_nome', coalesce(nullif(btrim(la.client_name_override), ''), la.lead_name),
      'processo', nullif(btrim(la.process_title), ''),
      'process_id', la.process_id
    )
  from lead_activities la
  where p_criterio = 'atrasadas'
    and la.deleted_at is null
    and la.assigned_to in (select ext_user from ext_users)
    and la.status <> 'concluida'
    and la.deadline < current_date

  union all

  select extract(epoch from s.changed_at) as ord,
    jsonb_build_object(
      'tipo', 'status',
      'quando', s.changed_at,
      'titulo', coalesce(rl.label, s.to_result),
      'lead_id', s.lead_id,
      'lead_nome', l.lead_name,
      'pop', b.name,
      'processo', passo_processo_rotulo(s.lead_id, s.board_id),
      'process_id', passo_processo_id(s.lead_id, s.board_id)
    )
  from status_lead s
  left join res_labels rl on rl.board_id = s.board_id and rl.res_id = s.to_result
  left join kanban_boards b on b.id = s.board_id
  left join leads l on l.id = s.lead_id

  union all

  select extract(epoch from coalesce(p.resultado_atingido_data, current_date)::timestamp) as ord,
    jsonb_build_object(
      'tipo', 'status',
      'quando', coalesce(p.resultado_atingido_data, current_date)::timestamp,
      'titulo', coalesce(rl.label, p.resultado_atingido_id),
      'lead_id', p.lead_id,
      'lead_nome', coalesce(l.lead_name, p.title),
      'pop', p.workflow_name,
      'processo', coalesce(nullif(btrim(p.process_number), ''), p.title),
      'process_id', p.id
    )
  from lead_processes p
  join board_kpi k on k.board_id::text = p.workflow_id and k.expected = p.resultado_atingido_id
  left join res_labels rl on rl.board_id::text = p.workflow_id and rl.res_id = p.resultado_atingido_id
  left join leads l on l.id = p.lead_id
  where p_criterio = 'status'
    and p.resultado_atingido_status = 'confirmado'
    and p.responsible_user_id in (select ext_user from ext_users)
    and coalesce(p.resultado_atingido_data, (now() at time zone 'America/Sao_Paulo')::date)
        >= (select d from periodo_ini)

  union all

  select extract(epoch from lci.completed_at) as ord,
    jsonb_build_object(
      'tipo', 'objetivo',
      'quando', lci.completed_at,
      'titulo', ct.name,
      'lead_id', lci.lead_id,
      'lead_nome', l.lead_name,
      'fase', board_stage_nome(lci.board_id, lci.stage_id),
      'pop', b.name,
      'processo', coalesce(
        nullif(btrim(lp.process_number), ''), lp.title,
        passo_processo_rotulo(lci.lead_id, lci.board_id)
      ),
      'process_id', coalesce(lp.id, passo_processo_id(lci.lead_id, lci.board_id)),
      'origem', il.origem,
      'activity_id', la.id,
      'atividade', la.title
    )
  from lead_checklist_instances lci
  join inst_last il on il.instance_id = lci.id
  left join checklist_templates ct on ct.id = lci.checklist_template_id
  left join leads l on l.id = lci.lead_id
  left join kanban_boards b on b.id = lci.board_id
  left join lead_activities la on la.id::text = il.activity_id and la.deleted_at is null
  left join lead_processes lp on lp.id::text = il.process_id and lp.deleted_at is null
  where p_criterio = 'objetivos'
    and lci.is_completed
    and lci.completed_at >= p_since
    and il.cloud_user in (select user_id from log_users)

  union all

  select extract(epoch from fg.quando) as ord,
    jsonb_build_object(
      'tipo', 'fase',
      'quando', fg.quando,
      'titulo', coalesce(board_stage_nome(fg.board_id, fg.stage_id), fg.stage_id),
      'lead_id', fg.lead_id,
      'lead_nome', l.lead_name,
      'pop', b.name,
      'processo', coalesce(
        nullif(btrim(lp.process_number), ''), lp.title,
        passo_processo_rotulo(fg.lead_id, fg.board_id)
      ),
      'process_id', coalesce(lp.id, passo_processo_id(fg.lead_id, fg.board_id)),
      'origem', il.origem,
      'activity_id', la.id,
      'atividade', la.title
    )
  from fase_grupos fg
  join inst_last il on il.instance_id = fg.last_instance
  left join kanban_boards b on b.id = fg.board_id
  left join leads l on l.id = fg.lead_id
  left join lead_activities la on la.id::text = il.activity_id and la.deleted_at is null
  left join lead_processes lp on lp.id::text = il.process_id and lp.deleted_at is null
  where p_criterio = 'fases'
    and il.cloud_user in (select user_id from log_users)
)
select coalesce(jsonb_agg(item order by ord desc), '[]'::jsonb) from itens;
$function$;

grant execute on function public.tv_ranking_detalhe(text, text, timestamptz) to authenticated;

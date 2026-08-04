-- Detalhe do passo no telão: de onde ele veio e em qual atividade foi marcado.
--
-- Problema: clicar em "passos" listava só o rótulo do passo. Faltava o contexto
-- (objetivo · fase · POP · lead · processo) e a ATIVIDADE em que o passo foi
-- marcado. A atividade não estava em lugar nenhum: log_checklist_step só grava
-- instância + label, mesmo quando a marcação sai de dentro da ficha da
-- atividade (LeadFunnelProgressBar dentro do ActivityFullSheet).
--
-- 1) Nova sobrecarga log_checklist_step(..., p_activity_id uuid) — 5 args, SEM
--    default (default criaria ambiguidade com a assinatura de 4 args, que
--    continua existindo e delegando pra esta). O front passa o id da atividade
--    aberta quando a marcação nasce de lá; fica em metadata.activity_id.
-- 2) tv_ranking_detalhe enriquece 'passos', 'objetivos' e 'fases' com
--    objetivo/fase/POP/processo, e devolve a atividade quando o log tiver.
--
-- Processo do passo (determinístico, sem chute): o lead_processes do lead cujo
-- workflow_id = board do checklist; se não houver e o lead tiver exatamente UM
-- processo, esse. Caso contrário fica em branco. (Medido em 04/08: 410 de 865
-- passos das últimas 48h resolvem pelo POP; 30 leads não têm processo.)
-- Passos anteriores a esta migration ficam sem activity_id — não dá pra
-- reconstruir o vínculo retroativamente (correlação por horário casava só ~67%,
-- seria chute).
--
-- Rollback: drop function log_checklist_step(uuid,uuid,text,boolean,uuid) +
-- reaplicar 20260804180000_tv_ranking_detalhe_status_fases_objetivos.sql.
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

create or replace function public.log_checklist_step(
  p_user_id uuid,
  p_instance_id uuid,
  p_item_label text,
  p_retroactive boolean,
  p_activity_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_user_id is null then return; end if;
  insert into public.user_activity_log (user_id, action_type, entity_type, entity_id, metadata, created_at)
  values (p_user_id, 'checklist_item_checked', 'workflow', p_instance_id,
          jsonb_build_object(
            'item_label', coalesce(p_item_label, 'Passo'),
            'retroactive', coalesce(p_retroactive, false)
          ) || case when p_activity_id is null then '{}'::jsonb
                    else jsonb_build_object('activity_id', p_activity_id) end,
          now());
exception when others then
  raise warning '[log_checklist_step] falhou: %', sqlerrm;
end;
$function$;

grant execute on function public.log_checklist_step(uuid, uuid, text, boolean, uuid) to authenticated;

-- Assinatura antiga (4 args) segue válida e delega pra nova, pra nenhum caller
-- pendurado quebrar enquanto o front não sobe.
create or replace function public.log_checklist_step(
  p_user_id uuid,
  p_instance_id uuid,
  p_item_label text,
  p_retroactive boolean default false
)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  select public.log_checklist_step(p_user_id, p_instance_id, p_item_label, p_retroactive, null::uuid);
$function$;

grant execute on function public.log_checklist_step(uuid, uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Auxiliares (aditivas): rótulo do processo do passo e nome da fase do board.
-- ---------------------------------------------------------------------------

-- Processo a que o passo pertence. 1º o processo do lead cujo POP é o board do
-- checklist; se não houver, só resolve quando o lead tem EXATAMENTE um processo
-- (senão seria escolher no chute). Null = não dá pra afirmar.
create or replace function public.passo_processo_rotulo(p_lead_id uuid, p_board_id uuid)
returns text
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select coalesce(nullif(btrim(lp.process_number), ''), lp.title)
       from lead_processes lp
      where lp.lead_id = p_lead_id and lp.deleted_at is null
        and lp.workflow_id = p_board_id::text
      order by lp.created_at
      limit 1),
    (select coalesce(nullif(btrim(min(lp.process_number)), ''), min(lp.title))
       from lead_processes lp
      where lp.lead_id = p_lead_id and lp.deleted_at is null
     having count(*) = 1)
  );
$function$;

grant execute on function public.passo_processo_rotulo(uuid, uuid) to authenticated;

-- Nome da fase: kanban_boards.stages é jsonb, não existe tabela de stages.
create or replace function public.board_stage_nome(p_board_id uuid, p_stage_id text)
returns text
language sql
stable
set search_path to 'public'
as $function$
  select x->>'name'
  from kanban_boards b
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(b.stages) = 'array' then b.stages else '[]'::jsonb end
  ) as x
  where b.id = p_board_id and x->>'id' = p_stage_id
  limit 1;
$function$;

grant execute on function public.board_stage_nome(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- tv_ranking_detalhe: cada item passa a dizer ONDE mora.
--   passo     → objetivo · fase · POP · processo · atividade (metadata)
--   objetivo  → fase · POP · processo
--   fase      → POP · processo
--   status    → POP · processo
--   concl/atr → processo (lead_activities.process_title)
-- O corpo abaixo é o mesmo de 20260804180000 com esses campos a mais; os
-- filtros de contagem não mudaram (conferido: detalhe = ranking).
-- ---------------------------------------------------------------------------
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
mes_ini as (
  select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date as d
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
        >= (select d from mes_ini)
  order by h.lead_id, h.changed_at desc
),
inst_last as (
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
  -- PASSOS: passo + onde ele mora (objetivo/fase/POP/processo) + a atividade
  -- de onde a marcacao saiu (metadata.activity_id, gravado a partir de 04/08).
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
      'processo', passo_processo_rotulo(lci.lead_id, lci.board_id),
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
      'processo', nullif(btrim(la.process_title), '')
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
      'processo', nullif(btrim(la.process_title), '')
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
      'processo', passo_processo_rotulo(s.lead_id, s.board_id)
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
      'processo', coalesce(nullif(btrim(p.process_number), ''), p.title)
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

  select extract(epoch from lci.completed_at) as ord,
    jsonb_build_object(
      'tipo', 'objetivo',
      'quando', lci.completed_at,
      'titulo', ct.name,
      'lead_id', lci.lead_id,
      'lead_nome', l.lead_name,
      'fase', board_stage_nome(lci.board_id, lci.stage_id),
      'pop', b.name,
      'processo', passo_processo_rotulo(lci.lead_id, lci.board_id)
    )
  from lead_checklist_instances lci
  join inst_last il on il.instance_id = lci.id
  left join checklist_templates ct on ct.id = lci.checklist_template_id
  left join leads l on l.id = lci.lead_id
  left join kanban_boards b on b.id = lci.board_id
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
      'processo', passo_processo_rotulo(fg.lead_id, fg.board_id)
    )
  from fase_grupos fg
  join inst_last il on il.instance_id = fg.last_instance
  left join kanban_boards b on b.id = fg.board_id
  left join leads l on l.id = fg.lead_id
  where p_criterio = 'fases'
    and il.cloud_user in (select user_id from log_users)
)
select coalesce(jsonb_agg(item order by ord desc), '[]'::jsonb) from itens;
$function$;

grant execute on function public.tv_ranking_detalhe(text, text, timestamptz) to authenticated;

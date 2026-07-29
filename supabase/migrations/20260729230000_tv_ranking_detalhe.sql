-- Telão /tv/atividades — detalhe por critério ao clicar no chip da linha.
-- Novo RPC tv_ranking_detalhe(p_nome, p_criterio, p_since): devolve a lista
-- itemizada do que compôs o número agregado do tv_atividades_ranking pra uma
-- pessoa. Fase 1: 'passos', 'concluidas' e 'atrasadas'.
--
-- Fidelidade: replica EXATAMENTE os filtros do tv_atividades_ranking vigente
-- (lido via pg_get_functiondef em 29/07/2026):
--   passos     = user_activity_log action_type='checklist_item_checked',
--                created_at >= p_since, metadata retroactive <> 'true'
--   concluidas = lead_activities status='concluida', completed_at >= p_since,
--                deleted_at null, assigned_to (single — multi-assign não conta
--                no ranking, então também não conta aqui)
--   atrasadas  = status <> 'concluida', deadline < current_date (backlog
--                total, sem filtro de período — igual ao ranking)
-- Pessoa resolvida por NOME (btrim), mesmo grão da agregação do ranking:
-- profiles.full_name → ext UUIDs; + cloud UUIDs via auth_uuid_mapping pros
-- eventos do user_activity_log; + nomes de gestores (grupo gerencial).
--
-- Aditivo: nenhuma função/tabela existente é alterada. Rollback:
--   drop function public.tv_ranking_detalhe(text, text, timestamptz);
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
)
select coalesce(jsonb_agg(item order by ord desc), '[]'::jsonb) from itens;
$function$;

grant execute on function public.tv_ranking_detalhe(text, text, timestamptz) to authenticated;

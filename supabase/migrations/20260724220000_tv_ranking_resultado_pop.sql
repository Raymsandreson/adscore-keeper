-- Ranking: critério `resultado` passa a contar o "Resultado do POP" esperado.
--
-- Antes (20260724190000) contava chegada numa etapa-alvo (lead_stage_history).
-- Agora conta o RESULTADO DO POP: cada board define em settings.resultados +
-- settings.resultado_esperado_id; o lead recebe um resultado (leads.pop_result_id)
-- registrado com autor/tempo em lead_pop_result_history. Conta os que atingiram
-- o esperado NO MÊS, por pessoa. Byte-safe: troca só os CTEs board_kpi/resultado.
--
-- Seguro por padrão: sem resultado_esperado_id configurado, resultado = 0 pra
-- todos → ranking cai em fases/objetivos.
-- Rollback: re-rodar a 20260724190000.
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

do $mig$
declare d text;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text,text)'::regprocedure) into d;

  d := replace(d,
$old$board_kpi as (
  select b.id as board_id, (b.settings->'kpi'->>'stage_id') as stage_id
  from kanban_boards b
  where (b.settings->'kpi'->>'tipo') = 'etapa'
    and coalesce(b.settings->'kpi'->>'stage_id', '') <> ''
),
resultado as (
  select coalesce(m.ext_uuid, h.changed_by) as ext_user,
         count(distinct h.lead_id)::int as resultado
  from lead_stage_history h
  join board_kpi k on k.board_id = h.to_board_id and k.stage_id = h.to_stage
  left join auth_uuid_mapping m on m.cloud_uuid = h.changed_by
  where h.changed_at >= date_trunc('month', now())
  group by 1
),$old$,
$new$board_kpi as (
  select b.id as board_id, (b.settings->>'resultado_esperado_id') as expected
  from kanban_boards b
  where coalesce(b.settings->>'resultado_esperado_id', '') <> ''
),
resultado as (
  select coalesce(m.ext_uuid, h.changed_by) as ext_user,
         count(distinct h.lead_id)::int as resultado
  from lead_pop_result_history h
  join board_kpi k on k.board_id = h.board_id and k.expected = h.to_result
  left join auth_uuid_mapping m on m.cloud_uuid = h.changed_by
  where h.changed_at >= date_trunc('month', now())
  group by 1
),$new$);

  execute d;
end $mig$;

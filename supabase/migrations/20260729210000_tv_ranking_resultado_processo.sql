-- Telão /tv/atividades — a coluna STATUS ESPERADO passa a contar no GRÃO DE
-- PROCESSO, não mais só por lead. Regra do negócio (confirmada jul/2026):
--   - Lead tem status do FUNIL DE VENDAS (comercial). Lead "Fechado" gera um caso.
--   - Caso tem VÁRIOS processos; cada processo tem seu POP e, portanto, seu
--     próprio status (das opções cadastradas naquele POP).
--   - O telão é por TIME. Time de POP: conta os PROCESSOS daquele POP que
--     atingiram o status esperado, por responsável. Time comercial (funil):
--     segue contando o resultado do funil (lead).
--   - Conta no MÊS EM QUE O RESULTADO ACONTECEU (resultado_atingido_data), não
--     quando foi cadastrado/detectado.
--
-- Mudanças (só 2 blocos, via pg_get_functiondef + replace; resto intacto):
--   (1) board_kpi passa a ler resultado_esperado_ids (múltiplos), com fallback
--       pro resultado_esperado_id legado (single).
--   (2) resultado = resultado_lead (funil, como era) + resultado_proc (processo,
--       novo), somados por pessoa.
--
-- Seguro por padrão: board sem esperado configurado => 0 pra todos (comportamento
-- atual). Processo sem status confirmado / sem responsável => não conta.
--
-- Rollback: re-rodar a 20260724230000_pop_result_date.sql (versão vigente da view).
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

do $mig$
declare d text;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text,text)'::regprocedure) into d;

  -- (1) board_kpi: múltiplos esperados (array) com fallback pro single legado.
  d := replace(d,
$old$board_kpi as (
  select b.id as board_id, (b.settings->>'resultado_esperado_id') as expected
  from kanban_boards b
  where coalesce(b.settings->>'resultado_esperado_id', '') <> ''
),$old$,
$new$board_kpi as (
  select b.id as board_id, x.expected
  from kanban_boards b
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(b.settings->'resultado_esperado_ids') = 'array'
              and jsonb_array_length(b.settings->'resultado_esperado_ids') > 0
         then b.settings->'resultado_esperado_ids'
         when coalesce(b.settings->>'resultado_esperado_id','') <> ''
         then jsonb_build_array(b.settings->>'resultado_esperado_id')
         else '[]'::jsonb end
  ) as x(expected)
),$new$);

  -- (2) resultado = lead (funil) + processo (POP), no grão certo.
  d := replace(d,
$old$resultado as (
  select coalesce(m.ext_uuid, h.changed_by) as ext_user,
         count(distinct h.lead_id)::int as resultado
  from lead_pop_result_history h
  join board_kpi k on k.board_id = h.board_id and k.expected = h.to_result
  left join auth_uuid_mapping m on m.cloud_uuid = h.changed_by
  where coalesce(h.effective_date, (h.changed_at at time zone 'America/Sao_Paulo')::date) >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
  group by 1
),$old$,
$new$resultado_lead as (
  select coalesce(m.ext_uuid, h.changed_by) as ext_user,
         count(distinct h.lead_id)::int as resultado
  from lead_pop_result_history h
  join board_kpi k on k.board_id = h.board_id and k.expected = h.to_result
  left join auth_uuid_mapping m on m.cloud_uuid = h.changed_by
  where coalesce(h.effective_date, (h.changed_at at time zone 'America/Sao_Paulo')::date) >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
  group by 1
),
resultado_proc as (
  select p.responsible_user_id as ext_user,
         count(*)::int as resultado
  from lead_processes p
  join board_kpi k on k.board_id::text = p.workflow_id and k.expected = p.resultado_atingido_id
  where p.resultado_atingido_status = 'confirmado'
    and p.responsible_user_id is not null
    and coalesce(p.resultado_atingido_data, (now() at time zone 'America/Sao_Paulo')::date) >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
  group by 1
),
resultado as (
  select ext_user, sum(resultado)::int as resultado
  from (select * from resultado_lead union all select * from resultado_proc) u
  group by 1
),$new$);

  -- Sanidade: se o texto-fonte tiver mudado e os replaces não casarem, aborta
  -- em vez de instalar uma função meio-patcheada.
  if position('resultado_proc as (' in d) = 0 or position('as x(expected)' in d) = 0 then
    raise exception 'Patch do telao nao casou (board_kpi/resultado). Nada aplicado.';
  end if;

  execute d;
end $mig$;

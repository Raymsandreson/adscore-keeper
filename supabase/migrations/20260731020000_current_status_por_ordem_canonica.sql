-- =============================================================================
-- lead_process_current_status: status atual passa a ser o marco mais AVANÇADO
-- na ordem canônica, não o de data mais recente.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Mesmo motivo da 20260731010000: "Distribuído por sorteio" no 2º grau é
-- classificado como peticao_inicial e, sendo a data mais recente, jogava o
-- processo de volta ao começo da linha. Impacto medido: 18 dos 89 processos
-- com marco mudam de status — todos para um marco mais avançado.
--
-- A view não é consultada pelo front (nenhum uso em src/), só por RPCs desta
-- feature; o alinhamento evita que a próxima tela a usar herde o viés.
--
-- Rollback: recriar a view com a ordenação original
--   order by pm.process_id, pm.data_movimentacao desc, pm.created_at desc
--   (ver 20260701124949_25152c99-611f-4c95-8f55-90081166beca.sql)
-- =============================================================================

create or replace view public.lead_process_current_status as
select distinct on (pm.process_id)
  pm.process_id,
  pm.id as movement_id,
  pm.tipo_movimentacao,
  pm.marco_ordem,
  pm.data_movimentacao,
  pm.valor_indenizacao_fixado,
  pm.link_decisao,
  pm.descricao,
  pm.numero_cnj,
  pm.case_id,
  pm.lead_id
from public.process_movements pm
order by pm.process_id, pm.marco_ordem desc nulls last, pm.data_movimentacao desc, pm.created_at desc;

comment on view public.lead_process_current_status is
  'Status atual = marco mais AVANÇADO na ordem canônica (marco_ordem), empate resolvido pela data mais recente. Até 30/07/2026 usava só a data.';

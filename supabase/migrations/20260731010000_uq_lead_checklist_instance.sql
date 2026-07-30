-- =============================================================================
-- Instância de checklist por lead/fase/objetivo: uma só.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz (aplicado via MCP em 30/07/2026).
--
-- Motivo: createLeadInstances era read-then-insert sem constraint — duas abas (ou
-- o loop por todas as fases do ProcessDetailSheet junto com outro componente)
-- passavam pelo SELECT antes de qualquer INSERT e ambas inseriam. Medição antes
-- da limpeza: 3.893 grupos duplicados, 7.336 linhas excedentes.
--
-- Pré-requisito já publicado: insertChecklistInstancesTolerant (commit c49b55f26)
-- — o insert em lote é uma transação, então sem o helper uma colisão derrubaria
-- o lote inteiro e as instâncias legítimas se perderiam.
--
-- Limpeza executada antes de criar o índice (nesta ordem):
--   1. backup completo em zz_lci_bkp_20260730 (29.290 linhas)
--   2. marcações das órfãs migradas para o objetivo vivo de mesmo nome (13 linhas)
--   3. consolidação das marcações no keeper de cada grupo (0 — nenhuma duplicata
--      tinha marcação que o keeper já não tivesse)
--   4. user_activity_log repontado para o keeper (254 logs, backup em
--      zz_ual_repoint_bkp_20260730) — senão tv_atividades_ranking perderia
--      objetivos concluídos de 6 pessoas no join por entity_id
--   5. is_completed recalculado nos keepers (4 linhas)
--   6. delete das 7.336 excedentes (keeper = mais passos marcados; empate pelo
--      created_at mais antigo)
--
-- Rollback:
--   drop index concurrently if exists public.uq_lead_checklist_instance_lead_board_stage_template;
--   -- dados: zz_lci_bkp_20260730 e zz_ual_repoint_bkp_20260730 têm o estado anterior.
-- =============================================================================

create unique index concurrently if not exists uq_lead_checklist_instance_lead_board_stage_template
  on public.lead_checklist_instances (lead_id, board_id, stage_id, checklist_template_id);

comment on index public.uq_lead_checklist_instance_lead_board_stage_template is
  'Uma instância por lead+POP+fase+objetivo. Fecha a corrida do createLeadInstances (ver insertChecklistInstancesTolerant, que tolera o 23505).';

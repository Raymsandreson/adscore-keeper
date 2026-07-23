-- Sequência de grupos compartilhada entre boards.
-- Caso de uso: board "Auxílio Acidente" nomeia grupos "Lead NNNN" e o fluxo PREV
-- (board BPC/prev) nomeia "PREVNNNN" — as equipes usam UMA numeração humana única.
-- Sem isso, cada board tem contador próprio e os números colidem/duplicam.
--
-- sequence_source_board_id: board cujo closed_current_sequence é o contador
--   atômico compartilhado (reserve_closed_sequence roda na linha dele).
-- sequence_scan_prefixes: prefixos ADICIONAIS de nome de grupo considerados ao
--   medir o "último número usado" no snapshot uazapi / lead_whatsapp_groups / leads.
--
-- Idempotente (IF NOT EXISTS). Rollback: DROP COLUMN das duas colunas.
ALTER TABLE public.board_group_settings
  ADD COLUMN IF NOT EXISTS sequence_source_board_id uuid REFERENCES public.kanban_boards(id),
  ADD COLUMN IF NOT EXISTS sequence_scan_prefixes text[];

COMMENT ON COLUMN public.board_group_settings.sequence_source_board_id IS
  'Board cujo closed_current_sequence serve de contador atômico compartilhado para a numeração de grupos deste board (null = contador próprio).';
COMMENT ON COLUMN public.board_group_settings.sequence_scan_prefixes IS
  'Prefixos adicionais de nome de grupo considerados ao medir o último número usado (ex: {PREV} num board que nomeia grupos "Lead N").';

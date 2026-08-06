-- Exclusao de caso e soft delete (deleted_at), mas o UNIQUE em case_number era
-- total: o numero seguia reservado por um caso invisivel e nao dava pra
-- recadastrar. Foi o que travou o PREV 77 em 06/08/2026 — o numero morava num
-- card de lead duplicado do mesmo cliente, apagado depois pra tentar liberar.
--
-- Havia DUAS constraints identicas (legal_cases_case_number_key e
-- legal_cases_case_number_unique), ambas UNIQUE (case_number). Trocamos as duas
-- por um unico indice parcial: o numero passa a ser exclusivo apenas entre os
-- casos vivos, e voltar a ficar livre quando o caso e excluido.
--
-- Ordem importa: o indice novo nasce ANTES do drop, pra tabela nunca ficar sem
-- protecao contra numero duplicado.
--
-- Verificado antes de aplicar: nenhum ON CONFLICT (case_number) no front, nas
-- edge functions, no railway-server ou em funcoes do banco — um indice parcial
-- nao serve de arbitro pra upsert cujo predicado nao bate.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS legal_cases_case_number_active_uniq
    ON public.legal_cases (case_number)
 WHERE deleted_at IS NULL;

ALTER TABLE public.legal_cases
  DROP CONSTRAINT IF EXISTS legal_cases_case_number_key,
  DROP CONSTRAINT IF EXISTS legal_cases_case_number_unique;

-- Rollback:
--   ALTER TABLE public.legal_cases
--     ADD CONSTRAINT legal_cases_case_number_key UNIQUE (case_number);
--   DROP INDEX CONCURRENTLY IF EXISTS legal_cases_case_number_active_uniq;
-- (so volta se nao houver numero repetido entre vivos e excluidos)

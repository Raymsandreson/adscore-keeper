-- Soft-delete para CASOS e PROCESSOS + FKs não-destrutivas
-- Banco EXTERNO (kmedldlepwiityjsdahz).
--
-- Contexto (investigação 15/07/2026):
--   legal_cases e lead_processes só tinham DELETE FÍSICO. O botão "Excluir caso"
--   apagava a linha e o ON DELETE CASCADE destruía TODOS os lead_processes e
--   process_movements do caso — perda irreversível (não há tabela de auditoria).
--   Além disso, hard-delete de um lead orfanava o caso (legal_cases.lead_id -> NULL,
--   SET NULL) e DESTRUÍA os processos (lead_processes.lead_id ON DELETE CASCADE).
--   Estado em 15/07: 41 casos órfãos (lead_id NULL), incl. CASO 398 (Charles x Porto Rico).
--
-- Este migration deixa impossível PERDER caso/processo por clique ou por delete de lead:
--   1. Adiciona deleted_at em legal_cases e lead_processes (soft-delete).
--   2. lead_processes.case_id FK: ON DELETE CASCADE -> SET NULL (case_id já é nullable).
--   3. lead_processes.lead_id FK: ON DELETE CASCADE -> SET NULL (exige DROP NOT NULL).
--      Assim, mesmo um hard-delete de lead apenas DESVINCULA o processo (recuperável),
--      em vez de apagá-lo.
--   4. Índices parciais WHERE deleted_at IS NULL p/ as buscas por lead_id/case_id.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ ORDEM DE ROLLOUT (obrigatória): aplicar ESTE migration ANTES de publicar   │
-- │ o frontend. O frontend passa a filtrar .is('deleted_at', null) e a fazer   │
-- │ soft-delete — se rodar antes da coluna existir, as queries retornam 400.   │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Tabelas pequenas (legal_cases ~1.573, lead_processes ~1.430) -> índice não-CONCURRENT
-- dentro de transação é rápido e seguro.
--
-- Rollback ao final do arquivo.

BEGIN;

-- 1) Colunas de soft-delete (aditivas; linhas existentes ficam com NULL = visíveis)
ALTER TABLE public.legal_cases    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.lead_processes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2) FK case_id: CASCADE -> SET NULL
ALTER TABLE public.lead_processes DROP CONSTRAINT IF EXISTS lead_processes_case_id_fkey;
ALTER TABLE public.lead_processes
  ADD CONSTRAINT lead_processes_case_id_fkey
  FOREIGN KEY (case_id) REFERENCES public.legal_cases(id) ON DELETE SET NULL;

-- 3) FK lead_id: CASCADE -> SET NULL (relaxa NOT NULL para permitir o desvínculo)
ALTER TABLE public.lead_processes ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.lead_processes DROP CONSTRAINT IF EXISTS lead_processes_lead_id_fkey;
ALTER TABLE public.lead_processes
  ADD CONSTRAINT lead_processes_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

-- 4) Índices parciais p/ as listagens (que passam a filtrar deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_legal_cases_lead_id_active
  ON public.legal_cases(lead_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_processes_case_id_active
  ON public.lead_processes(case_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_processes_lead_id_active
  ON public.lead_processes(lead_id) WHERE deleted_at IS NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (reverte tudo; rode o frontend antigo primeiro se já tiver publicado):
--
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_legal_cases_lead_id_active;
-- DROP INDEX IF EXISTS public.idx_lead_processes_case_id_active;
-- DROP INDEX IF EXISTS public.idx_lead_processes_lead_id_active;
--
-- ALTER TABLE public.lead_processes DROP CONSTRAINT IF EXISTS lead_processes_case_id_fkey;
-- ALTER TABLE public.lead_processes
--   ADD CONSTRAINT lead_processes_case_id_fkey
--   FOREIGN KEY (case_id) REFERENCES public.legal_cases(id) ON DELETE CASCADE;
--
-- -- (só volte NOT NULL se não houver linhas com lead_id NULL)
-- ALTER TABLE public.lead_processes DROP CONSTRAINT IF EXISTS lead_processes_lead_id_fkey;
-- ALTER TABLE public.lead_processes
--   ADD CONSTRAINT lead_processes_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
-- -- ALTER TABLE public.lead_processes ALTER COLUMN lead_id SET NOT NULL;
--
-- ALTER TABLE public.legal_cases    DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE public.lead_processes DROP COLUMN IF EXISTS deleted_at;
-- COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────

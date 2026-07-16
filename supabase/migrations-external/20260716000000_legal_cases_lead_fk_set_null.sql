-- Migração: legal_cases.lead_id  ON DELETE CASCADE -> ON DELETE SET NULL
--
-- Contexto: a migração 20260715000000 corrigiu as FKs de lead_processes (case_id, lead_id)
-- para SET NULL, mas legal_cases.lead_id continuou CASCADE. Prova em produção (16/07/2026):
-- hard-delete de um lead DESTRÓI o legal_cases vinculado. Este é o vetor do evento de
-- 10/06/2026 ("zerar a central Trabalhista"), que destruiu ~141 processos + seus casos.
--
-- Efeito: SOMENTE altera a definição da FK. 0 linhas de dado alteradas.
-- A coluna legal_cases.lead_id JÁ é nullable (31 casos ativos com lead_id null em 16/07),
-- portanto não é necessário ALTER COLUMN ... DROP NOT NULL.
-- Idempotente: pode rodar 2x (dropa a FK atual em lead_id, seja qual for, e recria SET NULL).
--
-- ROLLBACK (voltar ao CASCADE) no rodapé.

BEGIN;

DO $$
DECLARE
  cname text;
BEGIN
  -- acha o nome da FK que sai de legal_cases.lead_id (independe do nome)
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.legal_cases'::regclass
    AND con.contype = 'f'
    AND 'lead_id' = ANY (ARRAY(
      SELECT a.attname
      FROM pg_attribute a
      WHERE a.attrelid = con.conrelid
        AND a.attnum = ANY (con.conkey)
    ));

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.legal_cases DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.legal_cases
  ADD CONSTRAINT legal_cases_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

COMMIT;

-- ============================================================================
-- ROLLBACK (executar só se precisar reverter para o comportamento antigo):
-- BEGIN;
-- ALTER TABLE public.legal_cases DROP CONSTRAINT legal_cases_lead_id_fkey;
-- ALTER TABLE public.legal_cases
--   ADD CONSTRAINT legal_cases_lead_id_fkey
--   FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
-- COMMIT;
-- ============================================================================

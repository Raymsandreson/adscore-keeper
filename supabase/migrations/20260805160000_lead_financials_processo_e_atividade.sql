-- Despesa/receita lançada direto no PROCESSO ou dentro da ATIVIDADE.
--
-- Banco: Supabase EXTERNO (kmedldlepwiityjsdahz) — é onde `lead_financials`
-- realmente vive, junto com leads/legal_cases/lead_processes/lead_activities.
--
-- Hoje `lead_financials` só tem `lead_id` + `case_id`, então o único lugar que
-- registra dinheiro é a aba Financeiro da ficha do lead. Estas duas colunas
-- passam a permitir:
--   * lançamento feito na aba Financeiro do processo  -> process_id preenchido
--   * lançamento feito de dentro de uma atividade     -> activity_id preenchido,
--     herdando lead_id/case_id/process_id do vínculo da própria atividade
--     (é isso que faz a despesa da atividade "subir" para o processo, o caso e o
--      lead sem nenhuma consulta extra).
--
-- ON DELETE SET NULL nas duas FKs, seguindo `lead_financials_case_id_fkey`:
-- apagar processo ou atividade não pode apagar o dinheiro já lançado — o valor
-- foi gasto de qualquer jeito e continua valendo para o caso e para o lead.
--
-- Índices comuns (não CONCURRENTLY) porque a tabela é pequena. São os filtros
-- novos das abas, então sem eles a consulta vira seq scan quando ela crescer.
--
-- Rollback (reversível em <1min, sem perda de dado pré-existente):
--   DROP INDEX IF EXISTS public.idx_lead_financials_process_id;
--   DROP INDEX IF EXISTS public.idx_lead_financials_activity_id;
--   ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS process_id;
--   ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS activity_id;

ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS process_id  uuid,
  ADD COLUMN IF NOT EXISTS activity_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_financials_process_id_fkey'
  ) THEN
    ALTER TABLE public.lead_financials
      ADD CONSTRAINT lead_financials_process_id_fkey
      FOREIGN KEY (process_id) REFERENCES public.lead_processes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_financials_activity_id_fkey'
  ) THEN
    ALTER TABLE public.lead_financials
      ADD CONSTRAINT lead_financials_activity_id_fkey
      FOREIGN KEY (activity_id) REFERENCES public.lead_activities(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.lead_financials.process_id IS
  'Processo (lead_processes) ao qual o lançamento pertence.';
COMMENT ON COLUMN public.lead_financials.activity_id IS
  'Atividade (lead_activities) de onde o lançamento foi criado.';

CREATE INDEX IF NOT EXISTS idx_lead_financials_process_id
  ON public.lead_financials(process_id) WHERE process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_financials_activity_id
  ON public.lead_financials(activity_id) WHERE activity_id IS NOT NULL;

-- Despesa/receita lançada direto no PROCESSO ou dentro da ATIVIDADE.
--
-- Hoje `lead_financials` só tem `lead_id` + `case_id`, então o único lugar que
-- registra dinheiro é a aba Financeiro da ficha do lead. Estas duas colunas
-- passam a permitir:
--   * lançamento feito na aba Financeiro do processo  -> process_id preenchido
--   * lançamento feito de dentro de uma atividade     -> activity_id preenchido,
--     herdando lead_id/case_id/process_id do vínculo da própria atividade
--     (é isso que faz a despesa da atividade "subir" para o processo, o caso e o lead
--      sem nenhuma consulta extra).
--
-- SEM FOREIGN KEY, de propósito:
-- `lead_processes` e `lead_activities` são tabelas de NEGÓCIO e vivem no Supabase
-- Externo (ver src/integrations/supabase/db-routing.ts). `lead_financials` é
-- consultada pelo client Cloud. Criar FK aqui apontando para a cópia-fantasma
-- dessas tabelas no Cloud faria todo INSERT falhar com violação de FK — que é
-- exatamente o sintoma descrito no db-routing. A integridade fica no app.
--
-- Índice comum (não CONCURRENTLY) porque a tabela é pequena: o filtro novo é
-- sempre por process_id ou activity_id, então os dois índices são obrigatórios
-- para a aba não virar seq scan quando a tabela crescer.
--
-- Rollback (reversível em <1min, sem perda de dado pré-existente):
--   DROP INDEX IF EXISTS public.idx_lead_financials_process_id;
--   DROP INDEX IF EXISTS public.idx_lead_financials_activity_id;
--   ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS process_id;
--   ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS activity_id;

ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS process_id  uuid,
  ADD COLUMN IF NOT EXISTS activity_id uuid;

COMMENT ON COLUMN public.lead_financials.process_id IS
  'Processo (lead_processes.id, banco Externo) ao qual o lançamento pertence. Sem FK: cross-database.';
COMMENT ON COLUMN public.lead_financials.activity_id IS
  'Atividade (lead_activities.id, banco Externo) de onde o lançamento foi criado. Sem FK: cross-database.';

CREATE INDEX IF NOT EXISTS idx_lead_financials_process_id
  ON public.lead_financials(process_id) WHERE process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_financials_activity_id
  ON public.lead_financials(activity_id) WHERE activity_id IS NOT NULL;

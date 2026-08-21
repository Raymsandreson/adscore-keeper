-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NÃO no Cloud
-- ============================================================================
-- APLICADA em 20/08/2026 via MCP. Mantida aqui como registro do schema.
-- ============================================================================
-- De QUEM veio (ou para quem foi) o dinheiro do lançamento.
--
-- O extrato já dizia de que ESPÉCIE é o dinheiro (honorário contratual,
-- sucumbencial, cota do cliente) e de quem é o TITULAR (escritório, cliente,
-- parceiro). O que faltava era a PESSOA: num caso de família com cinco
-- herdeiros, "entrou R$ 1.125,30 de cota do cliente" não diz de qual deles.
--
-- Duas colunas porque são duas perguntas com fontes diferentes:
--
--   contact_id  a PESSOA no CRM (`contacts`). Vale em qualquer objeto — lead,
--               caso, processo, atividade — e é por ela que se pergunta
--               "quanto já entrou desta pessoa". FK com ON DELETE SET NULL,
--               seguindo as outras: apagar o contato não pode apagar o
--               dinheiro que já entrou.
--
--   parte_id    a PARTE do processo em `jm_partes`, que é onde mora a cota e o
--               honorário CALCULADOS daquela parte. É a ponte entre o que ela
--               tem a receber e o que de fato entrou.
--
-- SEM FK em `parte_id`, de propósito: `jm_partes` é tabela IMPORTADA da
-- planilha e reimportada periodicamente. Uma FK faria a reimportação ou falhar
-- ou zerar os vínculos em silêncio. Por isso vem acompanhada de `parte_nome`,
-- um RETRATO do nome no momento do lançamento: mesmo que a linha da planilha
-- mude ou suma, o extrato continua sabendo dizer de quem era aquele dinheiro.
--
-- As 14 linhas existentes ficam com as três nulas — "parte não informada", que
-- é a verdade sobre elas. Nenhum backfill: adivinhar de quem era o dinheiro é
-- exatamente o erro que estas colunas existem para evitar.
--
-- Rollback (reversível em <1min, sem perda de dado pré-existente):
--   DROP INDEX IF EXISTS public.idx_lead_financials_contact_id;
--   DROP INDEX IF EXISTS public.idx_lead_financials_parte_id;
--   ALTER TABLE public.lead_financials
--     DROP COLUMN IF EXISTS contact_id,
--     DROP COLUMN IF EXISTS parte_id,
--     DROP COLUMN IF EXISTS parte_nome;

ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS contact_id uuid,
  ADD COLUMN IF NOT EXISTS parte_id   text,
  ADD COLUMN IF NOT EXISTS parte_nome text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_financials_contact_id_fkey'
  ) THEN
    ALTER TABLE public.lead_financials
      ADD CONSTRAINT lead_financials_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.lead_financials.contact_id IS
  'Pessoa de quem veio (ou para quem foi) o dinheiro, em contacts.';
COMMENT ON COLUMN public.lead_financials.parte_id IS
  'Parte do processo em jm_partes. Sem FK: jm_partes e reimportada da planilha.';
COMMENT ON COLUMN public.lead_financials.parte_nome IS
  'Retrato do nome da parte no momento do lancamento, para o extrato sobreviver a reimportacao.';

CREATE INDEX IF NOT EXISTS idx_lead_financials_contact_id
  ON public.lead_financials(contact_id) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_financials_parte_id
  ON public.lead_financials(parte_id) WHERE parte_id IS NOT NULL;

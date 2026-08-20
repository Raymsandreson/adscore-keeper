-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NÃO no Cloud
-- ============================================================================
-- APLICADA em 20/08/2026 via MCP. Mantida aqui como registro do schema.
-- ============================================================================
-- O comprovante do lançamento.
--
-- Lançamento sem comprovante é palavra contra palavra: seis meses depois
-- ninguém lembra se aquele PIX de R$ 1.125,30 existiu. O arquivo em si vive no
-- bucket `invoices` (Storage do Cloud, o mesmo que o financeiro da empresa já
-- usa para nota fiscal) — aqui fica só a URL, porque Storage e Postgres são
-- bancos diferentes e duplicar o binário na tabela não serve a ninguém.
--
-- É a URL que também alimenta a leitura por IA: a mesma imagem que o humano
-- confere é a que o modelo lê para propor valor, data e categoria.
--
-- Rollback (reversível em <1min):
--   ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS receipt_url;

ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS receipt_url text;

COMMENT ON COLUMN public.lead_financials.receipt_url IS
  'URL do comprovante no bucket invoices (Storage do Cloud). NULL = sem comprovante.';

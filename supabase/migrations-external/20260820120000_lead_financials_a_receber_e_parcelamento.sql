-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NÃO no Cloud
-- ============================================================================
-- APLICADA em 20/08/2026 via MCP. Mantida aqui como registro do schema.
-- ============================================================================
-- O lançamento manual passa a saber se o dinheiro JÁ entrou, e a nascer
-- parcelado.
--
-- O PROBLEMA: `lead_financials` só tinha `entry_date`. Quem é "a receber" e
-- quem já é caixa vinha do TEXTO da categoria (`classificarLancamento` testa
-- `categoria ILIKE '%a receber%'`), e nenhuma das 12 categorias do formulário
-- manual tem essas palavras. Resultado: honorário lançado com vencimento em
-- 25/08/2026 entrava como caixa recebido no mesmo instante, inflando o
-- "Honorário contratual" do processo com dinheiro que ninguém pagou.
--
-- A REGRA, igual à do vocabulário (src/lib/lancamentoCategorias.ts):
--   entry_date  = VENCIMENTO (quando o dinheiro está previsto para entrar/sair)
--   settled_at  = quando ENTROU de fato. NULL = ainda é recebível.
-- É o MESMO lançamento mudando de estado, nunca dois eventos — somar "a
-- receber" com "recebido" contaria o dinheiro duas vezes.
--
-- Vencido não vira caixa sozinho: passou a data e `settled_at` continua NULL,
-- a linha é VENCIDO e fica fora do caixa até alguém baixar. Data que passa não
-- é prova de pagamento.
--
-- PARCELAMENTO: um acordo em 12x nasce como 12 linhas, uma por vencimento,
-- amarradas por `parcela_grupo`. Cada parcela é baixada por si (uma pode
-- atrasar e a seguinte cair em dia), e o grupo permite mostrar "3/12" e apagar
-- o plano inteiro sem caçar linha por linha.
--
-- BACKFILL: as 11 linhas existentes foram criadas quando "data" queria dizer
-- "aconteceu". As 10 com data <= hoje recebem `settled_at = entry_date` e
-- continuam exatamente como estão na tela. A de 25/08/2026 (R$ 2,00 de
-- honorário contratual) fica com `settled_at` NULL — que é o conserto do bug.
--
-- Índice parcial só do que está em aberto: a pergunta cara é "o que ainda
-- tenho a receber", e ela não olha o histórico já baixado.
--
-- Rollback (reversível em <1min, sem perda de dado pré-existente):
--   ALTER TABLE public.lead_financials
--     DROP COLUMN IF EXISTS settled_at,
--     DROP COLUMN IF EXISTS parcela_grupo,
--     DROP COLUMN IF EXISTS parcela_n,
--     DROP COLUMN IF EXISTS parcela_de;
--   DROP INDEX IF EXISTS public.idx_lead_financials_a_receber;
--   DROP INDEX IF EXISTS public.idx_lead_financials_parcela_grupo;

ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS settled_at    date,
  ADD COLUMN IF NOT EXISTS parcela_grupo uuid,
  ADD COLUMN IF NOT EXISTS parcela_n     integer,
  ADD COLUMN IF NOT EXISTS parcela_de    integer;

COMMENT ON COLUMN public.lead_financials.entry_date IS
  'Vencimento: quando o dinheiro está previsto para entrar ou sair.';
COMMENT ON COLUMN public.lead_financials.settled_at IS
  'Quando o dinheiro entrou/saiu de fato. NULL = ainda é recebível (a receber, ou vencido se entry_date já passou).';
COMMENT ON COLUMN public.lead_financials.parcela_grupo IS
  'Mesmo plano de parcelamento. NULL = lançamento avulso.';
COMMENT ON COLUMN public.lead_financials.parcela_n IS
  'Número desta parcela dentro do plano (1..parcela_de).';
COMMENT ON COLUMN public.lead_financials.parcela_de IS
  'Total de parcelas do plano.';

-- Linhas antigas: "data" queria dizer "aconteceu". Mantém a tela como está.
UPDATE public.lead_financials
   SET settled_at = entry_date
 WHERE settled_at IS NULL
   AND entry_date <= CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_lead_financials_a_receber
  ON public.lead_financials(entry_date)
  WHERE settled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_financials_parcela_grupo
  ON public.lead_financials(parcela_grupo)
  WHERE parcela_grupo IS NOT NULL;

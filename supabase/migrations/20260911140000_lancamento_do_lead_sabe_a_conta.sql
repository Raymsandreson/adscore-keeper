-- De QUAL conta/cartão saiu (ou entrou) o dinheiro de um lançamento do lead.
--
-- O problema: `lead_financials` guardava `payment_method` (livre, e VAZIO em
-- todas as 43 linhas em 11/09/2026 — o campo existia no estado do formulário e
-- nunca foi para a tela) e NENHUMA referência de conta. Sem isso a conciliação
-- (`ConciliarLancamentoDialog`) precisa varrer conta + cartão inteiros e
-- oferecer tudo o que couber na janela de dias: quem lançou já sabia que foi no
-- cartão final 1234, e essa informação se perdia entre o cadastro e a conferência.
--
-- `cost_account_id` aponta para `cost_accounts` (PESSOAL, ABRACI, WHATSJUD,
-- PRUDÊNCIO CAPITAL, PRUDÊNCIO ADVOGADOS) — a MESMA tabela que
-- `card_assignments.cost_account_id` e `transaction_category_overrides.cost_account_id`
-- já usam. Conta nova aqui seria um segundo vocabulário de conta na mesma casa.
--
-- `card_last_digits` é TEXT porque é assim em `card_assignments` e em
-- `credit_card_transactions` — é o que casa a despesa com a linha do extrato.
-- Guardar o id do `card_assignments` casaria com o cadastro, não com o extrato,
-- e o extrato é o lado que precisa fechar.
--
-- Nenhuma linha existente é reescrita: as duas colunas nascem NULL, e lançamento
-- sem conta continua se comportando exatamente como antes (conciliação abre com
-- o extrato inteiro).
--
-- ROLLBACK (< 1 min, sem perda do que já existia):
--   ALTER TABLE public.lead_financials
--     DROP COLUMN IF EXISTS cost_account_id,
--     DROP COLUMN IF EXISTS card_last_digits;

ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS cost_account_id UUID
    REFERENCES public.cost_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS card_last_digits TEXT;

COMMENT ON COLUMN public.lead_financials.cost_account_id IS
  'Conta que pagou/recebeu (cost_accounts). NULL = nao informado. Mesma tabela de card_assignments.cost_account_id.';

COMMENT ON COLUMN public.lead_financials.card_last_digits IS
  'Ultimos 4 digitos do cartao usado, quando payment_method e cartao. Casa com credit_card_transactions.card_last_digits na conciliacao.';

-- Filtro "o que esta conta pagou". Parcial: a esmagadora maioria das linhas é
-- NULL e continuará sendo (lançamento antigo não tem conta). Tabela com 43
-- linhas — índice normal, sem CONCURRENTLY (que não roda dentro de migration
-- transacionada). Se passar de centenas de milhares, índice novo aqui exige
-- CONCURRENTLY fora de transação.
CREATE INDEX IF NOT EXISTS idx_lead_financials_cost_account
  ON public.lead_financials (cost_account_id)
  WHERE cost_account_id IS NOT NULL;

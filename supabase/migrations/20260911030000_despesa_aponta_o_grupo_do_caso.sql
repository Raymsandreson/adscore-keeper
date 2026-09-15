-- Limite de gasto por grupo de WhatsApp (o caso) e por cliente.
--
-- `limit_unit` em `expense_categories` é TEXT livre, sem CHECK (conferido no
-- Externo em 11/09/2026), então as unidades novas `per_whatsapp_group` e
-- `per_client` não pedem nada aqui.
--
-- O que falta é a despesa saber A QUAL CASO ela pertence. Hoje o vínculo é só
-- `lead_id`/`contact_id`, e 5 dos 2.689 leads com grupo têm mais de um grupo —
-- nesses a dedução lead -> grupo é ambígua. Sem esta coluna, a despesa desses
-- leads não teria como entrar na conta do caso certo (vira pendência na aba
-- Caso/Cliente da Análise de Limites).
--
-- Coluna nula por padrão: toda despesa existente continua deduzindo o grupo
-- pelo lead, exatamente como antes. Nada é reescrito.
--
-- ROLLBACK (testado, < 5 min, sem perda do que já existia antes):
--   ALTER TABLE public.transaction_category_overrides DROP COLUMN IF EXISTS group_jid;

ALTER TABLE public.transaction_category_overrides
  ADD COLUMN IF NOT EXISTS group_jid TEXT DEFAULT NULL;

COMMENT ON COLUMN public.transaction_category_overrides.group_jid IS
  'Grupo de WhatsApp (o caso) escolhido a mao para esta despesa. NULL = deduzir pelo lead/contato. Ver src/lib/limitesPorVinculo.ts';

-- O relatório filtra as despesas de um grupo; sem índice seria seq scan na
-- tabela inteira. Parcial porque a esmagadora maioria das linhas é NULL.
-- Tabela com 86 linhas em 11/09/2026 — índice normal, sem CONCURRENTLY (que
-- nem roda dentro de migration transacionada). Se a tabela crescer para
-- centenas de milhares, criar índice novo aqui passa a exigir CONCURRENTLY.
CREATE INDEX IF NOT EXISTS idx_transaction_overrides_group_jid
  ON public.transaction_category_overrides (group_jid)
  WHERE group_jid IS NOT NULL;

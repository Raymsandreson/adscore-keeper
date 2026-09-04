-- A autoria passa a casar pelo ID DA MENSAGEM, não pelo par dono+id.
--
-- Evidência (04/09/2026, primeiras 11 autorias gravadas em produção):
--   * casando por `external_message_id` inteiro:            5 de 11
--   * casando só pelo id da mensagem (parte depois do ':'): 9 de 11
--
-- Por quê: o `external_message_id` da UazAPI é `<número do dono>:<id da
-- mensagem>`, e o prefixo é de QUEM REGISTROU a linha. Numa conversa de grupo o
-- mesmo id (`3EB038735A06DAD3F89D4E`) aparece uma vez por instância que está no
-- grupo, cada uma com o seu prefixo — a edge de envio grava com o prefixo da
-- instância remetente, e a linha que a tela lê pode ter sido gravada por outra.
-- O id da mensagem, sozinho, é o que as duas pontas têm em comum.
--
-- Coluna GERADA de propósito: derivada do valor que já está na linha, não pode
-- divergir dele e não exige nada de quem escreve (a edge segue gravando só o
-- `external_message_id`).
--
-- Rollback: ALTER TABLE public.whatsapp_message_authors DROP COLUMN wa_message_id;

ALTER TABLE public.whatsapp_message_authors
  ADD COLUMN IF NOT EXISTS wa_message_id text
  GENERATED ALWAYS AS (
    CASE
      WHEN position(':' in external_message_id) > 0
        THEN split_part(external_message_id, ':', 2)
      ELSE external_message_id
    END
  ) STORED;

-- É por esta coluna que a tela busca a autoria da página de mensagens aberta.
CREATE INDEX IF NOT EXISTS idx_wa_message_authors_wa_message_id
  ON public.whatsapp_message_authors (wa_message_id);

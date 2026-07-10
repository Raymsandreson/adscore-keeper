-- Marca qual polo do processo é o NOSSO cliente (parte que o escritório representa).
-- Usado para extrair o primeiro nome do cliente na saudação da mensagem, em vez
-- de assumir sempre o polo ATIVO (erra quando o escritório atua na defesa).
-- Rollback: ALTER TABLE public.lead_processes DROP COLUMN IF EXISTS cliente_polo;
ALTER TABLE public.lead_processes
  ADD COLUMN IF NOT EXISTS cliente_polo text
  CHECK (cliente_polo IN ('ATIVO','PASSIVO') OR cliente_polo IS NULL);

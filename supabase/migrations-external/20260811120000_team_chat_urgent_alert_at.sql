-- Paridade do chat interno da ficha (team_chat_messages) com o chat direto:
-- "reenviar como urgente" precisa registrar QUANDO o alerta foi reenviado, para
-- o app distinguir um re-alerta recente de qualquer outro UPDATE na linha.
-- Coluna nullable → ADD COLUMN é metadata-only (PG11+), sem reescrever linhas.

ALTER TABLE public.team_chat_messages
  ADD COLUMN IF NOT EXISTS urgent_alert_at timestamptz;

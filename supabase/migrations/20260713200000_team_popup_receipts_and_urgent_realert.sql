-- Chat interno (Supabase Externo):
-- 1. urgent_alert_at: "reenviar como urgente" — UPDATE dispara popup de novo no destinatário
-- 2. team_popup_receipts: destinatário fechou o popup sem responder → avisa quem enviou

ALTER TABLE public.team_messages
  ADD COLUMN IF NOT EXISTS urgent_alert_at timestamptz;

CREATE TABLE IF NOT EXISTS public.team_popup_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  message_id uuid,
  dismissed_by uuid NOT NULL,
  dismissed_by_name text,
  notify_user_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'dismissed',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mesmo padrão de RLS das demais tabelas do chat da equipe (team_messages_authenticated_all)
ALTER TABLE public.team_popup_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_popup_receipts_authenticated_all ON public.team_popup_receipts;
CREATE POLICY team_popup_receipts_authenticated_all ON public.team_popup_receipts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_team_popup_receipts_notify
  ON public.team_popup_receipts (notify_user_id, created_at DESC);

-- Realtime: o remetente escuta INSERTs filtrando por notify_user_id
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_popup_receipts;

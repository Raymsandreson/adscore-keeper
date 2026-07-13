-- Chat interno: flag de urgência em mensagens da equipe (Supabase Externo)
-- Popup do destinatário fica vermelho, persistente e toca alerta sonoro.
ALTER TABLE public.team_messages
  ADD COLUMN IF NOT EXISTS is_urgent boolean NOT NULL DEFAULT false;

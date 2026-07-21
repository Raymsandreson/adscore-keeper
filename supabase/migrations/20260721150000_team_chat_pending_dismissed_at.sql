-- Chat da Equipe: "✓ Resolvido" nas pendências da lista de conversas.
-- Quando o usuário dispensa a pendência (responder/aguardando), gravamos o
-- momento aqui; a pendência só volta se chegar mensagem mais nova que isso.
-- Aplicada no Supabase Externo (kmedldlepwiityjsdahz) em 21/07/2026.
ALTER TABLE public.team_conversation_members
  ADD COLUMN IF NOT EXISTS pending_dismissed_at timestamptz;

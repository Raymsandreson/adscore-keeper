-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NÃO no Cloud
-- ============================================================================
-- Adiciona campo "Nome do cliente" (override do nome do lead) em lead_activities.
-- Usado para personalizar templates de mensagem do WhatsApp sem depender do
-- lead_name vinculado.
-- ============================================================================

ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS client_name_override TEXT NULL;

COMMENT ON COLUMN public.lead_activities.client_name_override IS
  'Override manual do nome do cliente para uso em templates de mensagem. Se NULL, usa lead_name.';

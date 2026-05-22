ALTER TABLE public.agent_filter_settings
ADD COLUMN IF NOT EXISTS audience_mode TEXT NOT NULL DEFAULT 'both'
CHECK (audience_mode IN ('ctwa_only', 'outbound_only', 'both'));

COMMENT ON COLUMN public.agent_filter_settings.audience_mode IS
'Define quem o agente atende: ctwa_only (apenas leads de anúncio CTWA), outbound_only (apenas leads manuais/outbound), both (todos — padrão). Quando outbound_only ou both, os filtros lead_status_board_ids e lead_status_filter funcionam como fallback para leads não-CTWA.';
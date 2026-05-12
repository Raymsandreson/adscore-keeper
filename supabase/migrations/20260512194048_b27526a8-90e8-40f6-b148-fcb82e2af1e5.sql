ALTER TABLE public.whatsapp_conversation_shares
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_wa_shares_shared_with_unack
  ON public.whatsapp_conversation_shares (shared_with)
  WHERE acknowledged_at IS NULL;
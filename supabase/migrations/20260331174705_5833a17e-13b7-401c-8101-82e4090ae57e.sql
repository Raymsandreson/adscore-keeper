CREATE TABLE public.whatsapp_muted_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  mute_type TEXT NOT NULL DEFAULT 'all',
  muted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(phone, instance_name)
);

COMMENT ON TABLE public.whatsapp_muted_chats IS 'Stores muted WhatsApp conversations to skip webhook processing';
COMMENT ON COLUMN public.whatsapp_muted_chats.mute_type IS 'all = block receive+send, receive = block incoming only, send = block outgoing only';

ALTER TABLE public.whatsapp_muted_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON public.whatsapp_muted_chats FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON public.whatsapp_muted_chats FOR ALL TO anon USING (true) WITH CHECK (true);
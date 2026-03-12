
-- Table to store WhatsApp command configuration (which numbers can send commands, which instance to use)
CREATE TABLE public.whatsapp_command_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name TEXT NOT NULL,
  authorized_phone TEXT NOT NULL,
  user_id UUID NOT NULL,
  user_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instance_name, authorized_phone)
);

-- Table to store command conversation history per phone
CREATE TABLE public.whatsapp_command_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL,
  tool_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX idx_whatsapp_command_config_phone ON public.whatsapp_command_config(authorized_phone, is_active);
CREATE INDEX idx_whatsapp_command_history_phone ON public.whatsapp_command_history(phone, instance_name, created_at DESC);

-- Enable RLS
ALTER TABLE public.whatsapp_command_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_command_history ENABLE ROW LEVEL SECURITY;

-- RLS policies - authenticated users can manage
CREATE POLICY "Authenticated users can manage command config" ON public.whatsapp_command_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage command history" ON public.whatsapp_command_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Auto-cleanup old command history (keep 7 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_command_history()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.whatsapp_command_history WHERE created_at < now() - interval '7 days';
$$;

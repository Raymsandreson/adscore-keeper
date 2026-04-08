
CREATE TABLE public.agent_instance_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(agent_id, instance_id)
);

ALTER TABLE public.agent_instance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to agent_instance_settings"
ON public.agent_instance_settings FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_agent_instance_settings_updated_at
BEFORE UPDATE ON public.agent_instance_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

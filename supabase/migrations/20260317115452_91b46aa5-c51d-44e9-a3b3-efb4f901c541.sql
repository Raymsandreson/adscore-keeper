
CREATE TABLE public.member_assistant_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  instance_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.member_assistant_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage member assistant config"
ON public.member_assistant_config
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Insert default config
INSERT INTO public.member_assistant_config (is_active, instance_name) VALUES (true, null);

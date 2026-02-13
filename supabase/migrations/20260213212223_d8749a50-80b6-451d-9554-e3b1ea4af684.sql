
-- Add instance columns to whatsapp_messages
ALTER TABLE public.whatsapp_messages 
  ADD COLUMN IF NOT EXISTS instance_name text,
  ADD COLUMN IF NOT EXISTS instance_token text;

-- Create index for filtering by instance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_instance ON public.whatsapp_messages(instance_name);

-- Create whatsapp_instances table to manage available instances
CREATE TABLE public.whatsapp_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_name text NOT NULL,
  instance_token text NOT NULL UNIQUE,
  owner_phone text,
  base_url text DEFAULT 'https://abraci.uazapi.com',
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view instances"
  ON public.whatsapp_instances FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage instances"
  ON public.whatsapp_instances FOR ALL
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Create user-instance access table
CREATE TABLE public.whatsapp_instance_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(instance_id, user_id)
);

ALTER TABLE public.whatsapp_instance_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own access"
  ON public.whatsapp_instance_users FOR SELECT
  USING (user_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Admins can manage instance users"
  ON public.whatsapp_instance_users FOR ALL
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Backfill existing messages with instance data from metadata
UPDATE public.whatsapp_messages 
SET instance_name = metadata->>'instanceName',
    instance_token = metadata->>'token'
WHERE metadata->>'instanceName' IS NOT NULL AND instance_name IS NULL;

-- Seed known instances
INSERT INTO public.whatsapp_instances (instance_name, instance_token, owner_phone) VALUES
  ('Léo Teste', '8b90373a-9436-44da-bf7e-cd7a87cf5b92', null),
  ('Prev. Edilan', '5c16e8d2-595a-44b1-908d-49bdfedb4215', null),
  ('Analyne Oliveira', '1c0c70ec-6737-4397-b04f-ed00c4228213', null),
  ('João Pedro', 'da5c9b93-ed50-4570-bb30-e156a99f8162', '558681462638')
ON CONFLICT (instance_token) DO NOTHING;

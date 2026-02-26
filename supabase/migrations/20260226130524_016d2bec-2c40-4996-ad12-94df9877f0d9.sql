-- Add default_instance_id to profiles
ALTER TABLE public.profiles 
ADD COLUMN default_instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

-- Create private conversations table
CREATE TABLE public.whatsapp_private_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  instance_name text NOT NULL,
  private_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(phone, instance_name)
);

ALTER TABLE public.whatsapp_private_conversations ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read (filtering done in app based on permissions)
CREATE POLICY "Authenticated users can read private conversations"
  ON public.whatsapp_private_conversations FOR SELECT
  TO authenticated USING (true);

-- Users can insert/delete their own private markings
CREATE POLICY "Users can mark conversations private"
  ON public.whatsapp_private_conversations FOR INSERT
  TO authenticated WITH CHECK (private_by = auth.uid());

-- Admins or owner can unmark
CREATE POLICY "Users can unmark their private conversations"
  ON public.whatsapp_private_conversations FOR DELETE
  TO authenticated USING (private_by = auth.uid() OR public.is_admin(auth.uid()));
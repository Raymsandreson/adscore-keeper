CREATE TABLE IF NOT EXISTS public.archived_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  instance_name text NOT NULL,
  archived_by uuid,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (phone, instance_name)
);

CREATE INDEX IF NOT EXISTS idx_archived_conv_lookup
  ON public.archived_conversations (instance_name, phone);

ALTER TABLE public.archived_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_archived" ON public.archived_conversations;
CREATE POLICY "auth_read_archived" ON public.archived_conversations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_archived" ON public.archived_conversations;
CREATE POLICY "auth_write_archived" ON public.archived_conversations
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_archived" ON public.archived_conversations;
CREATE POLICY "auth_update_archived" ON public.archived_conversations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_archived" ON public.archived_conversations;
CREATE POLICY "auth_delete_archived" ON public.archived_conversations
  FOR DELETE TO authenticated USING (true);

CREATE TABLE public.group_creation_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID,
  lead_name TEXT NOT NULL,
  phone TEXT,
  contact_phone TEXT,
  board_id UUID,
  creator_instance_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_creation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view queue"
  ON public.group_creation_queue FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert queue"
  ON public.group_creation_queue FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update queue"
  ON public.group_creation_queue FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete queue"
  ON public.group_creation_queue FOR DELETE TO authenticated USING (true);

CREATE POLICY "Service role full access queue"
  ON public.group_creation_queue FOR ALL USING (true);

CREATE TRIGGER update_group_creation_queue_updated_at
  BEFORE UPDATE ON public.group_creation_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_group_creation_queue_status ON public.group_creation_queue (status);

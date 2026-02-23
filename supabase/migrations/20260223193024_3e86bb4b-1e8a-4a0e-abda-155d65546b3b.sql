
CREATE TABLE public.call_field_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_record_id uuid REFERENCES public.call_records(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'contact')),
  entity_id uuid NOT NULL,
  field_name text NOT NULL,
  field_label text NOT NULL,
  current_value text,
  suggested_value text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.call_field_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view suggestions" ON public.call_field_suggestions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update suggestions" ON public.call_field_suggestions
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Service role can insert suggestions" ON public.call_field_suggestions
  FOR INSERT WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.call_field_suggestions;

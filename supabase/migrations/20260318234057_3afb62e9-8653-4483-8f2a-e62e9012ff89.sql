
CREATE TABLE public.whatsapp_internal_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  instance_name TEXT,
  content TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'note',
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_internal_notes_phone ON public.whatsapp_internal_notes(phone);
CREATE INDEX idx_whatsapp_internal_notes_created ON public.whatsapp_internal_notes(created_at);

ALTER TABLE public.whatsapp_internal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read internal notes"
  ON public.whatsapp_internal_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert internal notes"
  ON public.whatsapp_internal_notes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update own notes"
  ON public.whatsapp_internal_notes FOR UPDATE
  TO authenticated
  USING (auth.uid() = sender_id);

CREATE POLICY "Users can delete own notes"
  ON public.whatsapp_internal_notes FOR DELETE
  TO authenticated
  USING (auth.uid() = sender_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_internal_notes;


-- Create table for activity attachments (notes tab)
CREATE TABLE public.activity_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES public.lead_activities(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT,
  attachment_type TEXT NOT NULL DEFAULT 'file', -- 'image', 'video', 'document', 'link'
  link_url TEXT, -- for link type attachments
  link_title TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.activity_attachments ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view activity attachments"
  ON public.activity_attachments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert activity attachments"
  ON public.activity_attachments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete own activity attachments"
  ON public.activity_attachments FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- Storage bucket for activity notes attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('activity-attachments', 'activity-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload activity attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'activity-attachments');

CREATE POLICY "Anyone can view activity attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'activity-attachments');

CREATE POLICY "Authenticated users can delete own activity attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'activity-attachments');

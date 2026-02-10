
-- Storage bucket for ad creatives
INSERT INTO storage.buckets (id, name, public) VALUES ('ad-creatives', 'ad-creatives', true);

-- Allow anyone authenticated to upload
CREATE POLICY "Authenticated users can upload creatives"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'ad-creatives' AND auth.uid() IS NOT NULL);

-- Allow public read
CREATE POLICY "Public read access for ad creatives"
ON storage.objects FOR SELECT
USING (bucket_id = 'ad-creatives');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Authenticated users can delete creatives"
ON storage.objects FOR DELETE
USING (bucket_id = 'ad-creatives' AND auth.uid() IS NOT NULL);

-- Briefings table
CREATE TABLE public.ad_briefings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_name TEXT,
  creative_url TEXT,
  creative_type TEXT DEFAULT 'image', -- image, video
  headline TEXT,
  body_text TEXT,
  link_description TEXT,
  cta TEXT DEFAULT 'LEARN_MORE',
  notes TEXT,
  status TEXT DEFAULT 'pending', -- pending, approved, created, linked
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_post_id UUID REFERENCES public.promoted_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view briefings"
ON public.ad_briefings FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create briefings"
ON public.ad_briefings FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update briefings"
ON public.ad_briefings FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete briefings"
ON public.ad_briefings FOR DELETE
USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_ad_briefings_updated_at
BEFORE UPDATE ON public.ad_briefings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_briefings;

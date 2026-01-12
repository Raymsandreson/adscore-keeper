-- Create instagram_accounts table to store connected Instagram accounts
CREATE TABLE public.instagram_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_name TEXT NOT NULL,
  instagram_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  media_count INTEGER DEFAULT 0,
  profile_picture_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;

-- Allow all access (no authentication required)
CREATE POLICY "Allow public read instagram_accounts"
ON public.instagram_accounts
FOR SELECT
USING (true);

CREATE POLICY "Allow public insert instagram_accounts"
ON public.instagram_accounts
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update instagram_accounts"
ON public.instagram_accounts
FOR UPDATE
USING (true);

CREATE POLICY "Allow public delete instagram_accounts"
ON public.instagram_accounts
FOR DELETE
USING (true);

-- Create instagram_metrics table to store historical metrics
CREATE TABLE public.instagram_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID REFERENCES public.instagram_accounts(id) ON DELETE CASCADE NOT NULL,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  media_count INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  profile_views INTEGER DEFAULT 0,
  website_clicks INTEGER DEFAULT 0,
  email_contacts INTEGER DEFAULT 0,
  stories_views INTEGER DEFAULT 0,
  stories_replies INTEGER DEFAULT 0,
  stories_exits INTEGER DEFAULT 0,
  reels_views INTEGER DEFAULT 0,
  reels_likes INTEGER DEFAULT 0,
  reels_comments INTEGER DEFAULT 0,
  reels_shares INTEGER DEFAULT 0,
  reels_saves INTEGER DEFAULT 0,
  feed_reach INTEGER DEFAULT 0,
  feed_likes INTEGER DEFAULT 0,
  feed_comments INTEGER DEFAULT 0,
  feed_shares INTEGER DEFAULT 0,
  feed_saves INTEGER DEFAULT 0,
  engagement_rate NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(account_id, metric_date)
);

-- Enable RLS
ALTER TABLE public.instagram_metrics ENABLE ROW LEVEL SECURITY;

-- Allow all access
CREATE POLICY "Allow public read instagram_metrics"
ON public.instagram_metrics
FOR SELECT
USING (true);

CREATE POLICY "Allow public insert instagram_metrics"
ON public.instagram_metrics
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update instagram_metrics"
ON public.instagram_metrics
FOR UPDATE
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_instagram_accounts_updated_at
  BEFORE UPDATE ON public.instagram_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
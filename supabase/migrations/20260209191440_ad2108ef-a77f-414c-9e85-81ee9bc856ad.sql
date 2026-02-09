
-- Table to track promoted posts and their ad performance
CREATE TABLE public.promoted_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_title TEXT NOT NULL,
  post_platform TEXT NOT NULL DEFAULT 'instagram',
  post_id TEXT, -- Instagram/Facebook post ID
  campaign_id TEXT, -- Meta campaign ID
  adset_id TEXT, -- Meta ad set ID
  ad_id TEXT, -- Meta ad ID
  ad_account_id TEXT,
  campaign_name TEXT,
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, paused, completed, failed
  daily_budget NUMERIC,
  lifetime_budget NUMERIC,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  -- Targeting
  targeting_locations TEXT[],
  targeting_age_min INTEGER DEFAULT 18,
  targeting_age_max INTEGER DEFAULT 65,
  targeting_genders INTEGER[], -- 0=all, 1=male, 2=female
  targeting_interests JSONB,
  targeting_custom_audiences JSONB,
  placements TEXT[],
  -- Performance metrics
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC DEFAULT 0,
  followers_gained INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  saves_count INTEGER DEFAULT 0,
  engagement_rate NUMERIC DEFAULT 0,
  cpm NUMERIC DEFAULT 0,
  cpc NUMERIC DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  last_metrics_sync TIMESTAMPTZ,
  -- Metadata
  editorial_post_id TEXT, -- Reference to editorial calendar post
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.promoted_posts ENABLE ROW LEVEL SECURITY;

-- Public access policies (no auth required for this app)
CREATE POLICY "Allow all access to promoted_posts"
ON public.promoted_posts FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_promoted_posts_updated_at
BEFORE UPDATE ON public.promoted_posts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.promoted_posts;

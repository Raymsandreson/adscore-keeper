-- Table for Instagram/Facebook comments tracking (received and sent)
CREATE TABLE public.instagram_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id TEXT,
  platform TEXT NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram', 'facebook')),
  comment_type TEXT NOT NULL CHECK (comment_type IN ('received', 'sent')),
  post_id TEXT,
  post_url TEXT,
  comment_id TEXT,
  comment_text TEXT,
  author_username TEXT,
  author_id TEXT,
  parent_comment_id TEXT,
  replied_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Table for engagement goals/targets
CREATE TABLE public.engagement_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id TEXT,
  platform TEXT NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram', 'facebook', 'all')),
  goal_type TEXT NOT NULL CHECK (goal_type IN ('comments_sent', 'comments_received', 'replies', 'likes', 'followers', 'engagement_rate', 'reach')),
  target_value INTEGER NOT NULL,
  current_value INTEGER DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'daily' CHECK (period IN ('daily', 'weekly', 'monthly')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for auto-reply rules
CREATE TABLE public.instagram_auto_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id TEXT,
  platform TEXT NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram', 'facebook', 'all')),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'new_follower', 'mention', 'dm', 'comment', 'all_comments')),
  trigger_keywords TEXT[] DEFAULT '{}',
  reply_templates TEXT[] NOT NULL,
  is_active BOOLEAN DEFAULT true,
  delay_seconds INTEGER DEFAULT 0,
  max_replies_per_hour INTEGER DEFAULT 20,
  replies_count INTEGER DEFAULT 0,
  last_reply_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for daily engagement stats (for tracking progress)
CREATE TABLE public.engagement_daily_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id TEXT,
  platform TEXT NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram', 'facebook')),
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  comments_sent INTEGER DEFAULT 0,
  comments_received INTEGER DEFAULT 0,
  replies_sent INTEGER DEFAULT 0,
  likes_given INTEGER DEFAULT 0,
  likes_received INTEGER DEFAULT 0,
  new_followers INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(ad_account_id, platform, stat_date)
);

-- Enable RLS on all tables
ALTER TABLE public.instagram_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_auto_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_daily_stats ENABLE ROW LEVEL SECURITY;

-- Public access policies (since no auth)
CREATE POLICY "Allow all access to instagram_comments" ON public.instagram_comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to engagement_goals" ON public.engagement_goals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to instagram_auto_replies" ON public.instagram_auto_replies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to engagement_daily_stats" ON public.engagement_daily_stats FOR ALL USING (true) WITH CHECK (true);

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_engagement_goals_updated_at
BEFORE UPDATE ON public.engagement_goals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_instagram_auto_replies_updated_at
BEFORE UPDATE ON public.instagram_auto_replies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_engagement_daily_stats_updated_at
BEFORE UPDATE ON public.engagement_daily_stats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for efficient querying
CREATE INDEX idx_instagram_comments_type ON public.instagram_comments(comment_type);
CREATE INDEX idx_instagram_comments_platform_date ON public.instagram_comments(platform, created_at);
CREATE INDEX idx_engagement_goals_active ON public.engagement_goals(is_active, platform);
CREATE INDEX idx_engagement_daily_stats_date ON public.engagement_daily_stats(stat_date, platform);
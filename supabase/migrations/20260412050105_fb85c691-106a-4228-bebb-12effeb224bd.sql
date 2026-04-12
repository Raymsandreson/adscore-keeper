-- Add news_links array to leads table for multiple news links
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS news_links text[] DEFAULT '{}';

-- Migrate existing news_link data into the new array
UPDATE public.leads SET news_links = ARRAY[news_link] WHERE news_link IS NOT NULL AND news_link != '' AND (news_links IS NULL OR news_links = '{}');
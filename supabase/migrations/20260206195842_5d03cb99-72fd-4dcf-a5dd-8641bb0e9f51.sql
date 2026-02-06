-- Add cost tracking columns to instagram_search_history
ALTER TABLE public.instagram_search_history 
ADD COLUMN IF NOT EXISTS cost_usd numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_brl numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS post_urls text[] DEFAULT '{}';

-- Add index for faster search
CREATE INDEX IF NOT EXISTS idx_instagram_search_history_created_by ON public.instagram_search_history(created_by);
CREATE INDEX IF NOT EXISTS idx_instagram_search_history_created_at ON public.instagram_search_history(created_at DESC);
-- Add fields to link leads with Instagram comments and track follower status
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS instagram_comment_id uuid REFERENCES public.instagram_comments(id),
ADD COLUMN IF NOT EXISTS instagram_username text,
ADD COLUMN IF NOT EXISTS is_follower boolean DEFAULT null;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_instagram_comment_id ON public.leads(instagram_comment_id);
CREATE INDEX IF NOT EXISTS idx_leads_instagram_username ON public.leads(instagram_username);
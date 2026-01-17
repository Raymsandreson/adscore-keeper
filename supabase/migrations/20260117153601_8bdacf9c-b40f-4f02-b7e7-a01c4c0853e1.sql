-- Add prospect_classification column to instagram_comments table
ALTER TABLE public.instagram_comments 
ADD COLUMN IF NOT EXISTS prospect_classification text DEFAULT NULL;

-- Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_instagram_comments_prospect_classification 
ON public.instagram_comments(prospect_classification);

-- Comment explaining the field
COMMENT ON COLUMN public.instagram_comments.prospect_classification IS 'Classification: client, closer, sdr, team, prospect, other';
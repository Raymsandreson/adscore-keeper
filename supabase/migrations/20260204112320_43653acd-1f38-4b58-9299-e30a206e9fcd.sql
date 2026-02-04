-- Add unique constraint on comment_id for upsert to work
CREATE UNIQUE INDEX IF NOT EXISTS instagram_comments_comment_id_unique 
ON public.instagram_comments (comment_id) 
WHERE comment_id IS NOT NULL;
-- Add follower_status column to contacts table
ALTER TABLE public.contacts
ADD COLUMN follower_status text DEFAULT 'none' CHECK (follower_status IN ('follower', 'following', 'mutual', 'none'));

-- Create index for faster filtering
CREATE INDEX idx_contacts_follower_status ON public.contacts(follower_status);

-- Update existing contacts based on their tags
UPDATE public.contacts
SET follower_status = CASE
  WHEN tags @> ARRAY['seguidor']::text[] AND tags @> ARRAY['seguindo']::text[] THEN 'mutual'
  WHEN tags @> ARRAY['seguidor']::text[] THEN 'follower'
  WHEN tags @> ARRAY['seguindo']::text[] THEN 'following'
  ELSE 'none'
END;
-- Add column to track when follow request was sent
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS follow_requested_at timestamp with time zone DEFAULT NULL;

-- Add index for faster filtering of pending requests
CREATE INDEX IF NOT EXISTS idx_contacts_follow_requested_at 
ON public.contacts(follow_requested_at) 
WHERE follow_requested_at IS NOT NULL;
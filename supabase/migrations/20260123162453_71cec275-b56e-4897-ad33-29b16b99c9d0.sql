-- Create table for DM history tracking
CREATE TABLE public.dm_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.instagram_comments(id) ON DELETE SET NULL,
  instagram_username TEXT NOT NULL,
  author_id TEXT,
  dm_message TEXT NOT NULL,
  original_suggestion TEXT,
  was_edited BOOLEAN DEFAULT false,
  action_type TEXT NOT NULL DEFAULT 'copied' CHECK (action_type IN ('copied', 'copied_and_opened', 'opened_only')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dm_history ENABLE ROW LEVEL SECURITY;

-- RLS policies for user data isolation
CREATE POLICY "Users can view their own DM history"
ON public.dm_history
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own DM history"
ON public.dm_history
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own DM history"
ON public.dm_history
FOR DELETE
USING (auth.uid() = user_id);

-- Create index for common queries
CREATE INDEX idx_dm_history_user_id ON public.dm_history(user_id);
CREATE INDEX idx_dm_history_instagram_username ON public.dm_history(instagram_username);
CREATE INDEX idx_dm_history_created_at ON public.dm_history(created_at DESC);
CREATE INDEX idx_dm_history_comment_id ON public.dm_history(comment_id);
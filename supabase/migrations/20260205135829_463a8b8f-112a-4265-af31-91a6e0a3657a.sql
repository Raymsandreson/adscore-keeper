-- Create table to store search history
CREATE TABLE public.instagram_search_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  keywords TEXT[] NOT NULL,
  max_posts INTEGER DEFAULT 50,
  min_comments INTEGER DEFAULT 5,
  apify_run_id TEXT,
  status TEXT DEFAULT 'running',
  results_count INTEGER DEFAULT 0,
  results JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.instagram_search_history ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users to manage their own searches
CREATE POLICY "Users can view all search history"
ON public.instagram_search_history
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create search history"
ON public.instagram_search_history
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own searches"
ON public.instagram_search_history
FOR UPDATE
TO authenticated
USING (auth.uid() = created_by);

-- Index for faster queries
CREATE INDEX idx_search_history_created_at ON public.instagram_search_history(created_at DESC);
CREATE INDEX idx_search_history_status ON public.instagram_search_history(status);
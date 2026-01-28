
-- Create table for user sessions (login/logout tracking)
CREATE TABLE public.user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  end_reason TEXT, -- 'logout', 'inactivity', 'tab_close', 'session_expired'
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_sessions
CREATE POLICY "Users can insert their own sessions"
ON public.user_sessions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own sessions"
ON public.user_sessions FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can view their own sessions or admins can view all"
ON public.user_sessions FOR SELECT
USING (user_id = auth.uid() OR is_admin(auth.uid()));

-- Add new activity types to track more actions
-- First, let's add some useful indexes
CREATE INDEX idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_started_at ON public.user_sessions(started_at DESC);
CREATE INDEX idx_user_activity_log_user_id_created ON public.user_activity_log(user_id, created_at DESC);

-- Enable realtime for sessions (optional, for admin dashboard)
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_sessions;

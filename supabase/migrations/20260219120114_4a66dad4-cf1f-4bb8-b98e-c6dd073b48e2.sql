
CREATE TABLE public.user_timeblock_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  activity_type TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  days INTEGER[] NOT NULL DEFAULT '{}',
  start_hour INTEGER NOT NULL DEFAULT 9,
  end_hour INTEGER NOT NULL DEFAULT 12,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, activity_type)
);

ALTER TABLE public.user_timeblock_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own timeblock settings"
ON public.user_timeblock_settings
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_user_timeblock_settings_updated_at
BEFORE UPDATE ON public.user_timeblock_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

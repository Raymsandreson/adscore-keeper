
-- Voice preferences per user
CREATE TABLE public.voice_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  voice_type TEXT NOT NULL DEFAULT 'preset' CHECK (voice_type IN ('preset', 'cloned')),
  voice_id TEXT NOT NULL DEFAULT 'FGY2WhTYpPnrIDTdsKH5',
  voice_name TEXT NOT NULL DEFAULT 'Laura',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.voice_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own voice preferences"
  ON public.voice_preferences FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all voice preferences"
  ON public.voice_preferences FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Custom cloned voices
CREATE TABLE public.custom_voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  elevenlabs_voice_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  sample_file_urls TEXT[] DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_voices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own custom voices"
  ON public.custom_voices FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all custom voices"
  ON public.custom_voices FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

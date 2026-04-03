-- Add waba_id to meta_ad_accounts
ALTER TABLE public.meta_ad_accounts 
ADD COLUMN IF NOT EXISTS waba_id TEXT;

-- Create meta_capi_config table for caching dataset_id per WABA
CREATE TABLE IF NOT EXISTS public.meta_capi_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  waba_id TEXT NOT NULL UNIQUE,
  dataset_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_capi_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view CAPI config"
ON public.meta_capi_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage CAPI config"
ON public.meta_capi_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
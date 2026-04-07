
CREATE TABLE public.adset_geo_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id TEXT NOT NULL,
  stage_id TEXT,
  acolhedor TEXT,
  adset_id TEXT NOT NULL,
  ad_account_id TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_name TEXT,
  radius_km INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.adset_geo_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage adset_geo_rules"
ON public.adset_geo_rules
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_adset_geo_rules_updated_at
BEFORE UPDATE ON public.adset_geo_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

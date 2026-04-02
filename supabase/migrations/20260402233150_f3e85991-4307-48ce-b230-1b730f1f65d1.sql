
CREATE TABLE public.meta_ad_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own meta accounts"
  ON public.meta_ad_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own meta accounts"
  ON public.meta_ad_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own meta accounts"
  ON public.meta_ad_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own meta accounts"
  ON public.meta_ad_accounts FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_meta_ad_accounts_updated_at
  BEFORE UPDATE ON public.meta_ad_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

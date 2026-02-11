
-- Junction table to link expense categories to specific pluggy accounts
-- If a category has no links, it's available for ALL accounts (backward compatible)
CREATE TABLE public.account_category_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pluggy_account_id TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES public.expense_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pluggy_account_id, category_id)
);

-- Enable RLS
ALTER TABLE public.account_category_links ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage account category links"
ON public.account_category_links
FOR ALL
USING (true)
WITH CHECK (true);

-- Add column to track when user explicitly acknowledges no link is needed
ALTER TABLE public.transaction_category_overrides 
ADD COLUMN IF NOT EXISTS link_acknowledged boolean NOT NULL DEFAULT false;

-- Add comment explaining the column
COMMENT ON COLUMN public.transaction_category_overrides.link_acknowledged IS 'True when user explicitly confirms transaction does not need a lead/contact link';
-- Add parent_id column for subcategories hierarchy
ALTER TABLE public.expense_categories
ADD COLUMN parent_id UUID REFERENCES public.expense_categories(id) ON DELETE CASCADE NULL;

-- Add index for faster hierarchy queries
CREATE INDEX idx_expense_categories_parent_id ON public.expense_categories(parent_id);
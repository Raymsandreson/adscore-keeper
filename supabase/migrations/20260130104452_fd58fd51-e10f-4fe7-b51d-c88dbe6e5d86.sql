-- Create table to store API category mappings for local categories
CREATE TABLE public.category_api_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.expense_categories(id) ON DELETE CASCADE,
  api_category_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(category_id, api_category_name)
);

-- Enable RLS
ALTER TABLE public.category_api_mappings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can read category_api_mappings" 
ON public.category_api_mappings 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert category_api_mappings" 
ON public.category_api_mappings 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update category_api_mappings" 
ON public.category_api_mappings 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete category_api_mappings" 
ON public.category_api_mappings 
FOR DELETE 
USING (true);
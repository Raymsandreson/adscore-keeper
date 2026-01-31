-- Add installment columns to credit_card_transactions
ALTER TABLE public.credit_card_transactions
ADD COLUMN IF NOT EXISTS installment_number integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS total_installments integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS original_purchase_date date DEFAULT NULL,
ADD COLUMN IF NOT EXISTS purchase_group_id uuid DEFAULT NULL;

-- Create table for grouped/original purchases (for hybrid view)
CREATE TABLE IF NOT EXISTS public.purchase_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  description TEXT NOT NULL,
  total_amount NUMERIC NOT NULL,
  total_installments INTEGER NOT NULL DEFAULT 1,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  pending_amount NUMERIC NOT NULL DEFAULT 0,
  original_purchase_date DATE NOT NULL,
  card_last_digits TEXT,
  category_id UUID REFERENCES public.expense_categories(id),
  merchant_name TEXT,
  merchant_cnpj TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on purchase_groups
ALTER TABLE public.purchase_groups ENABLE ROW LEVEL SECURITY;

-- RLS policies for purchase_groups
CREATE POLICY "Users can view purchase groups they have access to"
ON public.purchase_groups
FOR SELECT
USING (
  user_id = auth.uid() 
  OR can_view_card(auth.uid(), card_last_digits)
);

CREATE POLICY "Users can insert their own purchase groups"
ON public.purchase_groups
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own purchase groups"
ON public.purchase_groups
FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own purchase groups"
ON public.purchase_groups
FOR DELETE
USING (user_id = auth.uid());

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_transactions_purchase_group 
ON public.credit_card_transactions(purchase_group_id);

CREATE INDEX IF NOT EXISTS idx_purchase_groups_user 
ON public.purchase_groups(user_id);

-- Add trigger for updated_at on purchase_groups
CREATE TRIGGER update_purchase_groups_updated_at
BEFORE UPDATE ON public.purchase_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
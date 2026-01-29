-- Add contact_id column to transaction_category_overrides
ALTER TABLE public.transaction_category_overrides
ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_transaction_overrides_contact_id 
ON public.transaction_category_overrides(contact_id);
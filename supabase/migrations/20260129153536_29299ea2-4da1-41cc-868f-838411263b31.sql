-- Add contact_id to card_assignments table
ALTER TABLE public.card_assignments
ADD COLUMN contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

-- Add index for better performance
CREATE INDEX idx_card_assignments_contact_id ON public.card_assignments(contact_id);
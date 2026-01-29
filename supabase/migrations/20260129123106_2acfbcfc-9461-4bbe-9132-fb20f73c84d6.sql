-- Add card_name column to card_assignments
ALTER TABLE public.card_assignments
ADD COLUMN card_name TEXT;
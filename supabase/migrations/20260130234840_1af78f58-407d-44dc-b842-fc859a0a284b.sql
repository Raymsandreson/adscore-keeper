-- Add manual location columns to transaction_category_overrides
ALTER TABLE transaction_category_overrides 
ADD COLUMN manual_city TEXT,
ADD COLUMN manual_state TEXT;
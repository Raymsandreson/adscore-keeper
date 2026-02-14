-- Drop the FK constraint that only references credit_card_transactions
-- Bank transactions also use this table, so transaction_id can't be FK to just one table
ALTER TABLE public.transaction_category_overrides 
DROP CONSTRAINT transaction_category_overrides_transaction_id_fkey;
-- Add transaction_time column to store the time portion of transactions
ALTER TABLE public.credit_card_transactions 
ADD COLUMN transaction_time time WITHOUT TIME ZONE DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.credit_card_transactions.transaction_time IS 'Time of the transaction (from Pluggy API)';
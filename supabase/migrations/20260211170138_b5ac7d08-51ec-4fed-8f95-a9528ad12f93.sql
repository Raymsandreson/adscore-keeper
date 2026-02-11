-- Add custom_name to pluggy_connections for user-friendly renaming
ALTER TABLE public.pluggy_connections ADD COLUMN custom_name text;

-- Add pluggy_item_id to credit_card_transactions to link transactions to connections
ALTER TABLE public.credit_card_transactions ADD COLUMN pluggy_item_id text;
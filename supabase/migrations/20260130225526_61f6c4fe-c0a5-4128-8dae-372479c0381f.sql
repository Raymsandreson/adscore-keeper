-- Update RLS policy for credit_card_transactions to remove admin bypass
DROP POLICY IF EXISTS "Users can view transactions they have access to" ON credit_card_transactions;

CREATE POLICY "Users can view transactions they have access to" 
ON credit_card_transactions 
FOR SELECT 
USING (
  user_id = auth.uid() 
  OR can_view_card(auth.uid(), card_last_digits)
);

-- Update RLS policy for pluggy_connections to remove admin bypass
DROP POLICY IF EXISTS "Users can view connections they have access to" ON pluggy_connections;

CREATE POLICY "Users can view connections they have access to" 
ON pluggy_connections 
FOR SELECT 
USING (
  user_id = auth.uid() 
  OR EXISTS (SELECT 1 FROM user_card_permissions WHERE user_id = auth.uid())
);
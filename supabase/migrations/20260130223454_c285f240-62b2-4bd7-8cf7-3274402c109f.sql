
-- Drop existing restrictive policies on pluggy_connections
DROP POLICY IF EXISTS "Users can view their own connections" ON public.pluggy_connections;

-- Create new policy that allows viewing connections if user owns it OR has permission on any card from that connection's transactions
CREATE POLICY "Users can view connections they have access to" 
ON public.pluggy_connections 
FOR SELECT 
USING (
  user_id = auth.uid() 
  OR 
  public.is_admin(auth.uid())
  OR
  EXISTS (
    SELECT 1 FROM public.user_card_permissions ucp
    WHERE ucp.user_id = auth.uid()
  )
);

-- Drop existing restrictive policies on credit_card_transactions
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.credit_card_transactions;

-- Create new policy that allows viewing transactions if user owns it OR has permission for that card
CREATE POLICY "Users can view transactions they have access to" 
ON public.credit_card_transactions 
FOR SELECT 
USING (
  user_id = auth.uid() 
  OR 
  public.is_admin(auth.uid())
  OR
  public.can_view_card(auth.uid(), card_last_digits)
);

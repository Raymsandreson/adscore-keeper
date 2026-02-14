
-- Create function to check if user can view a pluggy account
CREATE OR REPLACE FUNCTION public.can_view_pluggy_account(_user_id uuid, _pluggy_account_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_card_permissions
    WHERE user_id = _user_id
      AND pluggy_account_id = _pluggy_account_id
  )
$$;

-- Update bank_transactions SELECT policy
DROP POLICY IF EXISTS "Users can view their own bank transactions" ON public.bank_transactions;
CREATE POLICY "Users can view bank transactions they have access to"
ON public.bank_transactions
FOR SELECT
USING (
  user_id = auth.uid() 
  OR can_view_pluggy_account(auth.uid(), pluggy_account_id)
);

-- Update investments SELECT policy
DROP POLICY IF EXISTS "Users can view their own investments" ON public.investments;
CREATE POLICY "Users can view investments they have access to"
ON public.investments
FOR SELECT
USING (
  user_id = auth.uid() 
  OR can_view_pluggy_account(auth.uid(), pluggy_account_id)
);

-- Update loans SELECT policy
DROP POLICY IF EXISTS "Users can view their own loans" ON public.loans;
CREATE POLICY "Users can view loans they have access to"
ON public.loans
FOR SELECT
USING (
  user_id = auth.uid() 
  OR can_view_pluggy_account(auth.uid(), pluggy_account_id)
);


-- Create table for bank account permissions
CREATE TABLE public.user_account_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pluggy_account_id TEXT NOT NULL,
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pluggy_account_id)
);

ALTER TABLE public.user_account_permissions ENABLE ROW LEVEL SECURITY;

-- Admins can manage all
CREATE POLICY "Admins can manage account permissions"
ON public.user_account_permissions
FOR ALL
USING (public.is_admin(auth.uid()));

-- Users can view their own
CREATE POLICY "Users can view own account permissions"
ON public.user_account_permissions
FOR SELECT
USING (user_id = auth.uid());

-- Update can_view_pluggy_account to check new table too
CREATE OR REPLACE FUNCTION public.can_view_pluggy_account(_user_id uuid, _pluggy_account_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_account_permissions
    WHERE user_id = _user_id
      AND pluggy_account_id = _pluggy_account_id
  )
$$;

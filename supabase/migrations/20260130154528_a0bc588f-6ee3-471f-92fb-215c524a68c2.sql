-- Create table for user card permissions
CREATE TABLE public.user_card_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    card_last_digits text NOT NULL,
    pluggy_account_id text,
    granted_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, card_last_digits)
);

-- Enable RLS
ALTER TABLE public.user_card_permissions ENABLE ROW LEVEL SECURITY;

-- Admins can manage all permissions
CREATE POLICY "Admins can view all permissions"
ON public.user_card_permissions FOR SELECT
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert permissions"
ON public.user_card_permissions FOR INSERT
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update permissions"
ON public.user_card_permissions FOR UPDATE
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete permissions"
ON public.user_card_permissions FOR DELETE
USING (is_admin(auth.uid()));

-- Users can view their own permissions
CREATE POLICY "Users can view own permissions"
ON public.user_card_permissions FOR SELECT
USING (user_id = auth.uid());

-- Create function to check if user can view a card
CREATE OR REPLACE FUNCTION public.can_view_card(_user_id uuid, _card_last_digits text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_card_permissions
    WHERE user_id = _user_id
      AND card_last_digits = _card_last_digits
  )
$$;
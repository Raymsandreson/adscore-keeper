
-- Create table for module-level permissions per member
CREATE TABLE public.member_module_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'none' CHECK (access_level IN ('none', 'view', 'edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_key)
);

-- Enable RLS
ALTER TABLE public.member_module_permissions ENABLE ROW LEVEL SECURITY;

-- Admins can manage all permissions
CREATE POLICY "Admins can manage module permissions"
  ON public.member_module_permissions
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Users can read their own permissions
CREATE POLICY "Users can read own permissions"
  ON public.member_module_permissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_member_module_permissions_updated_at
  BEFORE UPDATE ON public.member_module_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

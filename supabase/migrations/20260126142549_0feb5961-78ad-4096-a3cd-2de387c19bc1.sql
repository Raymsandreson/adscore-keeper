-- Enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- User roles table (following security best practices - roles in separate table)
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'member',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Team invitations table
CREATE TABLE public.team_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    role app_role NOT NULL DEFAULT 'member',
    invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    accepted_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- User activity log table (tracks all actions)
CREATE TABLE public.user_activity_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    action_type text NOT NULL, -- 'comment_reply', 'dm_sent', 'lead_created', 'lead_moved', 'contact_created', 'workflow_session', etc.
    entity_type text, -- 'comment', 'lead', 'contact', 'dm', etc.
    entity_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Daily productivity goals per user
CREATE TABLE public.workflow_daily_goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    goal_date date NOT NULL DEFAULT CURRENT_DATE,
    target_replies integer DEFAULT 20,
    target_dms integer DEFAULT 10,
    target_leads integer DEFAULT 5,
    target_session_minutes integer DEFAULT 60,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, goal_date)
);

-- Enable RLS on all tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_daily_goals ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
$$;

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert roles"
ON public.user_roles FOR INSERT
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update roles"
ON public.user_roles FOR UPDATE
USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE
USING (public.is_admin(auth.uid()));

-- RLS Policies for team_invitations
CREATE POLICY "Admins can view all invitations"
ON public.team_invitations FOR SELECT
USING (public.is_admin(auth.uid()) OR invited_by = auth.uid());

CREATE POLICY "Admins can create invitations"
ON public.team_invitations FOR INSERT
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update invitations"
ON public.team_invitations FOR UPDATE
USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete invitations"
ON public.team_invitations FOR DELETE
USING (public.is_admin(auth.uid()));

-- RLS Policies for user_activity_log
CREATE POLICY "Users can view their own activity or admins can view all"
ON public.user_activity_log FOR SELECT
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Users can log their own activity"
ON public.user_activity_log FOR INSERT
WITH CHECK (user_id = auth.uid());

-- RLS Policies for workflow_daily_goals
CREATE POLICY "Users can view their own goals or admins can view all"
ON public.workflow_daily_goals FOR SELECT
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Users can set their own goals"
ON public.workflow_daily_goals FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own goals"
ON public.workflow_daily_goals FOR UPDATE
USING (user_id = auth.uid());

-- Add user_id to existing tables that need tracking
ALTER TABLE public.instagram_comments ADD COLUMN IF NOT EXISTS replied_by uuid REFERENCES auth.users(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- Create index for better performance
CREATE INDEX idx_user_activity_log_user_id ON public.user_activity_log(user_id);
CREATE INDEX idx_user_activity_log_created_at ON public.user_activity_log(created_at DESC);
CREATE INDEX idx_user_activity_log_action_type ON public.user_activity_log(action_type);

-- Trigger to auto-assign admin role to first user (you)
CREATE OR REPLACE FUNCTION public.auto_assign_first_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If no admins exist, make this user an admin
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    -- Otherwise, check if they were invited
    IF EXISTS (
      SELECT 1 FROM public.team_invitations 
      WHERE email = NEW.email 
      AND accepted_at IS NULL 
      AND expires_at > now()
    ) THEN
      -- Get the role from invitation and assign
      INSERT INTO public.user_roles (user_id, role)
      SELECT NEW.id, ti.role
      FROM public.team_invitations ti
      WHERE ti.email = NEW.email
      AND ti.accepted_at IS NULL
      LIMIT 1;
      
      -- Mark invitation as accepted
      UPDATE public.team_invitations
      SET accepted_at = now()
      WHERE email = NEW.email AND accepted_at IS NULL;
    ELSE
      -- Default to member role
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users (requires special handling)
DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_first_admin();
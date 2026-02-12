
-- Create teams table
CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#3b82f6',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view teams" ON public.teams FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can insert teams" ON public.teams FOR INSERT WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update teams" ON public.teams FOR UPDATE USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete teams" ON public.teams FOR DELETE USING (public.is_admin(auth.uid()));

-- Create team_members junction table
CREATE TABLE public.team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view team_members" ON public.team_members FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can insert team_members" ON public.team_members FOR INSERT WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete team_members" ON public.team_members FOR DELETE USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

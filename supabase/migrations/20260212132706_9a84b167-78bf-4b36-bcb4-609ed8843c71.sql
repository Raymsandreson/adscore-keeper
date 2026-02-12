
-- Add board_id to teams to associate a funnel
ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS board_id uuid REFERENCES public.kanban_boards(id) ON DELETE SET NULL;

-- Add evaluated_metrics to team_members to track which metrics each member is evaluated on
ALTER TABLE public.team_members
ADD COLUMN IF NOT EXISTS evaluated_metrics text[] DEFAULT '{}'::text[];

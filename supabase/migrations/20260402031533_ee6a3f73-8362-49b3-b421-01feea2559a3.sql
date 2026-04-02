-- Add pre-configured permissions to team invitations
ALTER TABLE public.team_invitations
  ADD COLUMN IF NOT EXISTS module_permissions jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_instance_ids uuid[] DEFAULT '{}';
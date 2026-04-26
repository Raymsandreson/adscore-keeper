CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_ci
  ON public.profiles (LOWER(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_email_pending_unique
  ON public.team_invitations (LOWER(email))
  WHERE accepted_at IS NULL;
-- Trigger sync reverso: ao criar/atualizar perfil no Cloud,
-- replica usuário no Externo e popula auth_uuid_mapping via edge function.

CREATE OR REPLACE FUNCTION public.bridge_profile_to_external_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  v_payload := jsonb_build_object(
    'user_id', NEW.user_id,
    'email', NEW.email,
    'user_metadata', jsonb_build_object('full_name', COALESCE(NEW.full_name, ''))
  );

  PERFORM net.http_post(
    url := 'https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/sync-new-user-mapping',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38"}'::jsonb,
    body := v_payload,
    timeout_milliseconds := 8000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bridge_profile_to_external_auth skipped (%): %', NEW.user_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bridge_profile_to_external_auth_trg ON public.profiles;
CREATE TRIGGER bridge_profile_to_external_auth_trg
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.bridge_profile_to_external_auth();
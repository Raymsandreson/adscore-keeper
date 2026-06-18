-- Add x-bridge-secret header to pg_net bridge trigger calls and lock realtime.messages by default.

-- Bridge trigger: pass shared secret to edge function
CREATE OR REPLACE FUNCTION public.bridge_activity_to_external()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_payload JSONB;
  v_op TEXT := TG_OP;
  v_table TEXT := TG_TABLE_NAME;
BEGIN
  IF v_op = 'DELETE' THEN
    v_payload := jsonb_build_object('op', v_op, 'table', v_table, 'old_row', to_jsonb(OLD));
  ELSE
    v_payload := jsonb_build_object('op', v_op, 'table', v_table, 'row', to_jsonb(NEW));
  END IF;

  PERFORM net.http_post(
    url := 'https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/bridge-activity-to-external',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38", "x-bridge-secret": "a0d0117e07e743fd349e026d74eb8b356bca14185c98ee8cfa8b418fa5ce037d"}'::jsonb,
    body := v_payload,
    timeout_milliseconds := 5000
  );

  IF v_op = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bridge_activity_to_external skipped (% on %): %', v_op, v_table, SQLERRM;
  IF v_op = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- Lock realtime.messages: deny-all default so no authenticated user can subscribe
-- to arbitrary Broadcast/Presence topics. Re-enable per-topic via app-level policies.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    -- Drop any prior permissive policy from us, then add deny-all
    EXECUTE 'DROP POLICY IF EXISTS "deny all broadcast/presence by default" ON realtime.messages';
    EXECUTE 'CREATE POLICY "deny all broadcast/presence by default" ON realtime.messages FOR ALL TO authenticated USING (false) WITH CHECK (false)';
  END IF;
END$$;
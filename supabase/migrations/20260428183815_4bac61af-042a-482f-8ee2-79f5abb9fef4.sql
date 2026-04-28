-- Garantir extensão pg_net
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Função genérica do bridge: empacota row e POSTa para a edge function
CREATE OR REPLACE FUNCTION public.bridge_activity_to_external()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_payload JSONB;
  v_op TEXT := TG_OP;
  v_table TEXT := TG_TABLE_NAME;
BEGIN
  IF v_op = 'DELETE' THEN
    v_payload := jsonb_build_object(
      'op', v_op,
      'table', v_table,
      'old_row', to_jsonb(OLD)
    );
  ELSE
    v_payload := jsonb_build_object(
      'op', v_op,
      'table', v_table,
      'row', to_jsonb(NEW)
    );
  END IF;

  PERFORM net.http_post(
    url := 'https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/bridge-activity-to-external',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38"}'::jsonb,
    body := v_payload,
    timeout_milliseconds := 5000
  );

  IF v_op = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- NUNCA bloquear a operação principal por falha do bridge
  RAISE WARNING 'bridge_activity_to_external skipped (% on %): %', v_op, v_table, SQLERRM;
  IF v_op = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- lead_activities
DROP TRIGGER IF EXISTS trg_bridge_lead_activities ON public.lead_activities;
CREATE TRIGGER trg_bridge_lead_activities
AFTER INSERT OR UPDATE OR DELETE ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();

-- activity_chat_messages
DROP TRIGGER IF EXISTS trg_bridge_activity_chat_messages ON public.activity_chat_messages;
CREATE TRIGGER trg_bridge_activity_chat_messages
AFTER INSERT OR UPDATE OR DELETE ON public.activity_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();

-- activity_attachments
DROP TRIGGER IF EXISTS trg_bridge_activity_attachments ON public.activity_attachments;
CREATE TRIGGER trg_bridge_activity_attachments
AFTER INSERT OR UPDATE OR DELETE ON public.activity_attachments
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();
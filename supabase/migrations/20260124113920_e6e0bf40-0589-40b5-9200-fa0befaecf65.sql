-- Função para gerenciar cron jobs automaticamente (versão corrigida)
CREATE OR REPLACE FUNCTION public.manage_comment_schedule_cron()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_cron_expression TEXT;
  v_job_name TEXT;
  v_sql TEXT;
BEGIN
  -- DELETE: Remover cron job existente
  IF TG_OP = 'DELETE' THEN
    IF OLD.cron_job_name IS NOT NULL THEN
      PERFORM cron.unschedule(OLD.cron_job_name);
    END IF;
    RETURN OLD;
  END IF;

  -- Gerar nome único para o job
  v_job_name := 'comment_schedule_' || NEW.id;

  -- Converter intervalo em expressão cron
  v_cron_expression := CASE NEW.interval_minutes
    WHEN 5 THEN '*/5 * * * *'
    WHEN 10 THEN '*/10 * * * *'
    WHEN 15 THEN '*/15 * * * *'
    WHEN 30 THEN '*/30 * * * *'
    WHEN 60 THEN '0 * * * *'
    ELSE '*/30 * * * *'
  END;

  -- UPDATE: Verificar se precisa atualizar o cron
  IF TG_OP = 'UPDATE' THEN
    -- Se desativou ou mudou intervalo, remover job antigo
    IF OLD.cron_job_name IS NOT NULL AND (
      NEW.is_active = false OR 
      NEW.interval_minutes != OLD.interval_minutes
    ) THEN
      PERFORM cron.unschedule(OLD.cron_job_name);
      NEW.cron_job_name := NULL;
    END IF;
    
    -- Se está inativo, não criar novo job
    IF NEW.is_active = false THEN
      RETURN NEW;
    END IF;
  END IF;

  -- INSERT ou UPDATE com ativo: Criar novo cron job
  IF NEW.is_active = true AND (TG_OP = 'INSERT' OR NEW.cron_job_name IS NULL) THEN
    -- Construir SQL para o cron job
    v_sql := 'SELECT net.http_post(url := ''https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/n8n-comment-webhook'', headers := ''{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38"}''::jsonb, body := ''{"action": "scheduled_run", "schedule_id": "' || NEW.id || '"}''::jsonb) AS request_id';
    
    -- Criar o cron job
    PERFORM cron.schedule(v_job_name, v_cron_expression, v_sql);
    
    NEW.cron_job_name := v_job_name;
    NEW.next_run_at := now() + (NEW.interval_minutes || ' minutes')::interval;
  END IF;

  RETURN NEW;
END;
$func$;

-- Criar trigger para gerenciar cron jobs automaticamente
DROP TRIGGER IF EXISTS manage_schedule_cron_trigger ON public.n8n_comment_schedules;

CREATE TRIGGER manage_schedule_cron_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.n8n_comment_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_comment_schedule_cron();
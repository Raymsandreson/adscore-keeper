
-- Create a cron job to invoke wjia-followup-processor every 2 minutes
SELECT cron.schedule(
  'wjia_followup_processor',
  '*/2 * * * *',
  $$SELECT net.http_post(
    url := 'https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/wjia-followup-processor',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id$$
);

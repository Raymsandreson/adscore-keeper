-- "Tempo real" (polling 10min) do sync de status/conversão do funil Aux Acidente.
-- O handler roda no Railway (credenciais Google Sheets só existem lá) e é idempotente
-- (carimbo leads.capi_purchase_sent_at) — rodar repetido não refaz import/status/Purchase.
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- Rollback: select cron.unschedule('sync-funnel-status-aux-acidente');

select cron.schedule(
  'sync-funnel-status-aux-acidente',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://adscore-keeper-production.up.railway.app/functions/sync-funnel-status-from-sheet',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"dry_run": false}'::jsonb,
    timeout_milliseconds := 180000
  )
  $$
);

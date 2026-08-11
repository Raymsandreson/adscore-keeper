-- =============================================================================
-- A URL do Railway nos crons de Gmail estava ERRADA — e era por isso que a
-- caixa não sincronizava.
--
--   errada:  https://adscore-railway-production.up.railway.app/...
--   certa:   https://adscore-keeper-production.up.railway.app/...
--
-- A errada responde HTTP 404 {"message":"Application not found"}. Como o cron
-- só dispara net.http_post e nunca lê a resposta, o 404 voltava para o vazio
-- todo dia, sem log, sem alerta, sem ninguém perceber: processual_emails ficou
-- parada em 28/07 enquanto o Gmail recebia dezenas de push por dia.
--
-- Diagnosticado disparando a chamada na mão e LENDO net._http_response — que é
-- o passo que o cron não faz. Com a URL certa, a mesma chamada trouxe 11
-- e-mails novos na hora e o mais recente passou de 28/07 para o mesmo dia.
--
-- O cron do INSS (gmail-inss-sync-hourly) tinha a mesma URL errada e foi
-- corrigido junto.
--
-- LIÇÃO PARA OS OUTROS CRONS: net.http_post sem leitura da resposta é uma
-- chamada que falha em silêncio. Vale conferir os demais jobs que usam esse
-- padrão.
-- =============================================================================

select cron.unschedule('gmail-processual-sync-hourly');
select cron.schedule('gmail-processual-sync-hourly', '15 * * * *', $CRON$
  select net.http_post(
    url := 'https://adscore-keeper-production.up.railway.app/functions/gmail-processual-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-api-key', (select decrypted_secret from vault.decrypted_secrets where name='RAILWAY_API_KEY' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$CRON$);

select cron.unschedule('gmail-inss-sync-hourly');
select cron.schedule('gmail-inss-sync-hourly', '5 * * * *', $CRON$
  select net.http_post(
    url := 'https://adscore-keeper-production.up.railway.app/functions/gmail-inss-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-api-key', (select decrypted_secret from vault.decrypted_secrets where name='RAILWAY_API_KEY' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$CRON$);

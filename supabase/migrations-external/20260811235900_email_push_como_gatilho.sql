-- =============================================================================
-- Liga o e-mail de push como GATILHO da captura paga, e desliga a varredura
-- completa diária.
--
-- A funcionalidade JÁ EXISTIA (sync-email-push, jm_esc_reabrir_por_cnj,
-- email_push_processados — migration 20260811230000) e estava desligada em dois
-- pontos, sem erro nenhum para denunciar:
--   1. nenhum cron chamava gmail-processual-sync, então processual_emails parou
--      em 28/07 — duas semanas sem sincronizar a caixa;
--   2. nenhum cron chamava sync-email-push, então o gatilho nunca disparou.
--
-- É o mesmo padrão que já derrubou o DataJud e o Escavador antes: a peça existe,
-- ninguém a chama, e o sistema cala em vez de reclamar.
--
-- POR QUE DESLIGAR jm-esc-reabrir: ele reabria os 329 processos toda meia-noite
-- (R$ 65,80/noite, ~R$ 1.974/mês). Com o e-mail dizendo exatamente o que mexeu,
-- reconsultar quem não teve movimentação é dinheiro jogado fora. Passa de
-- "R$ 65,80 por varredura" para "R$ 0,20 x o que moveu".
--
-- E por isso jm-esc-rotina volta a rodar o dia todo (*/20) em vez de só na
-- madrugada: a fila agora só tem o que o push marcou, então sem fila ela não
-- gasta nada — e o documento chega perto do fato, não no dia seguinte.
--
-- REVERSÃO:
--   select cron.unschedule('gmail-processual-sync-hourly');
--   select cron.unschedule('sync-email-push');
--   select cron.schedule('jm-esc-reabrir', '0 3 * * *', $$select public.jm_esc_reabrir()$$);
-- =============================================================================

select cron.schedule('gmail-processual-sync-hourly', '15 * * * *', $CRON$
  select net.http_post(
    url := 'https://adscore-railway-production.up.railway.app/functions/gmail-processual-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (select decrypted_secret from vault.decrypted_secrets where name = 'RAILWAY_API_KEY' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$CRON$);

select cron.schedule('sync-email-push', '35 * * * *', $CRON$
  select net.http_post(
    url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-email-push',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$CRON$);

select cron.unschedule('jm-esc-reabrir');
select cron.unschedule('jm-esc-rotina');
select cron.schedule('jm-esc-rotina', '*/20 * * * *', $$select public.jm_esc_rotina(15)$$);

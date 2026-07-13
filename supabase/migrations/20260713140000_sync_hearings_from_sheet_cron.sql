-- Sincronização automática diária Audiências ↔ planilha (aba AUD 2026).
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
-- O handler roda no Railway (credenciais do Google Sheets só existem lá);
-- nunca deleta linhas — só insere novas e atualiza divergências.
--
-- Rollback:
--   select cron.unschedule('sync-hearings-from-sheet-daily');

-- 08:30 UTC = 05:30 Brasília (depois do sync-process-compromissos das 05:00).
-- A rota /functions do Railway não exige header de auth (RAILWAY_API_KEY não setada);
-- o handler só escreve com o par apply+confirm e não aceita dados do chamador.
select cron.schedule(
  'sync-hearings-from-sheet-daily',
  '30 8 * * *',
  $$
  select net.http_post(
    url := 'https://adscore-keeper-production.up.railway.app/functions/sync-hearings-from-sheet',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"apply": true, "confirm": "SYNC"}'::jsonb,
    timeout_milliseconds := 240000
  )
  $$
);

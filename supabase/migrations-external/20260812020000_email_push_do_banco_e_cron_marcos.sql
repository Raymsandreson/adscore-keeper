-- =============================================================================
-- Três buracos que apareceram juntos no painel do sino em 11/08/2026.
--
-- 1) "Avisos por e-mail 0 de 2819 · 0%"
--    A edge sync-email-push NUNCA foi deployada. O cron das :35 disparava e
--    recebia 404 {"code":"NOT_FOUND"} — visível só em net._http_response, que
--    ninguém lê. Deployada agora; e de quebra ela deixou de falar com a API do
--    Gmail (o único google_oauth_tokens não tem escopo gmail, então o laço
--    pulava a conta) e passou a ler processual_emails, que o Railway já enche
--    de hora em hora com o corpo. Esta migration cria a view da fila dela.
--
-- 2) O rótulo "última entrega" do e-mail estava MENTINDO.
--    A view devolvia max(received_at) — o último e-mail que CHEGOU — num campo
--    que a tela chama de entrega. Com 0 processados, o painel mostrava
--    "última entrega 16:02" para uma entrega que nunca houve. Agora
--    ultimo_concluido é max(processado_em) de verdade (fica nulo enquanto for
--    zero, que é o honesto) e o último recebido vai em iniciou_em, que a tela
--    passa a mostrar como "último e-mail".
--    O na_fila também deixa de exigir process_number: e-mail sem CNJ ainda é
--    e-mail por processar, e escondê-lo fazia a fila parecer menor do que é.
--
-- 3) Marcos/fases do POP congelados desde 08/07/2026.
--    backfill-process-marcos e reclassify-process-marcos estão DEPLOYADAS, mas
--    varrendo cron.job inteiro não havia um único job chamando qualquer uma
--    delas — só rodaram na mão, em 08/08. Zero marcos nos últimos 30 dias.
--    É o mesmo padrão do DataJud e do Escavador antes: a peça existe, ninguém
--    a chama, e o sistema cala em vez de reclamar.
--
--    O cron usa mode 'push', que é o modo barato: consulta só os processos que
--    apareceram no push do e-mail nos últimos `dias` (dezenas por dia, não os
--    780). Diário às 11:00 UTC = 08:00 de Brasília, depois de o gmail sync das
--    :15 e a jm-esc-rotina já terem passado a madrugada inteira.
--
-- REVERSÃO:
--   select cron.unschedule('marcos-push-diario');
--   drop view public.vw_email_push_pendentes;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fila do push: e-mail que ainda não passou pelo parser.
-- Existe como view (e não como filtro no cliente) porque o anti-join contra
-- email_push_processados não cabe no PostgREST sem trazer os 2.819 ids de
-- volta a cada rodada.
-- ---------------------------------------------------------------------------
create or replace view public.vw_email_push_pendentes as
select
  e.gmail_message_id,
  e.subject,
  e.from_addr,
  e.body_text,
  e.received_at
from public.processual_emails e
left join public.email_push_processados p on p.message_id = e.gmail_message_id
where e.deleted_at is null
  and p.message_id is null
order by e.received_at desc;

comment on view public.vw_email_push_pendentes is
  'E-mails de push ainda nao lidos pelo sync-email-push, do mais recente ao mais antigo.';

-- ---------------------------------------------------------------------------
-- Painel do sino: a linha do e-mail para de chamar "entrega" o que e chegada.
-- ---------------------------------------------------------------------------
create or replace view public.vw_jm_captura_status as
with esc as (
  select count(*) as total, count(*) filter (where status='SUCESSO') as concluidos,
    count(*) filter (where status='A_ENVIAR') as na_fila,
    count(*) filter (where status in ('ENVIANDO','PENDENTE')) as em_andamento,
    count(*) filter (where status in ('ERRO','BLOQUEADO_SALDO')) as com_erro,
    min(criado_em) as iniciou_em, max(concluido_em) as ultimo_concluido,
    coalesce(sum(creditos),0) as creditos
  from public.jm_esc_solicitacoes
),
dj as (
  select (select count(*) from public.jm_processos
           where processo_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$') as total,
         (select count(distinct processo_cnj) from public.jm_movimentos
           where captured_at > now() - interval '7 days') as concluidos,
         (select count(*) from public.jm_datajud_req where processed=false) as em_andamento,
         (select max(captured_at) from public.jm_movimentos) as ultimo_concluido
),
em as (
  select count(*) as total,
    count(*) filter (where p.message_id is not null) as concluidos,
    -- Sem CNJ ainda é e-mail por ler: o parser é quem decide, não a coluna.
    count(*) filter (where p.message_id is null) as na_fila,
    max(e.received_at)   as ultimo_recebido,
    max(p.processado_em) as ultimo_processado
  from public.processual_emails e
  left join public.email_push_processados p on p.message_id = e.gmail_message_id
  where e.deleted_at is null
)
select 'escavador'::text as fonte, 'Documentos e estado do processo'::text as descricao,
  esc.total, esc.concluidos, esc.na_fila, esc.em_andamento, esc.com_erro,
  case when esc.total>0 then round(100.0*esc.concluidos/esc.total)::int else 0 end as pct,
  esc.iniciou_em, esc.ultimo_concluido,
  (esc.creditos/100.0)::numeric(10,2) as gasto_reais,
  (esc.na_fila*0.20)::numeric(10,2) as falta_gastar_reais
from esc
union all
select 'datajud', 'Movimentações e código do movimento',
  dj.total, dj.concluidos, greatest(dj.total-dj.concluidos,0), dj.em_andamento, 0,
  case when dj.total>0 then round(100.0*dj.concluidos/dj.total)::int else 0 end,
  null::timestamptz, dj.ultimo_concluido, 0::numeric(10,2), 0::numeric(10,2)
from dj
union all
select 'email', 'inbox#4 tribunais · inbox#3 INSS e MPT',
  em.total, em.concluidos, em.na_fila, 0, 0,
  case when em.total>0 then round(100.0*em.concluidos/em.total)::int else 0 end,
  -- iniciou_em carrega o último e-mail RECEBIDO; ultimo_concluido, o último
  -- efetivamente LIDO pelo parser. Antes os dois eram a mesma coisa e a tela
  -- mostrava chegada como se fosse entrega.
  em.ultimo_recebido, em.ultimo_processado, 0::numeric(10,2), 0::numeric(10,2)
from em;

comment on view public.vw_jm_captura_status is
  'Resumo das tres filas de captura para o sino. Na linha do e-mail, iniciou_em = ultimo e-mail recebido e ultimo_concluido = ultimo e-mail lido pelo parser (nulo enquanto nenhum foi).';

-- ---------------------------------------------------------------------------
-- Marcos/fases voltam a andar sozinhos.
-- ---------------------------------------------------------------------------
-- O Authorization NÃO é escrito aqui: ele é copiado do sync-process-compromissos-daily,
-- que chama outra edge com verify_jwt no mesmo projeto e funciona há meses.
-- Duas razões para não buscar do vault: vault.decrypted_secrets está VAZIO
-- neste projeto (0 linhas — confirmado em 11/08/2026), e um select que não
-- acha nada devolve NULL, o header vira {"Authorization": null} e o cron passa
-- a falhar em silêncio — exatamente o defeito que esta migration conserta.
-- Se aquele job sumir, este select falha alto na hora de aplicar, em vez de
-- agendar um cron quebrado.
do $do$
declare v_auth text;
begin
  select substring(command from 'Bearer [A-Za-z0-9._\-]+')
    into strict v_auth
    from cron.job where jobname = 'sync-process-compromissos-daily';
  if v_auth is null then
    raise exception 'nao achei o Bearer do sync-process-compromissos-daily';
  end if;

  perform cron.schedule('marcos-push-diario', '0 11 * * *', format($CRON$
    select net.http_post(
      url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/backfill-process-marcos',
      headers := jsonb_build_object('Content-Type','application/json','Authorization', %L),
      body := '{"mode":"push","dias":2,"limit":50}'::jsonb,
      timeout_milliseconds := 240000);
  $CRON$, v_auth));

  -- O cron do e-mail nasceu SEM Authorization, quando a função ainda não
  -- existia. Ela subiu com verify_jwt ligada (escreve em dado de cliente e
  -- dispara gasto no Escavador — não pode ser endpoint aberto), então sem este
  -- reagendamento o 404 de antes viraria só um 401, igualmente calado.
  perform cron.unschedule('sync-email-push');
  perform cron.schedule('sync-email-push', '35 * * * *', format($CRON$
    select net.http_post(
      url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-email-push',
      headers := jsonb_build_object('Content-Type','application/json','Authorization', %L),
      body := '{"limite":200,"reabrir_desde_dias":3}'::jsonb,
      timeout_milliseconds := 120000);
  $CRON$, v_auth));
end $do$;

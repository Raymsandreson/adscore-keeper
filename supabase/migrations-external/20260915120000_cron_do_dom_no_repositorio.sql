-- O TICK DO DOM VIRA CÓDIGO — porque ele já sumiu uma vez, calado.
--
-- O Dom só escreve porque um job do pg_cron chama a `dom-rascunho` a cada 2
-- minutos. Esse job nunca esteve aqui: foi criado direto no banco, à mão. Em
-- 10/09/2026 17:42 UTC ele rodou pela última vez (jobid 4817, 2.560 execuções,
-- todas `succeeded`) e desapareceu de `cron.job`. O Dom ficou cinco dias sem
-- escrever uma linha, com 6.354 mensagens de grupo chegando só em 11/09.
--
-- A falha é silenciosa dos dois lados: a edge não dá erro porque não é chamada,
-- e a tela mostra a fila antiga como se fosse do dia. Deploy, build e testes
-- passam todos verdes com o Dom morto. Nada no repositório denunciava a falta —
-- e nada o recriava.
--
-- É o que esta migration conserta: o agendamento passa a ser versionado como o
-- resto. Aplicar de novo é seguro (`unschedule` antes), e quem procurar por
-- "dom-rascunho" no repo agora acha também QUEM a chama.
--
-- OS 2 MINUTOS. Não é número solto: os atrasos do ritmo (3 min na primeira
-- resposta, 2 nas seguintes) só valem se o tick for mais rápido que eles — um
-- cron de 5 em 5 soma de 0 a 5 minutos antes de o atraso começar a contar, e a
-- diferença entre 3 e 2 some no ruído. Mesma razão da migration
-- `20260908180000`, agora escrita onde não se perde.

do $$
declare
  v_comando text;
begin
  -- O comando exato que rodava, recuperado do histórico do job antigo: mantém a
  -- chave fora do arquivo (e fora do git) e garante que o timeout de 180s e o
  -- corpo vazio continuem os mesmos que rodaram 2.560 vezes sem falhar.
  select command into v_comando
    from cron.job_run_details
   where command ilike '%functions/v1/dom-rascunho%'
   order by end_time desc
   limit 1;

  if v_comando is null then
    raise exception
      'Não achei no histórico do pg_cron o comando que chama a dom-rascunho. '
      'Recrie o job à mão com net.http_post para '
      'https://<projeto>.supabase.co/functions/v1/dom-rascunho, '
      'timeout_milliseconds := 180000, e rode esta migration de novo.';
  end if;

  perform cron.unschedule('dom_rascunho_tick')
    where exists (select 1 from cron.job where jobname = 'dom_rascunho_tick');

  perform cron.schedule('dom_rascunho_tick', '*/2 * * * *', v_comando);
end $$;

-- CONFERÊNCIA (não faz parte do conserto, é o que olhar quando ele parecer
-- parado de novo — antes de desconfiar do prompt ou da tela):
--
--   select jobid, schedule, active from cron.job where jobname = 'dom_rascunho_tick';
--   select max(end_time) from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'dom_rascunho_tick');
--
-- E lembrar que o tick sozinho não basta: a RPC `dom_grupos_para_olhar` exige
-- `dom_grupos_piloto.ativo`. Com todos os grupos inativos o cron roda, acerta e
-- não produz nada — que era o segundo defeito encontrado em 15/09/2026.

-- =============================================================================
-- Liga a captura contínua do DataJud.
--
-- POR QUE A CAPTURA ESTAVA PARADA DESDE 09/07 — não foi quebra, foi projeto:
--
--   1. jm_datajud_tick() termina com `perform cron.unschedule('datajud_tick')`
--      quando não há mais o que disparar. Foi feito para carga pontual: encheu,
--      esvaziou, se desligou. Ninguém percebeu porque não houve erro nenhum.
--   2. jm_datajud_fire() só dispara para processo que NUNCA foi pedido
--      ("not exists em jm_datajud_req"). Como 328 dos 344 já tinham linha, ele
--      não redisparava ninguém — servia só para a primeira carga.
--
-- Faltava a peça do meio: RE-perguntar de tempos em tempos. Acompanhar processo
-- não tem fim.
--
-- -----------------------------------------------------------------------------
-- A ARMADILHA DAS 927 REQUISIÇÕES MORTAS
-- -----------------------------------------------------------------------------
-- net._http_response guarda ~6 horas. Se o parse não rodar nesse intervalo, a
-- resposta evapora e a linha em jm_datajud_req fica `processed = false` para
-- sempre — e, pior, passa a BLOQUEAR novas tentativas, porque o fire pula quem
-- já tem linha. Eram 927 nesse estado, de 10/07.
--
-- Apagadas em 11/08 com backup em zz_datajud_req_pendentes_bkp_20260811. Não se
-- perdeu dado: os movimentos capturados vivem em jm_movimentos; o que morreu
-- foram pedidos cuja resposta já não existia.
--
-- Por isso a rotina roda parse ANTES de disparar mais, e a cada 30 min — folga
-- de 12x sobre a janela de expiração.
--
-- VERIFICADO ANTES DE AGENDAR (11/08/2026): refresh(5) disparou 5, as cinco
-- voltaram HTTP 200 com dado real, o parse gravou 18 movimentos novos
-- (37.649 → 37.667) e zerou a fila.
--
-- CUSTO: zero por consulta. O DataJud é API pública do CNJ — diferente do
-- Escavador, que é pago e traz DOCUMENTO, não movimentação. Os dois são
-- complementares: DataJud detecta o marco, Escavador prova com a peça.
--
-- REVERSÃO: select cron.unschedule('jm-datajud-rotina');
-- =============================================================================

create or replace function public.jm_datajud_refresh(p_limit integer default 25, p_dias integer default 7)
returns integer language plpgsql as $function$
declare v_count integer; v_key text;
begin
  select valor into v_key from public.jm_config where chave = 'datajud_api_key';
  if v_key is null then return 0; end if;

  with alvos as (
    select p.processo_cnj as cnj,
           public.jm_datajud_alias(p.processo_cnj) as alias,
           (select max(m.captured_at) from public.jm_movimentos m
             where m.processo_cnj = p.processo_cnj) as ultima
    from public.jm_processos p
    where p.processo_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
      and public.jm_datajud_alias(p.processo_cnj) is not null
      -- Sem isto, cada execução empilharia uma requisição nova no mesmo processo.
      and not exists (
        select 1 from public.jm_datajud_req r
         where r.processo_cnj = p.processo_cnj and r.processed = false
      )
  ),
  ordenados as (
    select cnj, alias from alvos
    where ultima is null or ultima < now() - make_interval(days => p_dias)
    order by ultima nulls first   -- nunca capturado primeiro, depois os mais antigos
    limit p_limit
  ),
  req as (
    select cnj, alias,
      net.http_post(
        url := 'https://api-publica.datajud.cnj.jus.br/api_publica_' || alias || '/_search',
        headers := jsonb_build_object('Authorization','APIKey '||v_key,'Content-Type','application/json'),
        body := jsonb_build_object('size',10,'query',
          jsonb_build_object('match',
            jsonb_build_object('numeroProcesso', regexp_replace(cnj,'\D','','g')))),
        timeout_milliseconds := 15000
      ) as request_id
    from ordenados
  ),
  ins as (
    insert into public.jm_datajud_req (request_id, processo_cnj, tribunal_alias)
    select request_id, cnj, alias from req returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $function$;

comment on function public.jm_datajud_refresh(integer, integer) is
  'Redispara os processos mais desatualizados. Diferente de jm_datajud_fire, que so pega quem nunca foi pedido.';

create or replace function public.jm_datajud_rotina()
returns void language plpgsql as $function$
begin
  perform public.jm_datajud_parse();
  perform public.jm_datajud_refresh(25, 7);
end $function$;

comment on function public.jm_datajud_rotina() is
  'Tick de rotina do DataJud: parse + refresh. Sem auto-unschedule, ao contrario de jm_datajud_tick.';

-- 25 processos a cada 30 min cobrem os 344 em ~7 horas.
select cron.schedule('jm-datajud-rotina', '*/30 * * * *', $$select public.jm_datajud_rotina()$$);

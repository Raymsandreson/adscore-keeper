-- =============================================================================
-- Liga a consulta contínua ao Escavador — a fonte de TEMPO REAL.
--
-- POR QUE NÃO BASTA O DATAJUD (medido em 11/08/2026, sobre 308 processos):
--   menor atraso observado em TODA a base ....  8 dias
--   processos com movimento de até 15 dias ...  16 de 308
--   mediana ..................................  72 dias
-- Nenhum processo, em 308, tinha movimento da semana anterior à captura. Com
-- essa amostra seria impossível se a base estivesse em dia — o piso de 8 dias é
-- defasagem da própria base, não coincidência. O DataJud é remessa dos
-- tribunais, não espelho do processo.
--
-- O Escavador consulta o sistema do tribunal na hora. Custo confirmado na
-- resposta da API: "creditos":"20" = R$ 0,20 por processo, com
-- documentos_publicos = true.
--
-- -----------------------------------------------------------------------------
-- A LACUNA QUE TRAVAVA O CICLO
-- -----------------------------------------------------------------------------
-- jm_esc_disparar marcava ENVIANDO; jm_esc_colher lia PENDENTE; e NADA fazia
-- ENVIANDO → PENDENTE. O Escavador responde com `enviar_callback: "NAO"` — não
-- há webhook para fazer isso por nós. A fila parava em ENVIANDO e o colher
-- nunca via nada.
--
-- jm_esc_confirmar fecha o ciclo: lê a resposta do 'solicitar' em
-- net._http_response, casa pelo numero_cnj devolvido, e move a linha adiante
-- guardando o id da solicitação e os créditos gastos.
--
-- JANELA DE 6h: net._http_response expira. Confirmar tem que acontecer no mesmo
-- ciclo do disparo — se atrasar, a resposta some e a solicitação fica ENVIANDO
-- para sempre. Foi assim que 927 requisições do DataJud morreram. Por isso
-- jm_esc_rotina CONFIRMA e COLHE antes de disparar mais.
--
-- Também: as versões _rotina não têm o `cron.unschedule` que jm_esc_colher e
-- jm_datajud_tick faziam ao esvaziar. Acompanhar processo não termina.
--
-- VERIFICADO ANTES DE AGENDAR: 5 disparos → 5 confirmados (100 créditos =
-- R$ 1,00) → colheita trouxe 60 documentos novos (3.102 → 3.162).
--
-- CONTROLE DE CUSTO — LEIA ANTES DE MUDAR:
-- A rotina só gasta enquanto houver linha em A_ENVIAR. Quando a fila esvazia,
-- ela roda de graça. Para RECONSULTAR é preciso reabrir (SUCESSO → A_ENVIAR), e
-- é essa reabertura que define a conta:
--   329 processos x R$ 0,20 = R$ 65,80 por varredura completa
--   diária ..... ~R$ 1.974/mes   (o saldo de R$ 910 dura 14 dias)
--   semanal .... ~R$   263/mes
--   quinzenal .. ~R$   132/mes
-- NÃO existe cron de reabertura de propósito: a frequência é decisão do usuário.
--
-- REVERSÃO: select cron.unschedule('jm-esc-rotina');
-- =============================================================================

create or replace function public.jm_esc_confirmar()
returns integer language plpgsql as $function$
declare v_n integer := 0;
begin
  with respostas as (
    select
      (x.content::jsonb->>'ok')::boolean                          as ok,
      (x.content::jsonb->>'creditos')                             as creditos,
      (x.content::jsonb->>'resposta')::jsonb ->> 'numero_cnj'     as cnj,
      ((x.content::jsonb->>'resposta')::jsonb ->> 'id')::bigint   as esc_id,
      (x.content::jsonb->>'resposta')::jsonb ->> 'status'         as esc_status,
      x.content::jsonb->>'erro'                                   as erro
    from net._http_response x
    where x.created >= now() - interval '30 minutes'
      and x.status_code between 200 and 299
      and x.content::text like '%numero_cnj%'
  ),
  aplicar as (
    update public.jm_esc_solicitacoes s
       set status = case
             when r.ok and r.esc_status in ('PENDENTE','SUCESSO') then 'PENDENTE'
             when coalesce(r.erro,'') ilike '%saldo%'             then 'BLOQUEADO_SALDO'
             when r.ok is false                                    then 'ERRO'
             else s.status
           end,
           escavador_id = coalesce(r.esc_id, s.escavador_id),
           creditos     = coalesce(nullif(r.creditos,'')::int, s.creditos),
           motivo_erro  = r.erro
      from respostas r
     where s.processo_cnj = r.cnj and s.status = 'ENVIANDO'
    returning 1
  )
  select count(*) into v_n from aplicar;
  return v_n;
end $function$;

comment on function public.jm_esc_confirmar() is
  'Move ENVIANDO -> PENDENTE lendo a resposta do modo solicitar. O Escavador nao manda callback (enviar_callback=NAO), entao a confirmacao e nossa.';

create or replace function public.jm_esc_colher_docs()
returns integer language plpgsql as $function$
declare v_rec record; v_n int := 0;
begin
  for v_rec in
    select processo_cnj from public.jm_esc_solicitacoes
    where status='PENDENTE' order by id limit 15
  loop
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('acao','docs','cnj',v_rec.processo_cnj),
      timeout_milliseconds := 25000);
    v_n := v_n + 1;
  end loop;

  insert into public.jm_documentos (processo_cnj, titulo, tipo, data_documento, link_api)
  select x.content::jsonb->>'cnj', d->>'titulo', d->>'tipo',
         nullif(left(d->>'data',10),'')::date, d->>'link'
  from net._http_response x
  cross join lateral jsonb_array_elements(x.content::jsonb->'items') d
  where x.created >= now() - interval '30 minutes'
    and x.status_code = 200
    and (x.content::jsonb->>'ok') = 'true'
    and jsonb_typeof(x.content::jsonb->'items') = 'array'
    and not exists (select 1 from public.jm_documentos jd
                    where jd.processo_cnj = x.content::jsonb->>'cnj'
                      and jd.link_api = d->>'link');

  update public.jm_esc_solicitacoes s set status='SUCESSO', concluido_em=now()
  where s.status='PENDENTE'
    and exists (select 1 from public.jm_documentos d
                 where d.processo_cnj = s.processo_cnj
                   and d.captured_at >= now() - interval '30 minutes');
  return v_n;
end $function$;

create or replace function public.jm_esc_rotina(p_lote integer default 15)
returns text language plpgsql as $function$
declare v_conf int; v_disp int; v_pend int; v_env int;
begin
  v_conf := public.jm_esc_confirmar();
  perform public.jm_esc_colher_docs();
  v_disp := public.jm_esc_disparar(p_lote);
  select count(*) into v_pend from public.jm_esc_solicitacoes where status='PENDENTE';
  select count(*) into v_env  from public.jm_esc_solicitacoes where status='ENVIANDO';
  return format('confirmadas=%s disparadas=%s pendentes=%s enviando=%s', v_conf, v_disp, v_pend, v_env);
end $function$;

select cron.schedule('jm-esc-rotina', '*/10 * * * *', $$select public.jm_esc_rotina(15)$$);

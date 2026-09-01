-- =============================================================================
-- A FILA DO ESCAVADOR PARA DE GIRAR EM FALSO
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- O QUE FOI MEDIDO (01/09/2026, net._http_response das ultimas 6h):
--   206 x 422 "Esse processo ja foi atualizado hoje."
--    54 x 422 "O numero do processo nao esta no formato CNJ."
--    10 x 201 aceito
-- Os 15 CNJ recusados em cada rodada eram SEMPRE OS MESMOS, e as 15 respostas
-- do disparo das 12:00 UTC tinham o mesmo timestamp ate o microssegundo
-- (2026-09-01 12:00:03.046655) — pg_net despacha o lote inteiro em paralelo.
-- Do lado do Escavador isso aparece como excesso de requisicoes.
--
-- POR QUE AS MESMAS 15 GIRAVAM PARA SEMPRE — tres defeitos encadeados:
--
--   1. jm_esc_destravar olhava a coluna ERRADA. A regra e "ENVIANDO ha mais de
--      2h volta para a fila", mas ela testava criado_em (nascimento da linha),
--      nao a hora do disparo — que nao era gravada em lugar nenhum. Linha
--      criada em 17/08 tem "mais de 2h" SEMPRE, e era resgatada toda rodada.
--
--   2. jm_esc_rotina destravava ANTES de confirmar. Quando jm_esc_confirmar
--      procurava status='ENVIANDO' para ler a resposta, a linha ja tinha
--      voltado para A_ENVIAR: a resposta nunca era lida, o status nunca fechava.
--
--   3. jm_esc_disparar ordenava por id. As 15 travadas (ids 137-514) passavam
--      na frente das 30 legitimas do push de e-mail (ids 515-545) em todas as
--      rodadas. Essas 30 estavam na fila desde 30/08 sem NUNCA terem sido
--      enviadas uma unica vez.
--
-- Resultado: ~1.080 chamadas recusadas por dia, sempre nos mesmos 15 processos,
-- enquanto a captura do que de fato moveu ficava parada. Nao gastava credito
-- (creditos volta nulo no 422), gastava reputacao da conta e tempo real.
--
-- O QUE MUDA
--   enviado_em  — hora do disparo. E ela que o destravar passa a olhar.
--   tentativas  — contador; ao chegar em 3 sem confirmacao a linha vira ERRO
--                 em vez de voltar para a fila. Nada gira eternamente de novo.
--   ordem justa — disparar ordena por (tentativas, id): quem nunca foi enviado
--                 passa na frente de quem ja tentou.
--   confirmar   — "ja foi atualizado hoje" deixa de ser erro e vira PENDENTE:
--                 a atualizacao existe do lado deles, entao a colheita pega os
--                 documentos direto, sem nova consulta e sem credito.
--                 "nao esta no formato CNJ" vira ERRO definitivo.
--   jm_cnj_valido — o digito verificador e conferido ANTES de gastar a chamada.
--                 Conferido contra a base: 541 validos, 3 invalidos (numero
--                 digitado errado no cadastro, o conserto e o cadastro):
--                   0000240-19.2025.5.11.0152  -> DV correto 16
--                   0000240-19.2025.5.11.0153  -> DV correto 13
--                   0810452-32.2026.8.18.0046  -> DV correto 12
--   lote 15 -> 5  — com a fila destravada isso escoa MAIS do que hoje, e some
--                 o pico de 15 requisicoes no mesmo microssegundo.
--
-- NAO MEXE EM: acoes autos/docs/arquivar da edge esc-autos, jm_documentos_ingerir,
-- jm_esc_colher_docs, rotina do DataJud, radar-processos-quietos, front.
--
-- REVERSAO (<5min):
--   alter table public.jm_esc_solicitacoes drop column enviado_em, drop column tentativas;
--   drop function public.jm_cnj_valido(text);
--   jm_esc_disparar / jm_esc_confirmar voltam ao corpo de 20260821170000;
--   jm_esc_destravar / jm_esc_rotina voltam ao corpo de 20260821200000;
--   select cron.unschedule('jm-esc-rotina');
--   select cron.schedule('jm-esc-rotina','*/20 * * * *',$$select public.jm_esc_rotina(15)$$);
-- =============================================================================

-- ── 1. as duas colunas que faltavam ─────────────────────────────────────────
alter table public.jm_esc_solicitacoes
  add column if not exists enviado_em timestamptz,
  add column if not exists tentativas integer not null default 0;

comment on column public.jm_esc_solicitacoes.enviado_em is
  'Hora do POST /solicitar-atualizacao. jm_esc_destravar mede o atraso por AQUI — criado_em e o nascimento da linha e fazia toda linha antiga parecer travada.';
comment on column public.jm_esc_solicitacoes.tentativas is
  'Disparos ja feitos sem confirmacao. Em 3 a linha vira ERRO em vez de voltar para a fila.';

-- ── 2. digito verificador do CNJ, conferido antes de gastar a chamada ───────
-- Regra CNJ: DV = 98 - ((NNNNNNN AAAA J TR OOOO) * 100 mod 97).
-- Validada contra dois numeros que a API aceita (1063857-89 e 0800352-17) e
-- tres que ela recusa.
create or replace function public.jm_cnj_valido(p_cnj text)
returns boolean language sql immutable as $function$
  select case
    when p_cnj is null then false
    when length(regexp_replace(p_cnj, '\D', '', 'g')) <> 20 then false
    else (
      select (substring(s from 8 for 2))::int
           = 98 - mod(((substring(s from 1 for 7) || substring(s from 10 for 11))::numeric) * 100, 97)
      from (select regexp_replace(p_cnj, '\D', '', 'g') as s) d
    )
  end
$function$;

comment on function public.jm_cnj_valido(text) is
  'Confere o digito verificador do numero CNJ. Numero errado no cadastro vira ERRO na fila em vez de 422 recorrente no Escavador.';

-- ── 3. disparo: ordem justa, carimbo de envio, CNJ conferido ────────────────
create or replace function public.jm_esc_disparar(p_limit integer default 5)
returns integer language plpgsql as $function$
declare v_rec record; v_n int := 0; v_body jsonb;
begin
  -- numero invalido nunca vira chamada: o Escavador recusa com 422 toda vez e
  -- a linha voltaria para a fila para sempre. O conserto e o cadastro.
  update public.jm_esc_solicitacoes
     set status = 'ERRO',
         motivo_erro = 'CNJ invalido no cadastro (digito verificador nao confere)'
   where status = 'A_ENVIAR'
     and not public.jm_cnj_valido(processo_cnj);

  for v_rec in
    -- (tentativas, id): quem nunca foi enviado passa na frente de quem ja tentou.
    -- Antes era so id, e as travadas antigas cortavam a fila em toda rodada.
    select id, processo_cnj, modo from public.jm_esc_solicitacoes
    where status = 'A_ENVIAR'
    order by tentativas asc, id asc
    limit p_limit
  loop
    -- autos e documentos_publicos sao mutuamente exclusivos no contrato da API.
    v_body := case when v_rec.modo = 'AUTOS'
      then jsonb_build_object('autos',1,'utilizar_certificado',1,'ignorar_atualizados',1)
      else jsonb_build_object('documentos_publicos',1,'ignorar_atualizados',1)
    end;
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('acao','solicitar','cnj',v_rec.processo_cnj,'body',v_body),
      timeout_milliseconds := 30000);
    update public.jm_esc_solicitacoes
       set status = 'ENVIANDO',
           enviado_em = now(),
           tentativas = tentativas + 1
     where id = v_rec.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

-- ── 4. destravar: mede pelo envio, e desiste depois de 3 ────────────────────
create or replace function public.jm_esc_destravar(p_horas integer default 2)
returns integer language plpgsql as $function$
declare v_n int;
begin
  -- teto de tentativas: para de girar em vez de bater no Escavador para sempre.
  update public.jm_esc_solicitacoes
     set status = 'ERRO',
         motivo_erro = coalesce(motivo_erro || ' | ', '') || 'desistiu apos 3 disparos sem confirmacao'
   where status = 'ENVIANDO'
     and tentativas >= 3
     and coalesce(enviado_em, criado_em) < now() - make_interval(hours => greatest(p_horas, 1));

  with r as (
    update public.jm_esc_solicitacoes
       set status = 'A_ENVIAR', modo = 'PUBLICOS',
           motivo_erro = coalesce(motivo_erro, 'destravado: ENVIANDO sem confirmacao')
     where status = 'ENVIANDO'
       and coalesce(enviado_em, criado_em) < now() - make_interval(hours => greatest(p_horas, 1))
    returning 1
  ) select count(*) into v_n from r;
  return v_n;
end $function$;

comment on function public.jm_esc_destravar(integer) is
  'Devolve para a fila a solicitacao que ficou presa em ENVIANDO, medindo pelo enviado_em. Em 3 disparos sem confirmacao a linha vira ERRO.';

-- ── 5. confirmar: 422 de negocio deixa de virar loop ────────────────────────
create or replace function public.jm_esc_confirmar()
returns integer language plpgsql as $function$
declare v_n integer := 0;
begin
  with respostas as (
    select distinct on (cnj) cnj, ok, creditos, esc_id, esc_status, erro
    from (
      select
        x.content::jsonb->>'cnj'                                    as cnj,
        (x.content::jsonb->>'ok')::boolean                          as ok,
        (x.content::jsonb->>'creditos')                             as creditos,
        nullif(x.content::jsonb->'resposta'->>'id','')::bigint      as esc_id,
        x.content::jsonb->'resposta'->>'status'                     as esc_status,
        coalesce(x.content::jsonb->>'erro',
                 x.content::jsonb->'resposta'->>'message')          as erro,
        x.created
      from net._http_response x
      where x.created >= now() - interval '30 minutes'
        and left(ltrim(x.content), 1) = '{'
        and x.content::jsonb ? 'cnj'
    ) s
    where cnj is not null
    order by cnj, created desc
  ),
  aplicar as (
    update public.jm_esc_solicitacoes s
       set status = case
             -- numero errado no cadastro: erro definitivo, nao volta para a fila
             when coalesce(r.erro,'') ~* 'formato CNJ'              then 'ERRO'
             -- a atualizacao de hoje ja existe do lado deles: da para COLHER
             -- os documentos sem pedir de novo e sem gastar credito.
             when coalesce(r.erro,'') ~* 'atualizado hoje'          then 'PENDENTE'
             -- credencial recusada: nao adianta insistir em AUTOS, cai pro publico
             when r.ok is not true and s.modo = 'AUTOS'
              and coalesce(r.erro,'') ~* '(permiss|credencia|certificad|autentica|login)'
                                                                    then 'A_ENVIAR'
             when r.ok and r.esc_status in ('PENDENTE','SUCESSO')   then 'PENDENTE'
             when coalesce(r.erro,'') ilike '%saldo%'               then 'BLOQUEADO_SALDO'
             when r.ok is not true                                  then 'ERRO'
             else s.status
           end,
           modo = case
             when r.ok is not true and s.modo = 'AUTOS'
              and coalesce(r.erro,'') ~* '(permiss|credencia|certificad|autentica|login)'
             then 'PUBLICOS' else s.modo
           end,
           -- confirmou: o contador zera para nao punir a proxima rodada
           tentativas = case
             when coalesce(r.erro,'') ~* 'atualizado hoje' then 0
             when r.ok and r.esc_status in ('PENDENTE','SUCESSO') then 0
             else s.tentativas
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
  'Le a resposta do solicitar e move a linha adiante. "ja atualizado hoje" vira PENDENTE (colhe sem pagar de novo); "formato CNJ" vira ERRO definitivo. O Escavador nao manda callback.';

-- ── 6. rotina: confirmar ANTES de destravar ─────────────────────────────────
create or replace function public.jm_esc_rotina(p_lote integer default 5)
returns text language plpgsql as $function$
declare v_conf int; v_dest int; v_disp int; v_pend int; v_env int;
begin
  -- A ordem e o conserto: a resposta que chegou e lida antes de qualquer
  -- resgate. Invertido, o destravar apagava o ENVIANDO que o confirmar procura.
  v_conf := public.jm_esc_confirmar();
  v_dest := public.jm_esc_destravar(2);
  perform public.jm_esc_colher_docs();
  v_disp := public.jm_esc_disparar(p_lote);
  select count(*) into v_pend from public.jm_esc_solicitacoes where status='PENDENTE';
  select count(*) into v_env  from public.jm_esc_solicitacoes where status='ENVIANDO';
  return format('confirmadas=%s destravadas=%s disparadas=%s pendentes=%s enviando=%s',
                v_conf, v_dest, v_disp, v_pend, v_env);
end $function$;

-- ── 7. higiene: as 15 presas voltam para a fila em pe de igualdade ──────────
-- tentativas=0 e enviado_em=null: elas entram no ciclo novo do zero. Na
-- primeira rodada a resposta "ja atualizado hoje" vira PENDENTE e a colheita
-- fecha — em vez de mais um giro.
update public.jm_esc_solicitacoes
   set status = 'A_ENVIAR', tentativas = 0, enviado_em = null
 where status = 'ENVIANDO';

-- ── 8. lote menor no cron ───────────────────────────────────────────────────
select cron.unschedule('jm-esc-rotina');
select cron.schedule('jm-esc-rotina', '*/20 * * * *', $$select public.jm_esc_rotina(5)$$);

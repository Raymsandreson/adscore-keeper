-- =============================================================================
-- Alarme de saldo do Escavador (09/09/2026, pedido do Raym).
--
-- O PROBLEMA. O Escavador cobra por consulta e o saldo acaba em silêncio: as
-- solicitações passam a voltar BLOQUEADO_SALDO, os crons param de trazer dado
-- e ninguém vê (doc de 11/08: "R$ 910 duram 14 dias"). Hoje quem gasta:
-- jm-esc (documentos), backfill-process-marcos (movimentações + capa), o
-- botão "Buscar no Escavador" da ficha e, desde hoje, escavador-recem-vinculados.
--
-- O QUE A LEITURA MOSTROU. A API tem endpoint de créditos GRÁTIS (medido:
-- Creditos-Utilizados = 0), na v1:  GET /api/v1/quantidade-creditos
--   → {"quantidade_creditos": 40845, "saldo": 408.45, "saldo_descricao": "R$ 408,45"}
-- (/api/v2/saldo e /api/v2/creditos devolvem 404). A edge esc-autos já tem a
-- ação `get` (GET livre em /api/... para diagnóstico) — é por ela que lemos,
-- sem deploy de nada. Saldo em 09/09 às 21h UTC: R$ 408,45.
--
-- COMO FUNCIONA
--   escavador_saldo            uma linha por leitura (hora em hora); guarda o
--                              request do pg_net e, depois, o saldo lido. O
--                              alerta enviado fica na mesma linha que o gerou.
--   escavador_ler_saldo()      1) confirma leituras pendentes lendo
--                              net._http_response; 2) pede uma leitura nova.
--   vw_escavador_saldo         saldo atual, gasto nas 24 h, média/dia dos
--                              últimos 7 dias (pelo histórico de saldo; enquanto
--                              o histórico tem menos de 1 dia, pelo que
--                              jm_esc_solicitacoes registrou), dias restantes,
--                              bloqueios por saldo nas 24 h, e ALERTA + motivo.
--   escavador_alertar_saldo()  se alerta e o último aviso tem mais de 24 h,
--                              manda WhatsApp pela instância "Dom" (uazapi
--                              /send/text, mesmo contrato do railway) para o
--                              dono da instância "Raym".
--   cron escavador-saldo       de hora em hora: ler, depois alertar.
--
-- QUANDO ALERTA (limiares no corpo da view, documentados lá)
--   saldo < R$ 150  ·  dias restantes < 7  ·  qualquer BLOQUEADO_SALDO nas
--   últimas 24 h  ·  leitura falhando há mais de 6 h (o alarme não pode
--   morrer calado — se não consegue ler, avisa que não consegue ler).
--
-- CUSTO: zero no Escavador (endpoint grátis); 24 chamadas/dia à edge.
--
-- ROTA DE FUGA
--   select cron.unschedule('escavador-saldo');
--   drop function escavador_saldo_tick(), escavador_alertar_saldo(), escavador_ler_saldo();
--   drop view vw_escavador_saldo; drop table escavador_saldo;
-- =============================================================================

create table if not exists public.escavador_saldo (
  id                 bigserial primary key,
  pedido_em          timestamptz not null default now(),
  request_id         bigint,
  lido_em            timestamptz,
  creditos           integer,
  saldo_reais        numeric(12,2),
  erro               text,
  alerta_motivo      text,
  alerta_enviado_em  timestamptz,
  alerta_request_id  bigint
);
comment on table public.escavador_saldo is
  'Leituras do saldo do Escavador (GET /api/v1/quantidade-creditos via esc-autos, grátis), de hora em hora. '
  'alerta_* na linha cujo saldo disparou o aviso.';
alter table public.escavador_saldo enable row level security;
create index if not exists idx_escavador_saldo_lido_em on public.escavador_saldo (lido_em desc) where lido_em is not null;

-- ── 1. Ler ───────────────────────────────────────────────────────────────────
create or replace function public.escavador_ler_saldo()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_conf integer := 0;
  v_req  bigint;
  v_id   bigint;
begin
  -- 1) confirma o que já voltou (net._http_response guarda ~6 h)
  update escavador_saldo s
     set lido_em     = r.created,
         creditos    = case when (r.content::jsonb->>'ok')::boolean
                            then nullif(r.content::jsonb->'resposta'->>'quantidade_creditos', '')::integer end,
         saldo_reais = case when (r.content::jsonb->>'ok')::boolean
                            then nullif(r.content::jsonb->'resposta'->>'saldo', '')::numeric end,
         erro        = case when (r.content::jsonb->>'ok')::boolean then null
                            else left(r.content::text, 300) end
    from net._http_response r
   where r.id = s.request_id and s.lido_em is null
     and r.status_code between 200 and 299;
  get diagnostics v_conf = row_count;

  update escavador_saldo s
     set lido_em = now(), erro = 'sem resposta da edge em 6 h'
   where s.lido_em is null and s.pedido_em < now() - interval '6 hours';

  -- 2) pede uma leitura nova (no máximo uma a cada 50 min)
  if exists (select 1 from escavador_saldo where pedido_em > now() - interval '50 minutes') then
    return jsonb_build_object('confirmadas', v_conf, 'pedida', false);
  end if;

  select net.http_post(
    url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('acao', 'get', 'path', '/api/v1/quantidade-creditos'),
    timeout_milliseconds := 30000
  ) into v_req;

  insert into escavador_saldo (request_id) values (v_req) returning id into v_id;
  return jsonb_build_object('confirmadas', v_conf, 'pedida', true, 'request_id', v_req, 'id', v_id);
end $fn$;

-- ── 2. A view: o que a tela e o alarme leem ─────────────────────────────────
create or replace view public.vw_escavador_saldo as
with ultima as (
  select * from escavador_saldo where saldo_reais is not null order by lido_em desc limit 1
),
ha_24h as (
  select saldo_reais, lido_em from escavador_saldo
   where saldo_reais is not null and lido_em <= (select lido_em from ultima) - interval '24 hours'
   order by lido_em desc limit 1
),
primeira_7d as (
  select saldo_reais, lido_em from escavador_saldo
   where saldo_reais is not null and lido_em >= (select lido_em from ultima) - interval '7 days'
   order by lido_em asc limit 1
),
jm_7d as (
  select coalesce(sum(creditos), 0) / 100.0 / 7 as media_dia
    from jm_esc_solicitacoes
   where coalesce(concluido_em, criado_em) > now() - interval '7 days'
),
bloq as (
  select count(*) as n from jm_esc_solicitacoes
   where status = 'BLOQUEADO_SALDO' and coalesce(concluido_em, criado_em) > now() - interval '24 hours'
),
falha as (
  -- leitura mais recente é erro E não há leitura boa nas últimas 6 h
  select (select erro from escavador_saldo where lido_em is not null order by lido_em desc limit 1) as ultimo_erro,
         not exists (select 1 from escavador_saldo where saldo_reais is not null and lido_em > now() - interval '6 hours') as sem_leitura_boa_6h
),
calc as (
  select u.saldo_reais, u.creditos, u.lido_em,
         greatest((select saldo_reais from ha_24h) - u.saldo_reais, 0) as gasto_24h_reais,
         case
           -- histórico de saldo com pelo menos 1 dia: a média é a de verdade (inclui botão, backfill, tudo)
           when (select lido_em from primeira_7d) <= u.lido_em - interval '1 day'
             then greatest((select saldo_reais from primeira_7d) - u.saldo_reais, 0)
                  / greatest(extract(epoch from (u.lido_em - (select lido_em from primeira_7d))) / 86400.0, 1)
           -- senão, o que jm_esc_solicitacoes registrou (só uma parte do gasto)
           else (select media_dia from jm_7d)
         end as gasto_7d_media_dia,
         (select n from bloq) as bloqueadas_saldo_24h,
         (select ultimo_erro from falha) as ultimo_erro,
         (select sem_leitura_boa_6h from falha) as sem_leitura_boa_6h
    from ultima u
)
select c.saldo_reais, c.creditos, c.lido_em,
       round(c.gasto_24h_reais, 2) as gasto_24h_reais,
       round(c.gasto_7d_media_dia, 2) as gasto_7d_media_dia,
       case when c.gasto_7d_media_dia > 0 then round(c.saldo_reais / c.gasto_7d_media_dia, 1) end as dias_restantes,
       c.bloqueadas_saldo_24h,
       (c.saldo_reais < 150
        or (c.gasto_7d_media_dia > 0 and c.saldo_reais / c.gasto_7d_media_dia < 7)
        or c.bloqueadas_saldo_24h > 0
        or c.sem_leitura_boa_6h) as alerta,
       nullif(concat_ws(' · ',
         case when c.saldo_reais < 150 then 'Saldo abaixo de R$ 150.' end,
         case when c.gasto_7d_media_dia > 0 and c.saldo_reais / c.gasto_7d_media_dia < 7
              then 'No ritmo atual dura menos de 7 dias.' end,
         case when c.bloqueadas_saldo_24h > 0 then c.bloqueadas_saldo_24h || ' solicitação(ões) bloqueada(s) por saldo nas últimas 24 h.' end,
         case when c.sem_leitura_boa_6h then 'Sem conseguir ler o saldo há mais de 6 h: ' || coalesce(c.ultimo_erro, '?') end
       ), '') as motivo,
       (select max(alerta_enviado_em) from escavador_saldo) as alertado_em
  from calc c
union all
-- nenhuma leitura boa ainda: linha só para a tela dizer "ainda não lido"
select null, null, null, null, null, null, 0, false, null, null
 where not exists (select 1 from escavador_saldo where saldo_reais is not null);

comment on view public.vw_escavador_saldo is
  'Saldo atual do Escavador, gasto nas 24 h, média/dia (histórico de saldo; jm_esc_solicitacoes enquanto o histórico '
  'tem < 1 dia), dias restantes e alerta. Limiares: saldo < R$ 150, < 7 dias, BLOQUEADO_SALDO nas 24 h, leitura falhando 6 h.';
grant select on public.vw_escavador_saldo to authenticated, service_role;

-- ── 3. Avisar ────────────────────────────────────────────────────────────────
create or replace function public.escavador_alertar_saldo(p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v    record;
  inst record;
  v_para text;
  v_texto text;
  v_req bigint;
  v_id bigint;
begin
  select * into v from vw_escavador_saldo limit 1;
  if v.saldo_reais is null then
    return jsonb_build_object('enviado', false, 'motivo', 'sem leitura');
  end if;
  if not p_forcar and (not v.alerta or (v.alertado_em is not null and v.alertado_em > now() - interval '24 hours')) then
    return jsonb_build_object('enviado', false, 'alerta', v.alerta, 'alertado_em', v.alertado_em);
  end if;

  select instance_token, coalesce(nullif(base_url, ''), 'https://abraci.uazapi.com') as base_url
    into inst from whatsapp_instances where instance_name = 'Dom' and is_active limit 1;
  if inst is null then
    raise exception 'instância "Dom" não está ativa — sem por onde avisar';
  end if;
  select regexp_replace(owner_phone, '\D', '', 'g') into v_para
    from whatsapp_instances where instance_name = 'Raym' and is_active limit 1;
  if coalesce(v_para, '') = '' then
    raise exception 'instância "Raym" sem owner_phone — sem para quem avisar';
  end if;

  v_texto := '⚠️ *Escavador — saldo*' || E'\n'
          || 'Saldo: R$ ' || to_char(v.saldo_reais, 'FM999G999D00') || ' (' || v.creditos || ' créditos)' || E'\n'
          || case when v.gasto_7d_media_dia > 0 then 'Ritmo: ~R$ ' || to_char(v.gasto_7d_media_dia, 'FM999G999D00') || '/dia → dá para ~' || floor(v.dias_restantes) || ' dias' || E'\n' else '' end
          || case when coalesce(v.motivo, '') <> '' then 'Motivo: ' || v.motivo || E'\n' else '' end
          || case when p_forcar and not v.alerta then '(teste do alarme — sem alerta de verdade agora)' || E'\n' else '' end
          || 'Lido ' || to_char(v.lido_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '. Painel: sino → Saldo do Escavador.';

  select net.http_post(
    url := rtrim(inst.base_url, '/') || '/send/text',
    headers := jsonb_build_object('Content-Type', 'application/json', 'token', inst.instance_token),
    body := jsonb_build_object('number', v_para, 'text', v_texto),
    timeout_milliseconds := 30000
  ) into v_req;

  select id into v_id from escavador_saldo where saldo_reais is not null order by lido_em desc limit 1;
  update escavador_saldo
     set alerta_motivo = coalesce(v.motivo, case when p_forcar then 'teste' end),
         alerta_enviado_em = now(), alerta_request_id = v_req
   where id = v_id;

  return jsonb_build_object('enviado', true, 'request_id', v_req, 'alerta', v.alerta, 'forcado', p_forcar);
end $fn$;

comment on function public.escavador_alertar_saldo(boolean) is
  'Manda WhatsApp (instância Dom → dono da instância Raym) quando vw_escavador_saldo.alerta e o último aviso tem '
  'mais de 24 h. p_forcar = true manda mesmo sem alerta (teste).';

-- ── 4. O tick ────────────────────────────────────────────────────────────────
create or replace function public.escavador_saldo_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  return jsonb_build_object('leitura', escavador_ler_saldo(), 'alerta', escavador_alertar_saldo());
end $fn$;

select cron.schedule('escavador-saldo', '7 * * * *', $$select public.escavador_saldo_tick()$$);

-- =============================================================================
-- ADENDO (09/09/2026, 21h UTC): o primeiro teste NÃO chegou. A instância "Dom"
-- está desconectada no uazapi (503 "WhatsApp disconnected: session is not
-- reconnectable"). Sondado /instance/status nas candidatas: conectadas = Raym,
-- Atendimento Previdenciário, Atendimento Processual; desconectadas = Dom,
-- WHATSJUD IA; prudencio_advogados = token inválido.
--
-- O remetente passa a ser uma LISTA com fallback: Atendimento Processual →
-- Atendimento Previdenciário → Dom. A cada tick, se o último envio da leitura
-- falhou (status ≠ 2xx ou "error":true no corpo), tenta a próxima instância —
-- não espera 24 h para descobrir que o aviso não saiu.
-- =============================================================================
alter table public.escavador_saldo
  add column if not exists alerta_tentativas integer not null default 0,
  add column if not exists alerta_instancia  text;

create or replace function public.escavador_alertar_saldo(p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  c_ordem constant text[] := array['Atendimento Processual', 'Atendimento Previdenciário', 'Dom'];
  v      record;
  ult    record;   -- linha da leitura atual, com o estado do último envio
  resp   record;   -- resposta do uazapi ao último envio
  inst   record;
  v_falhou boolean := false;
  v_nome text;
  v_para text;
  v_texto text;
  v_req bigint;
begin
  select * into v from vw_escavador_saldo limit 1;
  if v.saldo_reais is null then
    return jsonb_build_object('enviado', false, 'motivo', 'sem leitura');
  end if;

  select * into ult from escavador_saldo where saldo_reais is not null order by lido_em desc limit 1;

  -- o último envio (de qualquer leitura) falhou? então o "já avisei" não vale.
  select r.status_code, r.content into resp
    from escavador_saldo s join net._http_response r on r.id = s.alerta_request_id
   where s.alerta_request_id is not null order by s.alerta_enviado_em desc limit 1;
  if resp is not null then
    v_falhou := coalesce(resp.status_code, 0) not between 200 and 299
                or coalesce((resp.content::jsonb->>'error')::boolean, false);
  end if;

  if not p_forcar and not v.alerta then
    return jsonb_build_object('enviado', false, 'alerta', false);
  end if;
  if not p_forcar and not v_falhou and v.alertado_em is not null and v.alertado_em > now() - interval '24 hours' then
    return jsonb_build_object('enviado', false, 'alerta', true, 'alertado_em', v.alertado_em);
  end if;

  -- próxima instância da lista, pela contagem de tentativas desta leitura
  v_nome := c_ordem[(coalesce(ult.alerta_tentativas, 0) % cardinality(c_ordem)) + 1];
  select instance_name, instance_token, coalesce(nullif(base_url, ''), 'https://abraci.uazapi.com') as base_url
    into inst from whatsapp_instances where instance_name = v_nome and is_active limit 1;
  if inst is null then
    raise exception 'instância "%" não está ativa — sem por onde avisar', v_nome;
  end if;
  select regexp_replace(owner_phone, '\D', '', 'g') into v_para
    from whatsapp_instances where instance_name = 'Raym' and is_active limit 1;
  if coalesce(v_para, '') = '' then
    raise exception 'instância "Raym" sem owner_phone — sem para quem avisar';
  end if;

  v_texto := '⚠️ *Escavador — saldo*' || E'\n'
          || 'Saldo: R$ ' || to_char(v.saldo_reais, 'FM999G999D00') || ' (' || v.creditos || ' créditos)' || E'\n'
          || case when v.gasto_7d_media_dia > 0 then 'Ritmo: ~R$ ' || to_char(v.gasto_7d_media_dia, 'FM999G999D00') || '/dia → dá para ~' || floor(v.dias_restantes) || ' dias' || E'\n' else '' end
          || case when coalesce(v.motivo, '') <> '' then 'Motivo: ' || v.motivo || E'\n' else '' end
          || case when p_forcar and not v.alerta then '(teste do alarme — sem alerta de verdade agora)' || E'\n' else '' end
          || 'Lido ' || to_char(v.lido_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '. Painel: sino → Saldo do Escavador.';

  select net.http_post(
    url := rtrim(inst.base_url, '/') || '/send/text',
    headers := jsonb_build_object('Content-Type', 'application/json', 'token', inst.instance_token),
    body := jsonb_build_object('number', v_para, 'text', v_texto),
    timeout_milliseconds := 30000
  ) into v_req;

  update escavador_saldo
     set alerta_motivo = coalesce(v.motivo, case when p_forcar then 'teste' end),
         alerta_enviado_em = now(), alerta_request_id = v_req,
         alerta_tentativas = coalesce(alerta_tentativas, 0) + 1, alerta_instancia = inst.instance_name
   where id = ult.id;

  return jsonb_build_object('enviado', true, 'request_id', v_req, 'instancia', inst.instance_name,
                            'tentativa', coalesce(ult.alerta_tentativas, 0) + 1, 'alerta', v.alerta, 'forcado', p_forcar,
                            'ultimo_envio_tinha_falhado', v_falhou);
end $fn$;

comment on function public.escavador_alertar_saldo(boolean) is
  'WhatsApp para o dono da instância Raym quando vw_escavador_saldo.alerta. Remetente: Atendimento Processual → '
  'Atendimento Previdenciário → Dom, trocando a cada tentativa que falha. 1 aviso por 24 h quando o envio deu certo. '
  'p_forcar = true manda um teste.';

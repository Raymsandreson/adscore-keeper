-- =============================================================================
-- Mensagem agendada: escrever agora, sair na hora marcada — com ou sem repetição.
-- Aplicar no Supabase EXTERNO (WhatsJUD, kmedldlepwiityjsdahz).
--
-- O QUE FALTAVA
-- -------------
-- O campo de mensagem do chat só sabia "enviar agora". Cobrança de documento,
-- bom-dia de acompanhamento, lembrete de perícia, aviso mensal de parcela: tudo
-- isso dependia de alguém lembrar na hora certa — inclusive fora do expediente.
--
-- COMO FUNCIONA
-- -------------
--   1. A tela grava a linha com o TEXTO JÁ PRONTO (`mensagem`), inclusive o
--      prefixo `*Nome:*` de "Identificar remetente". O banco não remonta texto:
--      o que foi escrito na hora de agendar é exatamente o que sai. Assim o
--      envio agendado não pode divergir do envio imediato.
--   2. `wa_agendadas_tick()` roda de minuto em minuto no cron: confere as
--      respostas do disparo anterior, dispara o que venceu e recalcula a
--      próxima data.
--   3. O disparo é o MESMO caminho do envio na hora — a edge function
--      `send-whatsapp` do Externo. Nada de segunda porta de saída para o
--      WhatsApp: resolução de instância, grupo, reconexão e gravação da bolha
--      continuam num lugar só.
--
-- POR QUE NÃO USAR cron.schedule POR MENSAGEM
-- -------------------------------------------
-- Um job de cron por agendamento vira lixo acumulado (job órfão de conversa
-- apagada, nome duplicado, limite do pg_cron) e não sabe responder "o que está
-- agendado para este contato?" — que é justamente o que a tela precisa mostrar.
-- Uma tabela varrida a cada minuto responde as duas coisas e é auditável.
--
-- ATRASO NÃO VIRA ENXURRADA
-- -------------------------
-- Se o tick ficar parado (banco em manutenção, pg_net entupido), o que venceu
-- há mais de 12 horas NÃO sai atrasado: fica registrado como 'pulada' e a
-- recorrência anda para a próxima data. Mandar "bom dia" às 3 da manhã de dois
-- dias depois é pior do que não mandar.
--
-- ROLLBACK
--   select cron.unschedule('wa-mensagens-agendadas');
--   drop function if exists public.wa_agendadas_tick();
--   drop function if exists public.wa_agendadas_disparar(integer);
--   drop function if exists public.wa_agendadas_conferir();
--   drop function if exists public.wa_agendada_proximo(timestamptz, text, integer, text, smallint[], date, integer, integer, timestamptz);
--   drop table if exists public.whatsapp_agendamento_envios;
--   drop table if exists public.whatsapp_mensagens_agendadas;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A tabela
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_mensagens_agendadas (
  id uuid primary key default gen_random_uuid(),

  -- Para onde vai. Mesmos campos que o envio na hora manda para send-whatsapp:
  -- chat_id manda em grupo, phone manda no 1:1, instance_name diz de qual
  -- número sai.
  phone           text not null,
  chat_id         text,
  instance_name   text,
  contact_id      uuid,
  lead_id         uuid,
  contact_name    text,

  -- O texto exatamente como vai sair, com o prefixo `*Nome:*` quando
  -- "Identificar remetente" estava ligado.
  mensagem        text not null,
  -- O que a pessoa digitou, sem prefixo — é isto que a tela mostra e deixa
  -- reaproveitar. Guardar os dois evita ter que desmontar o prefixo depois.
  mensagem_original text,
  -- Citação (UazAPI replyid) e marcações de grupo, quando houver.
  replyid         text,
  mentions        text[],

  -- Quando sai a PRÓXIMA vez. É por esta coluna que o tick varre.
  proximo_envio_at timestamptz not null,

  repeticao       text not null default 'nenhuma'
                    check (repeticao in ('nenhuma','diaria','semanal','mensal','personalizada')),
  -- Só valem em 'personalizada': "a cada N dias/semanas/meses".
  intervalo       integer not null default 1 check (intervalo between 1 and 365),
  unidade         text not null default 'semanas' check (unidade in ('dias','semanas','meses')),
  -- Só vale em 'semanal'. 0 = domingo … 6 = sábado. Vazio/NULL = o mesmo dia da
  -- semana do primeiro envio.
  dias_da_semana  smallint[],
  -- Fim da recorrência. Os dois podem ser NULL = repete sem fim.
  repetir_ate     date,
  max_envios      integer check (max_envios is null or max_envios between 1 and 500),

  ativo           boolean not null default true,
  total_enviado   integer not null default 0,
  ultimo_envio_at timestamptz,
  ultimo_erro     text,
  encerrado_motivo text,     -- 'fim_da_regra' | 'cancelada' | 'limite'

  criado_por      uuid,
  criado_por_nome text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  cancelado_em    timestamptz,
  cancelado_por_nome text
);

comment on table public.whatsapp_mensagens_agendadas is
  'Mensagens do WhatsApp escritas agora para sair depois, com ou sem repeticao. Varrida a cada minuto por wa_agendadas_tick().';
comment on column public.whatsapp_mensagens_agendadas.mensagem is
  'Texto final, ja com o prefixo *Nome:* quando Identificar remetente estava ligado. O banco nao remonta texto.';
comment on column public.whatsapp_mensagens_agendadas.proximo_envio_at is
  'Quando sai a proxima vez. O tick varre por aqui; a recorrencia recalcula depois de cada disparo.';

-- O tick: só as ativas que já venceram. Índice parcial porque o histórico
-- (inativas) cresce sem parar e não interessa para o disparo.
create index if not exists idx_wa_agendadas_vencidas
  on public.whatsapp_mensagens_agendadas (proximo_envio_at)
  where ativo;

-- A tela: "o que está agendado para esta conversa".
create index if not exists idx_wa_agendadas_conversa
  on public.whatsapp_mensagens_agendadas (phone, instance_name, proximo_envio_at desc);

alter table public.whatsapp_mensagens_agendadas enable row level security;

-- Mesmo padrão das demais tabelas internas do Externo: equipe autenticada.
-- Quem agendou não é o único que precisa ver — a conversa é atendida por
-- várias pessoas, e uma mensagem esquecida na fila tem que poder ser cancelada
-- por quem estiver na frente do chat.
drop policy if exists wa_agendadas_select on public.whatsapp_mensagens_agendadas;
create policy wa_agendadas_select
  on public.whatsapp_mensagens_agendadas for select
  to authenticated using (auth.uid() is not null);

drop policy if exists wa_agendadas_insert on public.whatsapp_mensagens_agendadas;
create policy wa_agendadas_insert
  on public.whatsapp_mensagens_agendadas for insert
  to authenticated with check (auth.uid() is not null);

drop policy if exists wa_agendadas_update on public.whatsapp_mensagens_agendadas;
create policy wa_agendadas_update
  on public.whatsapp_mensagens_agendadas for update
  to authenticated using (auth.uid() is not null);

-- Realtime: a conversa é atendida a várias mãos. Quem está com o chat aberto vê
-- a fila mudar quando outra pessoa agenda ou cancela — e vê a mensagem sair da
-- fila sozinha quando o tick dispara.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'whatsapp_mensagens_agendadas'
  ) then
    alter publication supabase_realtime add table public.whatsapp_mensagens_agendadas;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. O histórico de disparos
--
-- Serve para responder "saiu ou não saiu?" — a resposta do pg_net chega depois
-- e some em ~6 horas (net._http_response é efêmero). Sem esta tabela, um envio
-- que falhou às 2h da manhã não deixaria rastro nenhum.
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_agendamento_envios (
  id             uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references public.whatsapp_mensagens_agendadas(id) on delete cascade,
  disparado_em   timestamptz not null default now(),
  previsto_para  timestamptz,
  request_id     bigint,                       -- id em net._http_response
  status         text not null default 'pendente'
                   check (status in ('pendente','enviada','falhou','pulada')),
  erro           text
);

comment on table public.whatsapp_agendamento_envios is
  'Uma linha por disparo de mensagem agendada. status vira enviada/falhou quando wa_agendadas_conferir() le a resposta do pg_net.';

create index if not exists idx_wa_agendamento_envios_pendentes
  on public.whatsapp_agendamento_envios (request_id)
  where status = 'pendente';

create index if not exists idx_wa_agendamento_envios_agendamento
  on public.whatsapp_agendamento_envios (agendamento_id, disparado_em desc);

alter table public.whatsapp_agendamento_envios enable row level security;

drop policy if exists wa_agendamento_envios_select on public.whatsapp_agendamento_envios;
create policy wa_agendamento_envios_select
  on public.whatsapp_agendamento_envios for select
  to authenticated using (auth.uid() is not null);

-- -----------------------------------------------------------------------------
-- 3. Quando sai de novo
--
-- Espelho de `proximoEnvio` em src/lib/mensagemAgendada.ts — a tela mostra a
-- previsão, o banco decide de verdade. Mexeu num, mexa no outro.
--
-- A conta é feita em horário de Brasília: "todo dia às 8h" tem que continuar
-- 8h da manhã, não 8h UTC.
-- -----------------------------------------------------------------------------
create or replace function public.wa_agendada_proximo(
  p_anterior     timestamptz,
  p_repeticao    text,
  p_intervalo    integer,
  p_unidade      text,
  p_dias         smallint[],
  p_repetir_ate  date,
  p_max_envios   integer,
  p_ja_enviados  integer,
  p_agora        timestamptz default now()
) returns timestamptz
language plpgsql
stable
as $fn$
declare
  tz        constant text := 'America/Sao_Paulo';
  v_local   timestamp;          -- a data "sem fuso", em horário de Brasília
  v_cand    timestamptz;
  v_passo   interval;
  v_dias    smallint[];
  v_salto   integer := 0;
begin
  if p_repeticao is null or p_repeticao = 'nenhuma' then
    return null;
  end if;
  if p_max_envios is not null and coalesce(p_ja_enviados, 1) >= p_max_envios then
    return null;
  end if;

  -- Dias da semana: só os válidos, sem repetidos.
  select array_agg(distinct d order by d) into v_dias
    from unnest(coalesce(p_dias, '{}'::smallint[])) as d
   where d between 0 and 6;

  v_passo := case p_repeticao
    when 'diaria' then interval '1 day'
    when 'semanal' then interval '7 days'
    when 'mensal' then interval '1 month'
    when 'personalizada' then
      case coalesce(p_unidade, 'semanas')
        when 'dias'    then make_interval(days   => greatest(1, coalesce(p_intervalo, 1)))
        when 'semanas' then make_interval(weeks  => greatest(1, coalesce(p_intervalo, 1)))
        else                make_interval(months => greatest(1, coalesce(p_intervalo, 1)))
      end
    else null
  end;

  if v_passo is null then
    return null;
  end if;

  v_local := p_anterior at time zone tz;

  -- Teto de segurança: nenhuma regra sã precisa de mil saltos.
  while v_salto < 1000 loop
    v_salto := v_salto + 1;

    if p_repeticao = 'semanal' and coalesce(array_length(v_dias, 1), 0) > 0 then
      -- Com dias marcados, anda de um em um até cair num deles.
      loop
        v_local := v_local + interval '1 day';
        exit when extract(dow from v_local)::smallint = any (v_dias);
      end loop;
    else
      -- `+ interval '1 month'` encurta o dia em mês curto (31/01 → 28/02),
      -- exatamente como o addMonths do date-fns na tela.
      v_local := v_local + v_passo;
    end if;

    v_cand := v_local at time zone tz;

    if p_repetir_ate is not null and v_local::date > p_repetir_ate then
      return null;
    end if;

    -- Disparo atrasado não vira enxurrada: pula o que ficou para trás.
    if v_cand > p_agora then
      return v_cand;
    end if;
  end loop;

  return null;
end
$fn$;

comment on function public.wa_agendada_proximo(timestamptz, text, integer, text, smallint[], date, integer, integer, timestamptz) is
  'Proxima data de envio de uma mensagem agendada. Espelho de proximoEnvio() em src/lib/mensagemAgendada.ts.';

-- -----------------------------------------------------------------------------
-- 4. Confere o disparo anterior
--
-- pg_net responde de forma assíncrona: o http_post devolve um id e a resposta
-- aparece em net._http_response depois. Aqui ela vira 'enviada' ou 'falhou'.
-- -----------------------------------------------------------------------------
create or replace function public.wa_agendadas_conferir()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_envio record;
  v_resp  record;
  v_json  jsonb;
  v_ok    boolean;
  v_erro  text;
  v_count integer := 0;
begin
  for v_envio in
    select id, agendamento_id, request_id, disparado_em
      from public.whatsapp_agendamento_envios
     where status = 'pendente' and request_id is not null
     order by disparado_em
     limit 200
  loop
    select status_code, content, error_msg, timed_out
      into v_resp
      from net._http_response
     where id = v_envio.request_id;

    if not found then
      -- net._http_response guarda ~6h. Sem resposta depois disso, a pergunta
      -- não tem mais como ser respondida — fica registrado o que se sabe.
      if v_envio.disparado_em < now() - interval '6 hours' then
        update public.whatsapp_agendamento_envios
           set status = 'falhou', erro = 'sem resposta do pg_net (expirou)'
         where id = v_envio.id;
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    -- O corpo nem sempre é JSON (proxy caindo devolve HTML). Falha de leitura
    -- aqui não pode derrubar o tick e travar os próximos disparos.
    begin
      v_json := case when v_resp.content ~ '^\s*[{\[]' then v_resp.content::jsonb end;
    exception when others then
      v_json := null;
    end;

    -- send-whatsapp responde 200 com {"success": false, ...} em erro de
    -- negócio (instância desconectada, número inválido) — HTTP 200 sozinho não
    -- quer dizer que a mensagem saiu.
    v_ok := coalesce(v_resp.status_code, 0) between 200 and 299
            and coalesce(v_json ->> 'success', 'false') = 'true';

    if v_ok then
      v_erro := null;
    else
      v_erro := coalesce(
        nullif(v_resp.error_msg, ''),
        case when v_resp.timed_out then 'tempo esgotado' end,
        v_json ->> 'error',
        'HTTP ' || coalesce(v_resp.status_code::text, '?')
      );
    end if;

    update public.whatsapp_agendamento_envios
       set status = case when v_ok then 'enviada' else 'falhou' end,
           erro   = left(v_erro, 500)
     where id = v_envio.id;

    update public.whatsapp_mensagens_agendadas
       set ultimo_erro = case when v_ok then null else left(v_erro, 500) end,
           atualizado_em = now()
     where id = v_envio.agendamento_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$fn$;

-- -----------------------------------------------------------------------------
-- 5. Dispara o que venceu
-- -----------------------------------------------------------------------------
create or replace function public.wa_agendadas_disparar(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Mesma URL que o proxy do Cloud usa. Chave anônima do Externo (a mesma que
  -- já está no bundle do app) porque a function resolve tudo com service_role
  -- por dentro e não depende de quem chamou.
  c_url  constant text := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/send-whatsapp';
  c_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs';

  v_row     record;
  v_req     bigint;
  v_proximo timestamptz;
  v_atrasada boolean;
  v_count   integer := 0;
begin
  for v_row in
    select *
      from public.whatsapp_mensagens_agendadas
     where ativo and proximo_envio_at <= now()
     order by proximo_envio_at
     limit p_limit
     for update skip locked
  loop
    -- Vencida há muito tempo = tick parado. Não sai atrasada.
    v_atrasada := v_row.proximo_envio_at < now() - interval '12 hours';

    if v_atrasada then
      v_req := null;
      insert into public.whatsapp_agendamento_envios
        (agendamento_id, previsto_para, status, erro)
      values
        (v_row.id, v_row.proximo_envio_at, 'pulada',
         'vencida ha mais de 12h — nao enviada para nao chegar fora de hora');
    else
      v_req := net.http_post(
        url := c_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || c_anon,
          'apikey', c_anon
        ),
        body := jsonb_strip_nulls(jsonb_build_object(
          'phone',         v_row.phone,
          'chat_id',       v_row.chat_id,
          'message',       v_row.mensagem,
          'contact_id',    v_row.contact_id,
          'lead_id',       v_row.lead_id,
          'instance_name', v_row.instance_name,
          'replyid',       v_row.replyid,
          'mentions',      case when coalesce(array_length(v_row.mentions, 1), 0) > 0
                                then to_jsonb(v_row.mentions) end,
          -- Mesma regra do envio na hora: a gerência sai pela Cloud API da Meta.
          'channel',       case when lower(trim(coalesce(v_row.instance_name, ''))) = 'cloud_gerencia'
                                then 'cloud' end
        )),
        timeout_milliseconds := 30000
      );

      insert into public.whatsapp_agendamento_envios
        (agendamento_id, previsto_para, request_id)
      values
        (v_row.id, v_row.proximo_envio_at, v_req);
    end if;

    v_proximo := public.wa_agendada_proximo(
      v_row.proximo_envio_at, v_row.repeticao, v_row.intervalo, v_row.unidade,
      v_row.dias_da_semana, v_row.repetir_ate, v_row.max_envios,
      v_row.total_enviado + 1, now()
    );

    update public.whatsapp_mensagens_agendadas
       set total_enviado    = total_enviado + case when v_atrasada then 0 else 1 end,
           ultimo_envio_at  = case when v_atrasada then ultimo_envio_at else now() end,
           proximo_envio_at = coalesce(v_proximo, proximo_envio_at),
           ativo            = v_proximo is not null,
           encerrado_motivo = case when v_proximo is null then 'fim_da_regra' else null end,
           atualizado_em    = now()
     where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$fn$;

comment on function public.wa_agendadas_disparar(integer) is
  'Dispara as mensagens agendadas vencidas pela edge function send-whatsapp e recalcula a proxima data.';

-- -----------------------------------------------------------------------------
-- 6. O tick de minuto
-- -----------------------------------------------------------------------------
create or replace function public.wa_agendadas_tick()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Confere antes de disparar: net._http_response expira em ~6h e o volume por
  -- minuto é baixo, então a resposta do tick anterior sempre chega inteira.
  perform public.wa_agendadas_conferir();
  perform public.wa_agendadas_disparar(20);
end
$fn$;

-- Só o cron dispara. Ninguém do app chama isto direto.
revoke all on function public.wa_agendadas_tick() from public, anon, authenticated;
revoke all on function public.wa_agendadas_disparar(integer) from public, anon, authenticated;
revoke all on function public.wa_agendadas_conferir() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. O relógio
--
-- De minuto em minuto: é a menor granularidade que o pg_cron oferece e é o que
-- a tela promete ("sai às 08:00", não "sai por volta das 08:00"). 20 por
-- rodada = 1.200/hora, folga larga sobre o volume real.
-- -----------------------------------------------------------------------------
select cron.unschedule('wa-mensagens-agendadas')
 where exists (select 1 from cron.job where jobname = 'wa-mensagens-agendadas');

select cron.schedule('wa-mensagens-agendadas', '* * * * *', $CRON$select public.wa_agendadas_tick()$CRON$);

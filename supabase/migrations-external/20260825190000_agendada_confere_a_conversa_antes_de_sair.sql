-- =============================================================================
-- A agendada olha a conversa antes de sair.
-- Aplicar no Supabase EXTERNO (WhatsJUD, kmedldlepwiityjsdahz).
--
-- O PROBLEMA
-- ----------
-- Quase toda mensagem agendada é cobrança de uma resposta que ainda não veio
-- ("Deu certo?", "conseguiu ver o documento?"). Se o cliente responder entre o
-- agendamento e a hora marcada, a cobrança sai assim mesmo — e chega como se
-- ninguém tivesse lido o que ele escreveu. É o tipo de mensagem que faz o
-- cliente perder a confiança no atendimento.
--
-- A REGRA, QUE É DELIBERADAMENTE BURRA
-- ------------------------------------
-- Não sai se o cliente falou DEPOIS da última vez em que olhamos: qualquer
-- mensagem `inbound` na mesma conversa mais nova que o marco. O marco é o mais
-- recente entre agendamento, último envio e última verificação.
--
-- Sem IA de propósito. A pergunta "ele já respondeu?" tem resposta objetiva no
-- banco; mandar um modelo julgar a cada minuto custa dinheiro, erra em
-- silêncio e é impossível de explicar depois ("por que não saiu?"). A regra
-- aqui cabe numa frase e fica registrada em `ultimo_resultado`.
--
-- POR QUE A ÚLTIMA VERIFICAÇÃO ENTRA NO MARCO
-- -------------------------------------------
-- Sem ela, uma recorrente pulada uma vez seria pulada para sempre: a resposta
-- do cliente continuaria "mais nova" que o último envio (que não aconteceu) em
-- toda rodada seguinte. Carimbando a verificação, o próximo envio só é pulado
-- se houver uma resposta NOVA — que é o que "ele respondeu de novo" quer dizer.
--
-- É OPCIONAL, E LIGADO POR PADRÃO. Aviso de audiência, feliz aniversário e
-- lembrete de parcela têm que sair mesmo com a conversa ativa: nesses, a
-- pessoa desliga a chave na hora de agendar.
--
-- ROLLBACK
--   drop function if exists public.wa_agendada_deve_enviar(uuid, timestamptz);
--   alter table public.whatsapp_mensagens_agendadas
--     drop column if exists pular_se_responder,
--     drop column if exists ultima_verificacao_at,
--     drop column if exists ultimo_resultado;
--   (e reaplicar a versão anterior de wa_agendadas_disparar)
-- =============================================================================

alter table public.whatsapp_mensagens_agendadas
  add column if not exists pular_se_responder    boolean not null default true,
  add column if not exists ultima_verificacao_at timestamptz,
  add column if not exists ultimo_resultado      text;

comment on column public.whatsapp_mensagens_agendadas.pular_se_responder is
  'Ligado: nao envia se o cliente respondeu depois do agendamento/ultimo envio. Desligado: sai na hora marcada de qualquer jeito.';
comment on column public.whatsapp_mensagens_agendadas.ultima_verificacao_at is
  'Quando a conversa foi conferida pela ultima vez. Entra no marco para que uma pulada nao vire pulada para sempre.';
comment on column public.whatsapp_mensagens_agendadas.ultimo_resultado is
  'O que aconteceu no ultimo disparo, em portugues, para a tela mostrar sem traduzir codigo.';

-- -----------------------------------------------------------------------------
-- A conferência, isolada numa função só de leitura.
--
-- Separada do disparo de propósito: assim dá para perguntar "esta sairia
-- agora?" em produção, sobre conversa real, sem mandar nada para ninguém.
-- -----------------------------------------------------------------------------
create or replace function public.wa_agendada_deve_enviar(
  p_id    uuid,
  p_agora timestamptz default now()
) returns table (enviar boolean, motivo text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ag        record;
  v_marco     timestamptz;
  v_resposta  timestamptz;
begin
  select * into v_ag from public.whatsapp_mensagens_agendadas where id = p_id;

  if not found then
    return query select false, 'agendamento nao encontrado';
    return;
  end if;

  if not v_ag.ativo then
    return query select false, 'fora da fila';
    return;
  end if;

  if not v_ag.pular_se_responder then
    return query select true, null::text;
    return;
  end if;

  v_marco := greatest(
    v_ag.criado_em,
    coalesce(v_ag.ultimo_envio_at, v_ag.criado_em),
    coalesce(v_ag.ultima_verificacao_at, v_ag.criado_em)
  );

  select max(m.created_at) into v_resposta
    from public.whatsapp_messages m
   where m.phone = v_ag.phone
     and m.direction = 'inbound'
     and m.created_at > v_marco
     and m.created_at <= p_agora
     -- Conversa sem instancia declarada e caso raro; ali qualquer resposta vale.
     and (v_ag.instance_name is null or m.instance_name = v_ag.instance_name);

  if v_resposta is not null then
    return query select false,
      'o cliente respondeu em ' ||
      to_char(v_resposta at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
    return;
  end if;

  return query select true, null::text;
end
$fn$;

comment on function public.wa_agendada_deve_enviar(uuid, timestamptz) is
  'Confere a conversa antes do disparo: devolve false quando o cliente ja respondeu depois do agendamento. So leitura — nao envia nada.';

-- -----------------------------------------------------------------------------
-- O disparo passa a perguntar antes.
--
-- Mudanças em relação à versão de 20260825170000:
--   * chama wa_agendada_deve_enviar() e pula quando a conversa já respondeu;
--   * carimba ultima_verificacao_at e ultimo_resultado em toda rodada;
--   * uma mensagem única pulada por resposta SAI DA FILA (encerrado_motivo
--     'respondida'): a cobrança perdeu o motivo de existir, e deixá-la para o
--     dia seguinte só adiaria a inconveniência.
-- -----------------------------------------------------------------------------
create or replace function public.wa_agendadas_disparar(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c_url  constant text := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/send-whatsapp';
  c_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs';

  v_row       record;
  v_req       bigint;
  v_proximo   timestamptz;
  v_atrasada  boolean;
  v_conferido record;
  v_saiu      boolean;
  v_motivo    text;
  v_encerra   boolean;
  v_count     integer := 0;
begin
  for v_row in
    select *
      from public.whatsapp_mensagens_agendadas
     where ativo and proximo_envio_at <= now()
     order by proximo_envio_at
     limit p_limit
     for update skip locked
  loop
    v_atrasada := v_row.proximo_envio_at < now() - interval '12 hours';
    v_encerra  := false;
    v_saiu     := false;

    select * into v_conferido from public.wa_agendada_deve_enviar(v_row.id, now());

    if v_atrasada then
      v_motivo := 'vencida ha mais de 12h — nao enviada para nao chegar fora de hora';
    elsif not v_conferido.enviar then
      v_motivo := 'nao enviada: ' || coalesce(v_conferido.motivo, 'a conversa dispensou');
      -- Cobrança única que já foi respondida não tem para onde ir.
      v_encerra := v_row.repeticao = 'nenhuma';
    else
      v_motivo := null;
      v_saiu   := true;
    end if;

    if v_saiu then
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
          'channel',       case when lower(trim(coalesce(v_row.instance_name, ''))) = 'cloud_gerencia'
                                then 'cloud' end
        )),
        timeout_milliseconds := 30000
      );

      insert into public.whatsapp_agendamento_envios
        (agendamento_id, previsto_para, request_id)
      values
        (v_row.id, v_row.proximo_envio_at, v_req);
    else
      insert into public.whatsapp_agendamento_envios
        (agendamento_id, previsto_para, status, erro)
      values
        (v_row.id, v_row.proximo_envio_at, 'pulada', v_motivo);
    end if;

    v_proximo := public.wa_agendada_proximo(
      v_row.proximo_envio_at, v_row.repeticao, v_row.intervalo, v_row.unidade,
      v_row.dias_da_semana, v_row.repetir_ate, v_row.max_envios,
      v_row.total_enviado + 1, now()
    );

    update public.whatsapp_mensagens_agendadas
       set total_enviado         = total_enviado + case when v_saiu then 1 else 0 end,
           ultimo_envio_at       = case when v_saiu then now() else ultimo_envio_at end,
           ultima_verificacao_at = now(),
           ultimo_resultado      = v_motivo,
           proximo_envio_at      = coalesce(v_proximo, proximo_envio_at),
           ativo                 = (v_proximo is not null) and not v_encerra,
           encerrado_motivo      = case
                                     when v_encerra then 'respondida'
                                     when v_proximo is null then 'fim_da_regra'
                                   end,
           atualizado_em         = now()
     where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$fn$;

comment on function public.wa_agendadas_disparar(integer) is
  'Dispara as agendadas vencidas pela edge function send-whatsapp, depois de conferir a conversa (wa_agendada_deve_enviar), e recalcula a proxima data.';

revoke all on function public.wa_agendadas_disparar(integer) from public, anon, authenticated;

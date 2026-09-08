-- =============================================================================
-- "Disparei" nao e "chegou": a fila parava de mentir sobre entrega
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- O CASO
-- Em 08/09/2026, 18:21, o painel do atendente virtual carimbou "Ja chegou ao
-- cliente" numa resposta do Caso 23. A mensagem NAO chegou: o WhatsApp do grupo
-- nao tem nada depois das 17:59. O sistema sabia:
--
--   whatsapp_agendamento_envios.status = 'falhou'
--   erro: "Timeout of 30000 ms reached (DNS time: 30000.819 ms)"
--
-- Trinta segundos inteiros so tentando resolver DNS. A requisicao nem abriu
-- conexao. E a mesma linha da agendada dizia, ao mesmo tempo:
--
--   total_enviado   = 1
--   ultimo_envio_at = 21:21:00
--   ultimo_erro     = "Timeout of 30000 ms..."
--
-- Enviei e falhei, juntos, na mesma linha.
--
-- A CAUSA
-- `net.http_post` do pg_net e ASSINCRONO: enfileira e devolve um request_id na
-- hora, sem esperar resposta. `wa_agendadas_disparar` tratava esse retorno como
-- entrega e, na mesma transacao, carimbava `ultimo_envio_at` e somava
-- `total_enviado`. O trigger `trg_dom_marcar_enviada` observa `ultimo_envio_at`
-- e escreve `status='enviada'` no rascunho. A tela le esse status.
--
-- Ou seja: `ultimo_envio_at` significava "consegui enfileirar" e era lido como
-- "o cliente recebeu" — duas coisas diferentes com o mesmo nome. `conferir()`
-- descobria a falha minutos depois, gravava o erro, e nao desfazia nada.
--
-- E o pior tipo de defeito que existe aqui: a tela dizendo ao revisor que o
-- cliente foi atendido quando ele esta esperando. Ninguem vai atras do que o
-- sistema jura ter feito.
--
-- O CONSERTO, em uma frase: quem carimba entrega e quem VIU a confirmacao.
--
--   disparar()  -> registra a TENTATIVA. Nao encosta em ultimo_envio_at nem em
--                  total_enviado. Continua avancando proximo_envio_at, senao a
--                  linha seria pega de novo no tick seguinte e sairia duplicada.
--   conferir()  -> le a resposta do pg_net. So ai carimba entrega. Se falhou,
--                  reagenda; se esgotou, encerra com motivo visivel.
--
-- POR QUE O max_envios NAO QUEBRA
-- `wa_agendada_proximo` devolve null direto quando `repeticao = 'nenhuma'` — que
-- e o caso do atendente virtual e da maioria. Onde ha recorrencia, ela so olha
-- `p_ja_enviados` se `max_envios` estiver setado; com o contador subindo apenas
-- na confirmacao, uma tentativa falha deixa de consumir cota. Isso e o certo:
-- cota e de mensagem ENTREGUE, nao de tentativa.
--
-- ROLLBACK: reaplicar as duas funcoes na versao anterior (git, commit anterior
-- a este). Nenhuma coluna e criada ou removida aqui, nenhum dado e reescrito.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Disparar registra tentativa, nao entrega
-- ---------------------------------------------------------------------------
create or replace function public.wa_agendadas_disparar(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_cloud     boolean;
  v_por_voz   boolean;
  v_body      jsonb;
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
      v_encerra := v_row.repeticao = 'nenhuma';
    else
      v_motivo := null;
      v_saiu   := true;
    end if;

    if v_saiu then
      -- A gerencia sai pela Cloud API da Meta, que e outro contrato: la midia
      -- agendada nao passa, entao essas continuam em texto.
      v_cloud   := lower(trim(coalesce(v_row.instance_name, ''))) = 'cloud_gerencia';
      v_por_voz := v_row.media_url is not null and not v_cloud;

      if v_por_voz then
        v_body := jsonb_strip_nulls(jsonb_build_object(
          'action',        'send_media',
          'phone',         v_row.phone,
          'chat_id',       v_row.chat_id,
          'media_url',     v_row.media_url,
          'media_type',    v_row.media_type,
          -- Sem 'caption' de proposito: com legenda o cliente receberia a voz E
          -- o texto, que e exatamente o que esta mudanca existe para evitar.
          'ptt',           v_row.media_ptt,
          'is_voice',      v_row.media_ptt,
          'contact_id',    v_row.contact_id,
          'lead_id',       v_row.lead_id,
          'instance_name', v_row.instance_name,
          'replyid',       v_row.replyid
        ));
        v_motivo := 'disparada como nota de voz — aguardando confirmacao';
      else
        v_body := jsonb_strip_nulls(jsonb_build_object(
          'phone',         v_row.phone,
          'chat_id',       v_row.chat_id,
          'message',       v_row.mensagem,
          'contact_id',    v_row.contact_id,
          'lead_id',       v_row.lead_id,
          'instance_name', v_row.instance_name,
          'replyid',       v_row.replyid,
          'mentions',      case when coalesce(array_length(v_row.mentions, 1), 0) > 0
                                then to_jsonb(v_row.mentions) end,
          'channel',       case when v_cloud then 'cloud' end
        ));
        -- Audio que nao pode sair falado nao pode sumir calado.
        if v_row.media_url is not null and v_cloud then
          v_motivo := 'audio nao sai por instancia cloud — disparada em texto, aguardando confirmacao';
        else
          v_motivo := 'disparada — aguardando confirmacao';
        end if;
      end if;

      v_req := net.http_post(
        url := c_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || c_anon,
          'apikey', c_anon
        ),
        body := v_body,
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

    -- `total_enviado + 1` continua indo para o calculo porque a pergunta que
    -- ele responde e "se esta sair, sobra proxima?". Quem PERSISTE o contador e
    -- o conferir(), na confirmacao.
    v_proximo := public.wa_agendada_proximo(
      v_row.proximo_envio_at, v_row.repeticao, v_row.intervalo, v_row.unidade,
      v_row.dias_da_semana, v_row.repetir_ate, v_row.max_envios,
      v_row.total_enviado + 1, now()
    );

    -- AQUI ESTAVA O DEFEITO. Este update carimbava `ultimo_envio_at` e somava
    -- `total_enviado` logo depois do `net.http_post` — que so enfileirou. Os
    -- dois saem daqui: agora e o conferir() quem os escreve, e so quando a
    -- resposta confirma. `proximo_envio_at` e `ativo` continuam avancando, sem
    -- isso a mesma linha seria pega no tick seguinte e sairia duas vezes.
    update public.whatsapp_mensagens_agendadas
       set ultima_verificacao_at = now(),
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. Conferir carimba a entrega, e reagenda o que falhou
-- ---------------------------------------------------------------------------
create or replace function public.wa_agendadas_conferir()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Tres tentativas, espacadas. Uma falha de DNS ou de rede costuma passar em
  -- minutos; se nao passar em trinta, nao vai passar sozinha e a mensagem tem
  -- que voltar para uma pessoa em vez de ficar tentando para sempre.
  c_max_tentativas constant integer := 3;

  v_envio  record;
  v_resp   record;
  v_json   jsonb;
  v_ok     boolean;
  v_erro   text;
  v_falhas integer;
  v_espera interval;
  v_ag     record;
  v_count  integer := 0;
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
      if v_envio.disparado_em < now() - interval '6 hours' then
        update public.whatsapp_agendamento_envios
           set status = 'falhou', erro = 'sem resposta do pg_net (expirou)'
         where id = v_envio.id;
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    begin
      v_json := case when v_resp.content ~ '^\s*[{\[]' then v_resp.content::jsonb end;
    exception when others then
      v_json := null;
    end;

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

    if v_ok then
      -- ESTE e o unico lugar do sistema que pode dizer "chegou". O trigger
      -- trg_dom_marcar_enviada observa `ultimo_envio_at`, entao a partir daqui
      -- o rascunho so vira 'enviada' com confirmacao na mao.
      update public.whatsapp_mensagens_agendadas
         set ultimo_envio_at = now(),
             total_enviado   = total_enviado + 1,
             ultimo_erro     = null,
             atualizado_em   = now()
       where id = v_envio.agendamento_id;
    else
      select ativo, repeticao, total_enviado, encerrado_motivo
        into v_ag
        from public.whatsapp_mensagens_agendadas
       where id = v_envio.agendamento_id;

      select count(*) into v_falhas
        from public.whatsapp_agendamento_envios
       where agendamento_id = v_envio.agendamento_id and status = 'falhou';

      -- SO REAGENDA O QUE NUNCA ENTREGOU E NAO TEM RECORRENCIA.
      --
      -- Em mensagem recorrente a proxima ocorrencia ja esta marcada; reenviar a
      -- que falhou entregaria conteudo velho fora de hora. E se ja houve
      -- entrega antes (total_enviado > 0), esta falha e de uma repeticao, nao
      -- da primeira palavra ao cliente.
      if v_ag.repeticao = 'nenhuma'
         and coalesce(v_ag.total_enviado, 0) = 0
         and v_falhas < c_max_tentativas then
        v_espera := case v_falhas when 1 then interval '2 minutes'
                                  when 2 then interval '10 minutes'
                                  else interval '30 minutes' end;
        update public.whatsapp_mensagens_agendadas
           set ativo            = true,
               proximo_envio_at = now() + v_espera,
               encerrado_motivo = null,
               ultimo_erro      = left(v_erro, 500),
               ultimo_resultado = 'tentativa ' || v_falhas || ' de ' || c_max_tentativas
                                  || ' falhou — tentando de novo',
               atualizado_em    = now()
         where id = v_envio.agendamento_id;
      else
        -- Acabou a corda. A mensagem NAO chegou e ninguem vai fingir que
        -- chegou: `ultimo_envio_at` continua nulo, entao o trigger nao dispara
        -- e o rascunho do atendente virtual permanece 'pendente' — de volta
        -- para a fila humana, que e onde ele tem que estar.
        update public.whatsapp_mensagens_agendadas
           set ativo            = false,
               encerrado_motivo = 'falha_no_envio',
               ultimo_erro      = left(v_erro, 500),
               ultimo_resultado = 'nao entregue apos ' || v_falhas || ' tentativa(s)',
               atualizado_em    = now()
         where id = v_envio.agendamento_id;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$function$;

comment on function public.wa_agendadas_disparar(integer) is
  'Dispara os agendamentos vencidos e registra a TENTATIVA. Nao carimba entrega: '
  'pg_net e assincrono e o retorno do http_post e so um numero de protocolo. '
  'Quem escreve ultimo_envio_at/total_enviado e wa_agendadas_conferir().';

comment on function public.wa_agendadas_conferir() is
  'Le a resposta do pg_net e e o UNICO lugar que pode declarar entrega. '
  'Confirmou: carimba ultimo_envio_at e soma total_enviado (o trigger '
  'trg_dom_marcar_enviada so entao marca o rascunho como enviada). Falhou: '
  'reagenda ate 3 vezes (2/10/30 min) quando a mensagem nunca entregou e nao '
  'tem recorrencia; esgotado, encerra com encerrado_motivo = falha_no_envio e '
  'deixa o rascunho de volta na fila humana.';

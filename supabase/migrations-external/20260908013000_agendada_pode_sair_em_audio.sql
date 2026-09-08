-- =============================================================================
-- A fila de envio passa a saber mandar nota de voz.
--
-- O QUE QUEBROU, EM 07/09/2026, NO "Caso 09 - SÓ RAIMUNDA":
-- a cliente mandou três áudios; o Dom gerou a resposta E gerou a fala dela
-- (dom_respostas_pendentes.audio_url, voz Keilane, sem erro); o revisor clicou
-- em "Aprovar e enviar" — e chegou TEXTO no grupo. Quem falou por voz recebeu
-- parágrafo.
--
-- A causa não era o áudio: era o cano. `whatsapp_mensagens_agendadas` só tinha
-- coluna de texto, e `wa_agendadas_disparar()` só sabia montar
-- {"message": ...}. O áudio existia, tocava no painel, e morria ali — não havia
-- por onde ele passar. É a diferença entre gravar o recado e ter telefone.
--
-- Agora a linha da fila carrega mídia. Quando ela vem preenchida, o disparo
-- chama `send-whatsapp` com action=send_media e ptt=true (nota de voz na
-- UazAPI); quando não vem, nada muda — sai o texto como sempre saiu.
--
-- O TEXTO CONTINUA GRAVADO na coluna `mensagem` (que é `not null` e é o que a
-- bolha tracejada mostra na conversa): ele é o registro do que foi dito. O que
-- muda é o que CHEGA no cliente — só a voz, decisão do Raym em 08/09/2026.
--
-- INSTÂNCIA CLOUD FICA DE FORA, de propósito: `channel=cloud` desvia o envio
-- para o Railway, que trata outro contrato. Áudio agendado numa instância
-- `cloud_gerencia` continua saindo como texto, e o motivo fica registrado em
-- `ultimo_resultado` — melhor sair texto do que sumir.
--
-- ROLLBACK (menos de 1 minuto, sem perda de dado):
--   update public.whatsapp_mensagens_agendadas
--      set media_url = null, media_type = null, media_ptt = false
--    where media_url is not null;              -- a fila volta a sair em texto
--   -- e, se precisar do código antigo, reaplique a função da migration
--   -- 20260904210000 (ou qualquer uma anterior a esta): o corpo abaixo só
--   -- acrescenta o ramo de mídia, o ramo de texto é idêntico ao que já rodava.
-- =============================================================================

-- 1. A linha da fila passa a poder carregar um arquivo.
alter table public.whatsapp_mensagens_agendadas
  add column if not exists media_url  text,
  add column if not exists media_type text,
  add column if not exists media_ptt  boolean not null default false;

comment on column public.whatsapp_mensagens_agendadas.media_url is
  'Arquivo publico a enviar no lugar do texto. Nulo = sai texto, como sempre.';
comment on column public.whatsapp_mensagens_agendadas.media_type is
  'MIME do arquivo (ex: audio/mpeg). Manda o send-whatsapp escolher o tipo na UazAPI.';
comment on column public.whatsapp_mensagens_agendadas.media_ptt is
  'Ligado: audio sai como NOTA DE VOZ (type ptt), nao como arquivo de audio.';

-- 2. O disparo: mesmo laço, mesma conferência, mesma janela. Muda só o corpo do
--    POST quando a linha tem mídia.
create or replace function public.wa_agendadas_disparar(p_limit integer DEFAULT 20)
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
      -- A gerência sai pela Cloud API da Meta, que é outro contrato: lá mídia
      -- agendada não passa, então essas continuam em texto.
      v_cloud   := lower(trim(coalesce(v_row.instance_name, ''))) = 'cloud_gerencia';
      v_por_voz := v_row.media_url is not null and not v_cloud;

      if v_por_voz then
        v_body := jsonb_strip_nulls(jsonb_build_object(
          'action',        'send_media',
          'phone',         v_row.phone,
          'chat_id',       v_row.chat_id,
          'media_url',     v_row.media_url,
          'media_type',    v_row.media_type,
          -- Sem 'caption' de propósito: com legenda o cliente receberia a voz E
          -- o texto, que é exatamente o que esta migration existe para evitar.
          'ptt',           v_row.media_ptt,
          'is_voice',      v_row.media_ptt,
          'contact_id',    v_row.contact_id,
          'lead_id',       v_row.lead_id,
          'instance_name', v_row.instance_name,
          'replyid',       v_row.replyid
        ));
        v_motivo := 'enviada como nota de voz';
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
        -- Áudio que não pôde sair falado não pode sumir calado.
        if v_row.media_url is not null and v_cloud then
          v_motivo := 'audio nao sai por instancia cloud — enviada em texto';
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
$function$;

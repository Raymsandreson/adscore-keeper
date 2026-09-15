-- RASCUNHO QUE O TIME JÁ RESPONDEU NÃO É MAIS FILA DE REVISÃO
--
-- A dom-rascunho já sabe o que é a equipe: `dom_numeros_equipe` + a regra
-- `daEquipe` (fromMe, ou remetente na lista), e por isso ela PULA o grupo
-- quando "equipe falou por último". Só que essa conferência acontece uma vez,
-- no instante em que o rascunho nasce. Depois disso ninguém reavalia.
--
-- O resultado, medido em 15/09/2026: dos 449 rascunhos parados na fila, 417
-- já tinham fala da equipe DEPOIS do rascunho — 202 delas em menos de 6 horas.
-- O PREV 661 é o retrato: o cliente perguntou em 10/09 14:42, o Atendimento
-- Previdenciário 2 respondeu por áudio em 11/09 09:41, e cinco dias depois o
-- rascunho continuava esperando alguém revisar uma resposta que já não tem
-- para quem ir.
--
-- Isto aqui NÃO esconde essas linhas. Elas mudam de estado, guardam QUEM
-- respondeu, QUANDO e O QUÊ, e aparecem numa aba própria — quem revisa vê a
-- fala do colega ao lado do rascunho que o Dom tinha escrito, e pode devolver
-- para a fila se o colega tiver respondido outra coisa. Detector, não filtro.

-- 1. O estado novo. O CHECK aceitava cinco valores; agora seis.
alter table public.dom_respostas_pendentes
  drop constraint if exists dom_respostas_pendentes_status_check;

alter table public.dom_respostas_pendentes
  add constraint dom_respostas_pendentes_status_check
  check (status = any (array[
    'pendente'::text, 'aprovada'::text, 'editada'::text,
    'descartada'::text, 'enviada'::text, 'respondida_por_humano'::text
  ]));

-- 2. A EVIDÊNCIA junto com a marca.
--
-- Status sozinho vira fé: "alguém respondeu" sem dizer quem nem o quê obriga
-- a abrir a conversa e caçar a bolha para conferir. Guardando os quatro
-- campos, o cartão se explica sozinho — e, quando a fala do colega for sobre
-- outro assunto, isso fica visível ali, em vez de virar um rascunho sumido.
alter table public.dom_respostas_pendentes
  add column if not exists respondido_humano_em    timestamptz,
  add column if not exists respondido_humano_por    text,
  add column if not exists respondido_humano_texto  text,
  add column if not exists respondido_humano_msg_id uuid;

comment on column public.dom_respostas_pendentes.respondido_humano_em is
  'Quando a primeira fala da equipe apareceu no grupo DEPOIS deste rascunho.';
comment on column public.dom_respostas_pendentes.respondido_humano_por is
  'Quem falou — senderName do WhatsApp, ou o nome do chip em dom_numeros_equipe.';
comment on column public.dom_respostas_pendentes.respondido_humano_texto is
  'Os primeiros 300 caracteres do que o colega disse, para conferir sem abrir a conversa.';
comment on column public.dom_respostas_pendentes.respondido_humano_msg_id is
  'A linha de whatsapp_messages que serviu de prova. A mesma mensagem existe em '
  'várias cópias (uma por instância nossa no grupo); esta é a que foi lida.';

-- 3. A varredura.
--
-- Parte das MENSAGENS da janela, não da tabela inteira: `idx_whatsapp_messages_created_at`
-- corta 1,8 milhão de linhas para as poucas milhares do período, e o `lateral`
-- escolhe, para cada rascunho, a PRIMEIRA fala da equipe posterior a ele.
-- Medido em 15/09/2026 com janela de 24h: 905 ms. Nenhum índice novo.
--
-- Quem é "equipe" é a MESMA regra da dom-rascunho (index.ts, linha 1765):
-- `fromMe` é nosso envio, e remetente na lista de números também é nosso.
-- Duas regras diferentes para a mesma pergunta divergiriam na primeira vez
-- que alguém trocasse de chip. Conferido em 15/09/2026: das 933 mensagens com
-- `fromMe` em grupo nos últimos 3 dias, ZERO ficam fora de dom_numeros_equipe.
--
-- A JANELA IMPORTA. Com `p_desde` curto, a primeira fala da equipe pode ter
-- ficado de fora e a marcada será uma posterior — o status continua certo, a
-- hora fica mais tarde que a verdade. Por isso o cron usa 24h (aguenta o
-- serviço ficar parado um dia inteiro sem perder nada) e o backfill usa uma
-- janela que cobre a fila toda.
create or replace function public.dom_marcar_respondidas_por_humano(
  p_desde interval default interval '24 hours'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  with falas as (
    select
      m.phone      as group_jid,
      m.created_at as quando,
      m.id         as msg_id,
      coalesce(
        nullif(m.metadata->'message'->>'senderName', ''),
        e.nome,
        'alguém do time'
      ) as autor,
      -- Mídia não tem texto, e "" no cartão pareceria bug. O tipo já diz o
      -- bastante para quem confere: áudio respondido é resposta.
      left(
        coalesce(
          nullif(m.message_text, ''),
          '[' || coalesce(nullif(m.message_type, ''), 'mensagem') || ']'
        ), 300
      ) as texto
    from public.whatsapp_messages m
    left join public.dom_numeros_equipe e
      on e.ativo
     and e.phone = regexp_replace(
           coalesce(
             nullif(m.metadata->'message'->>'sender_pn', ''),
             m.metadata->'message'->>'sender',
             ''
           ), '\D', '', 'g')
    where m.created_at > now() - p_desde
      and (
        coalesce((m.metadata->'message'->>'fromMe')::boolean, false)
        or e.phone is not null
      )
  ),
  alvo as (
    select p.id, p.agendamento_id, r.quando, r.autor, r.texto, r.msg_id
      from public.dom_respostas_pendentes p
      cross join lateral (
        select f.quando, f.autor, f.texto, f.msg_id
          from falas f
         where f.group_jid = p.group_jid
           and f.quando > p.criado_em
         order by f.quando
         limit 1
      ) r
     where p.status in ('pendente', 'aprovada', 'editada')
       and p.atendente_id is null
  ),
  -- A resposta agendada que ainda não saiu não pode sair DEPOIS do colega.
  -- Hoje são zero (o modo automático está parado), mas marcar o rascunho como
  -- respondido e deixar o agendamento vivo seria escrever uma coisa no painel
  -- e fazer outra no grupo. `respondida` é o mesmo motivo que a
  -- wa_agendadas_disparar já usa quando a conversa dispensa o envio.
  fechar_agendamento as (
    update public.whatsapp_mensagens_agendadas a
       set ativo            = false,
           encerrado_motivo = 'respondida',
           ultimo_resultado = 'o time respondeu no grupo antes de esta sair',
           atualizado_em    = now()
      from alvo
     where a.id = alvo.agendamento_id
       and a.ativo
       and a.ultimo_envio_at is null
    returning a.id
  ),
  marcar as (
    update public.dom_respostas_pendentes p
       set status                   = 'respondida_por_humano',
           respondido_humano_em     = alvo.quando,
           respondido_humano_por    = alvo.autor,
           respondido_humano_texto  = alvo.texto,
           respondido_humano_msg_id = alvo.msg_id
      from alvo
     where p.id = alvo.id
    returning p.id
  )
  select count(*) into v_n from marcar;

  return v_n;
end
$function$;

comment on function public.dom_marcar_respondidas_por_humano(interval) is
  'Tira da fila de revisão o rascunho cujo grupo já recebeu fala da equipe '
  'depois dele, guardando quem falou, quando e o quê. Idempotente: só mexe em '
  'quem ainda está em pendente/aprovada/editada sem atendente.';

-- 4. De dez em dez minutos. A conta é de ~1s; o que ela evita é a atendente
--    abrir um cartão para descobrir que ela mesma já respondeu ontem.
select cron.unschedule('dom-respondida-por-humano')
 where exists (select 1 from cron.job where jobname = 'dom-respondida-por-humano');

select cron.schedule(
  'dom-respondida-por-humano',
  '*/10 * * * *',
  $$select public.dom_marcar_respondidas_por_humano(interval '24 hours')$$
);

-- ROLLBACK (testado antes de subir):
--   select cron.unschedule('dom-respondida-por-humano');
--   drop function if exists public.dom_marcar_respondidas_por_humano(interval);
--   update public.dom_respostas_pendentes
--      set status = 'pendente', respondido_humano_em = null, respondido_humano_por = null,
--          respondido_humano_texto = null, respondido_humano_msg_id = null
--    where status = 'respondida_por_humano';
--   alter table public.dom_respostas_pendentes
--     drop constraint dom_respostas_pendentes_status_check,
--     add constraint dom_respostas_pendentes_status_check
--     check (status = any (array['pendente','aprovada','editada','descartada','enviada']));
--   alter table public.dom_respostas_pendentes
--     drop column respondido_humano_em, drop column respondido_humano_por,
--     drop column respondido_humano_texto, drop column respondido_humano_msg_id;

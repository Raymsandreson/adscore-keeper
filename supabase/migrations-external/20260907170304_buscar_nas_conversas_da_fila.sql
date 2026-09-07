-- =============================================================================
-- Busca por texto dentro das conversas dos grupos que têm rascunho por enviar.
--
-- PARA QUE
-- Quem revisa a fila do assessor precisa saber do que se falou naquele grupo
-- antes de aprovar a resposta. Hoje isso é rolar a conversa no olho.
--
-- O RECORTE
-- Só os grupos com rascunho `pendente` — 77 grupos, 54.769 mensagens em
-- 07/09/2026. É esse recorte que torna a busca viável sem índice novo:
-- `whatsapp_messages` tem 1.735.085 linhas e 7,1 GB, e um GIN de trigram nessa
-- tabela custaria caro para servir uma tela que olha 3% dela.
--
-- Medido: 200 ms com limite 50, por Index Scan em idx_whatsapp_messages_phone.
--
-- A DEDUPLICAÇÃO NÃO É ENFEITE
-- Mensagem de grupo é gravada UMA VEZ POR INSTÂNCIA da casa que está no grupo.
-- Sem dedup, quem busca "perícia" num grupo onde cinco instâncias nossas estão
-- dentro recebe a mesma frase cinco vezes. A chave é `message.messageid` do
-- payload da UazAPI, que é o id da mensagem no WhatsApp — `external_message_id`
-- não serve porque vem prefixado pelo dono da instância
-- ("558695590127:3AA22DDE..."), então a mesma mensagem tem um valor diferente
-- em cada linha.
-- =============================================================================

create or replace function public.buscar_nas_conversas_da_fila(
  p_termo  text,
  p_limite integer default 50
)
returns table (
  group_jid     text,
  group_name    text,
  quem_falou    text,
  direcao       text,
  quando        timestamptz,
  trecho        text,
  message_id    uuid,
  pendencia_id  uuid,
  intencao      text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with fila as (
    select distinct on (p.group_jid)
           p.group_jid, p.group_name, p.id as pendencia_id, p.intencao
      from public.dom_respostas_pendentes p
     where p.status = 'pendente'
     order by p.group_jid, p.criado_em desc
  ),
  achado as (
    select distinct on (coalesce(m.metadata -> 'message' ->> 'messageid', m.id::text))
           f.group_jid, f.group_name, f.pendencia_id, f.intencao,
           coalesce(nullif(m.metadata -> 'message' ->> 'senderName', ''), m.contact_name) as quem_falou,
           m.direction, m.created_at, m.message_text, m.id
      from fila f
      join public.whatsapp_messages m on m.phone = f.group_jid
     where m.message_text is not null
       and unaccent(m.message_text) ilike unaccent('%' || btrim(coalesce(p_termo, '')) || '%')
     order by coalesce(m.metadata -> 'message' ->> 'messageid', m.id::text), m.created_at
  )
  select a.group_jid, a.group_name, a.quem_falou, a.direction, a.created_at,
         -- Trecho em volta do termo, não o começo da mensagem: numa mensagem
         -- longa o que interessa raramente está nos primeiros 120 caracteres.
         case
           when position(lower(unaccent(btrim(p_termo))) in lower(unaccent(a.message_text))) > 60
             then '…' || substr(regexp_replace(a.message_text, '\s+', ' ', 'g'),
                    position(lower(unaccent(btrim(p_termo))) in lower(unaccent(a.message_text))) - 60, 200) || '…'
           else left(regexp_replace(a.message_text, '\s+', ' ', 'g'), 200)
         end,
         a.id, a.pendencia_id, a.intencao
    from achado a
   order by a.created_at desc
   limit greatest(p_limite, 1);
$$;

comment on function public.buscar_nas_conversas_da_fila(text, integer) is
  'Busca texto nas mensagens dos grupos com rascunho pendente. Deduplica por messageid da UazAPI (a mesma mensagem e gravada uma vez por instancia).';

grant execute on function public.buscar_nas_conversas_da_fila(text, integer) to authenticated;

-- =============================================================================
-- ROLLBACK
-- drop function if exists public.buscar_nas_conversas_da_fila(text, integer);
-- Só leitura. Não cria tabela, não cria índice, não altera dado.
-- =============================================================================

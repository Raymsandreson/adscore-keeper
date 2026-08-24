-- Opt-out de WhatsApp: quem pede para parar, para de receber — e o lead fecha.
-- Aplicar no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA (medido no Externo em 24/08/2026, janela de 30 dias):
--   Cinco números morreram no período — ISRAEL ATENDIMENTO (11/08), Karolyne
--   (11/08, viveu 4 dias), Mateus (12/08), Atendimento Previdenciário (14/08),
--   Analyne (18/08) — e o que separa eles dos que seguem vivos não é volume de
--   mensagem, é conversa que nasce muda:
--     Prev. Edilan 58,0% | Mateus 55,9% | Karolyne 55,9% | ISRAEL 43,7% |
--     Analyne 43,7%   <- todos mortos
--     Luiz 38,7% | Andressa 35,4% | Processual 17,2% | João Manoel 15,7% |
--     Raym 13,0%      <- todos vivos
--   (% de conversas 1:1 que ABRIMOS e que nunca receberam uma única resposta.)
--
--   Em cima disso, insistência no silêncio: 672 conversas sem nenhuma resposta,
--   das quais 461 receberam 2+ mensagens, 161 receberam 4+ e 7 receberam 13+
--   (387 mensagens gastas em 7 pessoas que nunca falaram). Os templates de
--   retomada mais usados são literalmente "Vi que você ainda não me respondeu".
--   Sem uma saída barata, o lead que não quer só tem dois caminhos: ignorar
--   (envenena a instância) ou denunciar (mata a instância).
--
--   E hoje nada segura o envio: `leads.is_blocked` existe e está em 0 de 21.439
--   leads, e NENHUMA das ~40 chamadas de send-whatsapp consulta esse campo. Se
--   o lead pedir para parar, o sistema continua mandando.
--
-- O QUE ESTA MIGRATION CRIA:
--   1. `wa_optout_key(text)` — chave canônica do telefone. Precisa existir
--      porque o mesmo número aparece nas duas formas no banco: 1.372 números
--      com 12 dígitos (sem o 9º) e 729 com 13 (com o 9º) nos últimos 30 dias.
--      Sem normalizar, o opt-out registrado numa forma não bloqueia a outra.
--   2. `whatsapp_optouts` — quem pediu para parar, quando, por onde e por quê.
--      Índice único parcial garante um opt-out ATIVO por número; revogar é
--      carimbar `revoked_at`, nunca apagar a linha (o registro do pedido é a
--      nossa defesa em caso de reclamação — LGPD art. 18).
--
-- O QUE NÃO MUDA AQUI:
--   Nenhum dado existente é tocado — nenhum UPDATE, nenhum backfill. A tabela
--   nasce vazia. Quem passa a respeitá-la são as edge functions send-whatsapp
--   (gate de envio) e whatsapp-optout (registro + fechamento do lead), no mesmo
--   commit. O fechamento do lead usa `lead_status = 'closed'`, que é o status
--   que já existe e já tem 3.114 leads.
--
-- ROLLBACK (reversível em <1min, nesta ordem):
--   drop table public.whatsapp_optouts;
--   drop function public.wa_optout_key(text);
--   As edge functions tratam erro de consulta como "não há opt-out" e seguem
--   enviando — derrubar a tabela não derruba o envio.

-- 1) Chave canônica: 55 + DDD + 8 últimos dígitos.
--    Casa 5591987654321 (13, com 9º) com 559187654321 (12, sem 9º).
create or replace function public.wa_optout_key(raw text)
returns text
language sql
immutable
as $$
  with somente_digitos as (
    -- corta o sufixo do JID ANTES de filtrar dígitos, igual à versão TS: sem
    -- isto, um dia um sufixo com dígito entraria no meio da chave
    select regexp_replace(regexp_replace(coalesce(raw, ''), '@.*$', ''), '\D', '', 'g') as v
  ),
  com_pais as (
    -- 10-11 dígitos = número brasileiro sem DDI; qualquer outra coisa fica como veio
    select case when length(v) between 10 and 11 then '55' || v else v end as v
    from somente_digitos
  ),
  sem_nono as (
    -- 55 + DDD + 9XXXXXXXX (13 dígitos) -> derruba o 9º dígito
    select case
             when left(v, 2) = '55' and length(v) = 13 and substr(v, 5, 1) = '9'
               then substr(v, 1, 4) || substr(v, 6)
             else v
           end as v
    from com_pais
  )
  select nullif(v, '') from sem_nono;
$$;

comment on function public.wa_optout_key(text) is
  'Chave canônica de telefone para opt-out: 55+DDD+8 dígitos. Espelhada em TS nas edges send-whatsapp e whatsapp-optout — mudar aqui exige mudar lá.';

-- 2) Registro dos pedidos de parada.
create table if not exists public.whatsapp_optouts (
  id             uuid primary key default gen_random_uuid(),
  phone_key      text not null,
  phone_raw      text not null,
  instance_name  text,
  lead_id        uuid,
  -- de onde veio o pedido: 'whatsapp_button' (balão), 'whatsapp_text'
  -- (escreveu "pare"), 'manual' (equipe marcou na tela)
  source         text not null default 'whatsapp_text',
  reason         text,
  message_text   text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  revoked_at     timestamptz,
  revoked_reason text
);

-- Um opt-out ATIVO por número. Revogado não conflita — dá para pedir para
-- parar, voltar atrás e pedir para parar de novo, com as três linhas guardadas.
create unique index if not exists uq_wa_optouts_ativo
  on public.whatsapp_optouts (phone_key)
  where revoked_at is null;

-- O gate de envio consulta por phone_key + revoked_at is null a CADA envio 1:1.
create index if not exists idx_wa_optouts_key
  on public.whatsapp_optouts (phone_key)
  where revoked_at is null;

create index if not exists idx_wa_optouts_created
  on public.whatsapp_optouts (created_at desc);

create index if not exists idx_wa_optouts_lead
  on public.whatsapp_optouts (lead_id)
  where lead_id is not null;

alter table public.whatsapp_optouts enable row level security;

-- A equipe precisa ver quem saiu (e poder marcar/desmarcar pela tela).
drop policy if exists wa_optouts_authenticated_all on public.whatsapp_optouts;
create policy wa_optouts_authenticated_all on public.whatsapp_optouts
  for all to authenticated using (true) with check (true);

comment on table public.whatsapp_optouts is
  'Quem pediu para não receber mais mensagens. Consultada pelo gate da edge send-whatsapp antes de todo envio 1:1. Linha nunca é apagada: revogar = carimbar revoked_at.';

-- 3) Fechar o lead de quem pediu para sair.
--
-- ATENÇÃO AO STATUS ESCOLHIDO — 'refused', NÃO 'closed'.
--   O pedido original foi "coloca com o status fechado o lead". Só que neste
--   banco `lead_status = 'closed'` não significa "encerrado": significa VIROU
--   CLIENTE. Duas triggers já instaladas provam isso e disparariam junto:
--     - `auto_stamp_became_client_date`: closed -> carimba became_client_date
--       com a data de hoje;
--     - `auto_classify_contacts_on_lead_close`: closed -> UPDATE em contacts
--       marcando todos os contatos do lead como classification = 'client'.
--   Fechar como 'closed' quem acabou de pedir para nunca mais ser contatado
--   criaria cliente falso na base e sujaria a taxa de conversão com o inverso
--   do que aconteceu.
--
--   'refused' faz o que se quer sem esse efeito: o card sai do funil ativo
--   igual, a trigger `notify_lead_result_label_change` mapeia para a etiqueta
--   'refused' no WhatsApp, e nenhum contato vira cliente. Já são 142 leads
--   nesse status hoje — não é status novo.
--
--   PARA TROCAR PARA 'closed' MESMO ASSIM: é o default do parâmetro abaixo e a
--   constante OPTOUT_LEAD_STATUS na edge whatsapp-optout. Uma linha em cada.
--
-- Só mexe em lead ABERTO: quem já está closed/refused/inviavel/cancelled fica
-- como está — o opt-out não reabre nem reescreve desfecho já registrado.
-- `p_lead_id` existe porque casar por telefone não alcança todo mundo: 9.824
-- dos 21.439 leads estão com `lead_phone` nulo. Dos 2.103 números que tiveram
-- conversa 1:1 nos últimos 30 dias, 415 casam com lead por telefone e 416 têm
-- `lead_id` gravado na própria mensagem — quase o mesmo conjunto, mas o webhook
-- já sabe o lead da conversa e passar esse id fecha o caso em que o cadastro
-- tem o vínculo e não tem o telefone. Os dois caminhos somam, sem duplicar.
create or replace function public.wa_optout_fecha_leads(
  p_phone_key text,
  p_reason    text default 'Pediu para não receber mais mensagens (opt-out WhatsApp)',
  p_status    text default 'refused',
  p_lead_id   uuid default null
)
returns setof uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (p_phone_key is null or p_phone_key = '') and p_lead_id is null then
    return;
  end if;

  return query
  update public.leads l
     set lead_status        = p_status,
         lead_status_reason = p_reason,
         is_blocked         = true
   where (
           (p_phone_key is not null and p_phone_key <> ''
             and l.lead_phone is not null
             and public.wa_optout_key(l.lead_phone) = p_phone_key)
           or (p_lead_id is not null and l.id = p_lead_id)
         )
     and l.lead_status not in ('closed', 'refused', 'inviavel', 'cancelled')
  returning l.id;
end;
$$;

comment on function public.wa_optout_fecha_leads(text, text, text) is
  'Fecha os leads abertos de um número que pediu opt-out. Status default refused (closed = virou cliente neste banco). Retorna os ids fechados.';

-- Sem este índice a função varre as 21.439 linhas de `leads` a cada opt-out.
-- Tabela pequena: a criação leva milissegundos e o lock é desprezível — por
-- isso sem CONCURRENTLY (que nem rodaria dentro da transação da migration).
create index if not exists idx_leads_phone_key
  on public.leads (public.wa_optout_key(lead_phone))
  where lead_phone is not null;

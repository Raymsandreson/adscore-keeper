-- Participação no chat da ficha: quem foi marcado (ou já falou) continua
-- recebendo as mensagens daquele chat — atividade, lead, processo, contato,
-- POP — até apertar "Finalizar participação".
--
-- Antes, só a mensagem que continha o @ virava popup: a resposta que vinha
-- depois passava batido, e quem marcou ficava sem saber que foi respondido.
--
-- user_id é o UUID do CLOUD (mesmo espaço de team_chat_messages.sender_id e
-- team_chat_mentions.mentioned_user_id). entity_id é text porque no chat de
-- ficha ele pode não ser uuid (conversa de WhatsApp, por exemplo).
--
-- Rollback (<1min): DROP TABLE IF EXISTS public.team_chat_thread_followers;

create table if not exists public.team_chat_thread_followers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  entity_type text not null,
  entity_id   text not null,
  entity_name text,
  -- Por que está seguindo: marcado por alguém ou porque falou no chat.
  reason      text not null default 'mention' check (reason in ('mention', 'message')),
  joined_at   timestamptz not null default now(),
  -- Preenchido por "Finalizar participação": para de receber, sem apagar o histórico.
  left_at     timestamptz,
  unique (user_id, entity_type, entity_id)
);

-- O popup pergunta "quais threads eu sigo?" a cada carga do app.
create index if not exists idx_thread_followers_user_ativo
  on public.team_chat_thread_followers (user_id)
  where left_at is null;

alter table public.team_chat_thread_followers enable row level security;

-- Mesmo padrão das demais tabelas internas do Externo: equipe autenticada.
-- O INSERT é feito pelo cliente de QUEM ENVIA a mensagem (é ele quem sabe quem
-- foi marcado), então não dá pra amarrar a policy ao próprio user_id.
drop policy if exists thread_followers_select on public.team_chat_thread_followers;
create policy thread_followers_select
  on public.team_chat_thread_followers for select
  to authenticated using (auth.uid() is not null);

drop policy if exists thread_followers_insert on public.team_chat_thread_followers;
create policy thread_followers_insert
  on public.team_chat_thread_followers for insert
  to authenticated with check (auth.uid() is not null);

drop policy if exists thread_followers_update on public.team_chat_thread_followers;
create policy thread_followers_update
  on public.team_chat_thread_followers for update
  to authenticated using (auth.uid() is not null);

-- A cobrança de menção precisa de replica identity full como as outras tabelas
-- do chat: sem isso o evento de UPDATE (o "✓ visto") não carrega o registro
-- antigo e o Realtime pode descartá-lo na checagem de RLS.
alter table public.mention_nudges replica identity full;

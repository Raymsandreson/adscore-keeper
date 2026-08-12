-- Cobrança de menção: "responde com urgência".
--
-- Quem marcou alguém no chat de uma ficha (atividade, lead, processo, POP,
-- WhatsApp) e ficou sem resposta pode cobrar. A cobrança vira popup na tela de
-- quem foi marcado e fica registrada — com o "visto" — pra quem cobrou, mesmo
-- padrão da cobrança de atividade atrasada (activity_notifications + Feedbacks).
--
-- Por que tabela nova e não uma coluna em activity_notifications:
--   * activity_notifications.activity_id tem FK pra lead_activities — menção em
--     lead/processo/WhatsApp não caberia lá.
--   * activity_notifications.recipient_id é UUID do EXTERNO; menção, push e chat
--     usam o UUID do CLOUD. Tabela própria mantém um espaço de id só.
--   * Aditiva: não encosta em nada que já roda em produção.
--
-- Rollback (<1min, sem perda de dado de outra feature):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.mention_nudges;
--   DROP TABLE IF EXISTS public.mention_nudges;

create table if not exists public.mention_nudges (
  id             uuid primary key default gen_random_uuid(),
  -- A menção cobrada: id em team_chat_messages (chat da ficha).
  message_id     uuid not null,
  -- Quem tem que responder. UUID do CLOUD — mesmo espaço de
  -- team_chat_mentions.mentioned_user_id e push_subscriptions.user_id.
  recipient_id   uuid not null,
  recipient_name text,
  -- Quem cobrou (CLOUD).
  actor_id       uuid,
  actor_name     text,
  level          text not null default 'urgente' check (level in ('importante', 'urgente')),
  -- Ficha por trás do chat — o popup precisa disso pro deep-link.
  entity_type    text,
  entity_id      text,
  entity_name    text,
  -- Preenchido quando o popup aparece pro destinatário = o "✓ visto".
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- Popup: pendentes do destinatário (catch-up de quem estava offline).
create index if not exists idx_mention_nudges_recipient
  on public.mention_nudges (recipient_id, created_at desc);
-- Painel de Menções: última cobrança de cada menção listada.
create index if not exists idx_mention_nudges_message
  on public.mention_nudges (message_id, created_at desc);

alter table public.mention_nudges enable row level security;

-- Mesmo padrão das demais tabelas internas do Externo: equipe autenticada.
-- SELECT não dá pra restringir ao destinatário: quem cobrou precisa ler o
-- "visto" da cobrança que ele mesmo mandou.
drop policy if exists mention_nudges_select on public.mention_nudges;
create policy mention_nudges_select
  on public.mention_nudges for select
  to authenticated using (auth.uid() is not null);

drop policy if exists mention_nudges_insert on public.mention_nudges;
create policy mention_nudges_insert
  on public.mention_nudges for insert
  to authenticated with check (auth.uid() is not null);

-- UPDATE existe só pra marcar read_at (o popup carimba o "visto").
drop policy if exists mention_nudges_update on public.mention_nudges;
create policy mention_nudges_update
  on public.mention_nudges for update
  to authenticated using (auth.uid() is not null);

-- Realtime: o popup do destinatário e o "visto" ao vivo de quem cobrou.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'mention_nudges'
  ) then
    alter publication supabase_realtime add table public.mention_nudges;
  end if;
end $$;

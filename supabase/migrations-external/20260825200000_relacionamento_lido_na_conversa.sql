-- Relacionamento identificado pela conversa: memória do que já foi perguntado.
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA: medido em 25/08/2026, 32.849 dos 36.000 contatos estão sem
-- "Relacionamento Conosco" (só 8,8% preenchido). O nome resolve 894 deles e a
-- ficha (observação/profissão/negócio) dá contexto para 13.096 — mas 19.753 têm
-- só nome e telefone. Desses, 8.215 TÊM conversa no WhatsApp com 3+ mensagens:
-- é lá que está escrito quem é a pessoa para o escritório. Somando, a conversa
-- leva a cobertura possível de ~40% para ~65% da base.
--
-- Com a conversa entrando na jogada, a tela do chat passa a perguntar ("quem é
-- essa pessoa pra gente?") e a contestar ("está como Prospect, mas a conversa
-- indica Cliente"). Sem memória isso vira praga: a mesma pergunta, recusada
-- ontem, aparece de novo amanhã para o mesmo assessor — e para cada colega.
-- Esta tabela é essa memória.
--
-- Por que tabela nova e não coluna em `contacts`:
--   * `contacts` é a ficha do contato; "o Raym recusou esta sugestão" é evento
--     de uso, não atributo da pessoa. Não entra em export, merge de duplicados
--     nem em relatório.
--   * a tabela morre inteira num `drop` se a feature for descartada, sem tocar
--     nas 36.000 fichas.
--
-- Rollback (<1min, sem perda de dado de outra feature):
--   DROP TABLE IF EXISTS public.contact_relationship_reviews;

create table if not exists public.contact_relationship_reviews (
  -- Uma linha por contato: a decisão mais recente manda. Cascata porque sem o
  -- contato a memória não significa nada.
  contact_id       uuid primary key references public.contacts(id) on delete cascade,

  -- A sugestão RECUSADA, não a aceita — a aceita vira `contacts.classifications`
  -- e não precisa de registro aqui. Guardar o conteúdo (e não só um "não")
  -- deixa a tela calar a boca sobre ESSA proposta e ainda assim voltar a falar
  -- se a conversa mudar e a IA passar a apontar outra coisa.
  -- Array vazio = "não me pergunte nada agora", recusa sem sugestão na mesa.
  dismissed_slugs  text[] not null default '{}',

  -- Quem decidiu (UUID do CLOUD, mesmo espaço de contacts.created_by).
  decided_by       uuid,
  decided_at       timestamptz not null default now(),

  -- Data da última mensagem que a IA já leu deste contato. Trava de custo: sem
  -- mensagem nova, abrir a conversa de novo não gasta chamada nenhuma.
  checked_through  timestamptz,

  created_at       timestamptz not null default now()
);

-- Sem índice além da PK de propósito: todo acesso é por contact_id (a tela abre
-- uma conversa por vez). Varredura em massa, se existir um dia, lê a tabela
-- inteira e não se beneficiaria de índice.

alter table public.contact_relationship_reviews enable row level security;

-- Mesmo padrão das demais tabelas internas do Externo: equipe autenticada.
-- A decisão é do escritório, não de quem clicou: o colega que abrir a mesma
-- conversa amanhã precisa enxergar que a pergunta já foi respondida.
drop policy if exists contact_relationship_reviews_select on public.contact_relationship_reviews;
create policy contact_relationship_reviews_select
  on public.contact_relationship_reviews for select
  to authenticated using (auth.uid() is not null);

drop policy if exists contact_relationship_reviews_insert on public.contact_relationship_reviews;
create policy contact_relationship_reviews_insert
  on public.contact_relationship_reviews for insert
  to authenticated with check (auth.uid() is not null);

drop policy if exists contact_relationship_reviews_update on public.contact_relationship_reviews;
create policy contact_relationship_reviews_update
  on public.contact_relationship_reviews for update
  to authenticated using (auth.uid() is not null);

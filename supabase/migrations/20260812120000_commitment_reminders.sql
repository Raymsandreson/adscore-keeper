-- Histórico de cobranças da pendência do cliente.
--
-- Antes existia só `reminder_count` + `last_reminded_at` na própria pendência:
-- dava para saber QUE foi cobrado e QUANTAS vezes, nunca QUANDO cada cobrança
-- saiu, QUEM mandou, o que foi dito, nem qual bolha da conversa é a cobrança.
-- Cada linha aqui é uma cobrança REALMENTE enviada (o registro nasce depois do
-- envio confirmado, não no clique do botão).
--
-- Projeto: Externo (kmedldlepwiityjsdahz).

create table if not exists public.lead_client_commitment_reminders (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null
    references public.lead_client_commitments(id) on delete cascade,
  reminded_at timestamptz not null default now(),
  -- Quem cobrou (uuid do Externo) — a instância é compartilhada, então o nome
  -- fica gravado junto para o histórico não depender de join/remap depois.
  reminded_by uuid,
  reminded_by_name text,
  channel text not null default 'whatsapp',
  -- Texto efetivamente enviado (já com o prefixo "*Nome:*" quando houver).
  message_text text,
  -- A bolha da cobrança: uuid em whatsapp_messages + id do WhatsApp.
  message_id uuid,
  external_message_id text,
  -- A mensagem do cliente que foi citada (a promessa), quando a cobrança saiu
  -- como resposta a ela.
  replied_to_message_id uuid,
  replied_to_external_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_commitment_reminders_commitment
  on public.lead_client_commitment_reminders (commitment_id, reminded_at desc);

-- Selo "Cobrança de …" na bolha: a conversa procura pelo id da mensagem.
create index if not exists idx_commitment_reminders_message
  on public.lead_client_commitment_reminders (message_id)
  where message_id is not null;

alter table public.lead_client_commitment_reminders enable row level security;

-- Mesmo padrão de `lead_client_commitments`: a sessão do Externo é anônima
-- (signInAnonymously), então a policy libera `authenticated`, não `auth.uid()`.
drop policy if exists lccr_authenticated_all on public.lead_client_commitment_reminders;
create policy lccr_authenticated_all
  on public.lead_client_commitment_reminders
  for all
  to authenticated
  using (true)
  with check (true);

-- Celcoin Open Finance — convivência com a Pluggy + ciclo de vida do consentimento.
-- Projeto alvo: Supabase Externo (kmedldlepwiityjsdahz), onde já vivem as 3 tabelas financeiras.
--
-- Contexto: a integração financeira migra de Pluggy para Celcoin Financial Data. Os dados
-- históricos da Pluggy (5.524 transações de cartão, 2.583 bancárias em 10/08/2026) continuam
-- valendo, então as duas fontes precisam conviver na mesma tabela. É isso que a coluna
-- provider resolve. As colunas pluggy_* mantêm o nome por ora — renomear para external_*
-- quebraria ~20 arquivos de front e a edge pluggy-integration, e isso é commit separado.
--
-- ROLLBACK (testado como reversível — nenhum dado existente é alterado ou apagado):
--   drop table if exists public.celcoin_consents;
--   alter table public.bank_transactions drop constraint if exists bank_transactions_provider_tx_key;
--   alter table public.credit_card_transactions drop constraint if exists credit_card_transactions_provider_tx_key;
--   alter table public.bank_transactions add constraint bank_transactions_pluggy_transaction_id_key unique (pluggy_transaction_id);
--   alter table public.credit_card_transactions add constraint credit_card_transactions_pluggy_transaction_id_key unique (pluggy_transaction_id);
--   alter table public.bank_transactions drop column if exists provider;
--   alter table public.credit_card_transactions drop column if exists provider;

-- 1) Origem do dado. Default 'pluggy' já carimba corretamente todas as linhas existentes.
alter table public.bank_transactions
  add column if not exists provider text not null default 'pluggy';

alter table public.credit_card_transactions
  add column if not exists provider text not null default 'pluggy';

alter table public.bank_transactions
  drop constraint if exists bank_transactions_provider_check;
alter table public.bank_transactions
  add constraint bank_transactions_provider_check check (provider in ('pluggy', 'celcoin'));

alter table public.credit_card_transactions
  drop constraint if exists credit_card_transactions_provider_check;
alter table public.credit_card_transactions
  add constraint credit_card_transactions_provider_check check (provider in ('pluggy', 'celcoin'));

-- 2) A unicidade passa a ser por (origem, id da transação na origem).
-- Sem isso, um transactionId da Celcoin que colidisse com um id da Pluggy estouraria 23505,
-- e o upsert do handler (onConflict: 'provider,pluggy_transaction_id') não teria índice de apoio.
-- Tabelas pequenas (<6k linhas): o lock do ADD CONSTRAINT é de milissegundos.
alter table public.bank_transactions
  drop constraint if exists bank_transactions_pluggy_transaction_id_key;
alter table public.bank_transactions
  add constraint bank_transactions_provider_tx_key unique (provider, pluggy_transaction_id);

alter table public.credit_card_transactions
  drop constraint if exists credit_card_transactions_pluggy_transaction_id_key;
alter table public.credit_card_transactions
  add constraint credit_card_transactions_provider_tx_key unique (provider, pluggy_transaction_id);

-- Filtro por origem nas telas de conciliação.
create index if not exists idx_bank_transactions_provider_date
  on public.bank_transactions (provider, transaction_date desc);
create index if not exists idx_credit_card_transactions_provider_date
  on public.credit_card_transactions (provider, transaction_date desc);

-- 3) Consentimento Open Finance. Não tem equivalente na Pluggy: ele EXPIRA (no máximo 1 ano)
-- e pode ser revogado pelo titular. Sem acompanhar expires_at/status, a conciliação para
-- sozinha — exatamente como o sync da Pluggy parou em 18/03/2026 sem ninguém notar.
create table if not exists public.celcoin_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  consent_id text not null unique,
  brand_id text not null,
  brand_name text,
  status text not null default 'AWAITING_AUTHORISATION',
  permissions jsonb not null default '[]'::jsonb,
  celcoin_env text not null default 'sandbox',
  custom_name text,
  authorized_at timestamptz,
  expires_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.celcoin_consents is
  'Consentimentos Open Finance via Celcoin. status: AWAITING_AUTHORISATION -> AUTHORISED -> REJECTED. expires_at exige renovação (máx. 1 ano).';

create index if not exists idx_celcoin_consents_user on public.celcoin_consents (user_id);
create index if not exists idx_celcoin_consents_status on public.celcoin_consents (status, expires_at);

-- 4) RLS no mesmo padrão de pluggy_connections — tabela com dado financeiro nunca fica aberta.
alter table public.celcoin_consents enable row level security;

drop policy if exists "Users can view consents they have access to" on public.celcoin_consents;
create policy "Users can view consents they have access to"
  on public.celcoin_consents for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.user_card_permissions where user_card_permissions.user_id = auth.uid())
  );

drop policy if exists "Users can insert their own consents" on public.celcoin_consents;
create policy "Users can insert their own consents"
  on public.celcoin_consents for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own consents" on public.celcoin_consents;
create policy "Users can update their own consents"
  on public.celcoin_consents for update
  using (user_id = auth.uid());

drop policy if exists "Users can delete their own consents" on public.celcoin_consents;
create policy "Users can delete their own consents"
  on public.celcoin_consents for delete
  using (user_id = auth.uid());

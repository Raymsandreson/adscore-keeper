-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 25/08/2026 via MCP. Mantida aqui como registro do schema.
-- ============================================================================
-- O lancamento passa a dizer SE aquele dinheiro apareceu no extrato do banco.
--
-- Ate aqui `lead_financials` e o extrato do Open Finance viviam de costas um
-- para o outro, embora morem no MESMO banco: alguem digitava "Flores para
-- visita lead290 — R$ 48,00" e, do outro lado, a Celcoin trazia um debito de
-- R$ 48,00 no mesmo dia. Nada ligava os dois. Na pratica isso significa que a
-- ficha do lead nunca conseguiu responder a pergunta que o financeiro faz:
-- "esse valor saiu mesmo da conta, ou e so o que a pessoa disse que gastou?".
--
--   of_transacao_id    id em `bank_transactions` (tipo 'bank') ou em
--                      `credit_card_transactions` (tipo 'card'). NAO tem FK
--                      porque uma coluna nao referencia duas tabelas — o par
--                      (id, tipo) e a chave, e a checagem de existencia fica
--                      com quem grava.
--   of_transacao_tipo  'bank' | 'card'. Sem ele o id sozinho e ambiguo.
--
--   of_descricao       RETRATO da linha do banco no momento da conciliacao:
--   of_data            descricao, data e valor. Existe pelo mesmo motivo que
--   of_valor           `parte_nome` existe — a conciliacao precisa continuar
--                      legivel depois. Duas razoes concretas: (1) a
--                      re-sincronizacao da Celcoin pode reemitir a transacao
--                      com id novo e deixar o ponteiro pendurado; (2) ler
--                      `bank_transactions` do front NAO funciona — a policy e
--                      `user_id = auth.uid()` e a sessao que o app mantem no
--                      Externo e anonima, entao a leitura volta VAZIA, sem
--                      erro. Sem o retrato, cada abertura da ficha dependeria
--                      de uma ida a edge so para escrever "conciliado".
--
--   of_conciliado_em   quando e por quem. Conciliacao e ato de conferencia:
--   of_conciliado_por  sem autoria ela nao vale como controle.
--
-- O que esta migracao NAO faz: conciliar sozinha. Casar por valor+data e
-- palpite, e palpite que vira numero fechado sem ninguem olhar e caro de
-- desfazer — mesma decisao tomada em `conferido` (21/08/2026). A busca ordena
-- os candidatos; quem aponta e uma pessoa.
--
-- REVERSAO (aditiva, nenhum dado pre-existente e tocado):
--   drop index if exists public.idx_lead_financials_of_transacao;
--   alter table public.lead_financials
--     drop constraint if exists lead_financials_of_par_completo,
--     drop constraint if exists lead_financials_of_tipo_valido,
--     drop column if exists of_transacao_id,
--     drop column if exists of_transacao_tipo,
--     drop column if exists of_descricao,
--     drop column if exists of_data,
--     drop column if exists of_valor,
--     drop column if exists of_conciliado_em,
--     drop column if exists of_conciliado_por;

alter table public.lead_financials
  add column if not exists of_transacao_id   uuid,
  add column if not exists of_transacao_tipo text,
  add column if not exists of_descricao      text,
  add column if not exists of_data           date,
  add column if not exists of_valor          numeric(14,2),
  add column if not exists of_conciliado_em  timestamptz,
  add column if not exists of_conciliado_por uuid;

-- Id sem tipo nao aponta para lugar nenhum, e tipo sem id nao diz nada.
alter table public.lead_financials
  drop constraint if exists lead_financials_of_par_completo;
alter table public.lead_financials
  add constraint lead_financials_of_par_completo
  check ((of_transacao_id is null) = (of_transacao_tipo is null));

alter table public.lead_financials
  drop constraint if exists lead_financials_of_tipo_valido;
alter table public.lead_financials
  add constraint lead_financials_of_tipo_valido
  check (of_transacao_tipo is null or of_transacao_tipo in ('bank', 'card'));

comment on column public.lead_financials.of_transacao_id is
  'Transacao do Open Finance que baixou este lancamento. bank_transactions ou credit_card_transactions, conforme of_transacao_tipo. NULL = nao conciliado.';
comment on column public.lead_financials.of_transacao_tipo is
  'bank = conta corrente (bank_transactions); card = cartao (credit_card_transactions).';
comment on column public.lead_financials.of_descricao is
  'Retrato da descricao da linha do banco no momento da conciliacao. Sobrevive a re-sincronizacao e dispensa ler bank_transactions do front (policy user_id = auth.uid(), sessao anonima).';
comment on column public.lead_financials.of_data is
  'Retrato da data da transacao no extrato. Pode diferir de entry_date/settled_at — e justamente essa diferenca que a conciliacao mostra.';
comment on column public.lead_financials.of_valor is
  'Retrato do valor da transacao, em modulo. Diferente de amount = conciliado com divergencia, e isso aparece na tela.';
comment on column public.lead_financials.of_conciliado_em is
  'Quando alguem apontou esta transacao. NULL = nunca conciliado.';
comment on column public.lead_financials.of_conciliado_por is
  'auth.users do EXTERNO de quem conciliou. Sem FK: a sessao do front no Externo e anonima e a autoria util e a do Cloud, resolvida por auth_uuid_mapping na edge.';

-- A pergunta cara da tela de conciliacao: "esta transacao ja foi usada em
-- algum lancamento?". Sem isto, apontar o mesmo PIX em duas despesas passa
-- despercebido e o dinheiro sai duas vezes do relatorio.
create index if not exists idx_lead_financials_of_transacao
  on public.lead_financials(of_transacao_id)
  where of_transacao_id is not null;

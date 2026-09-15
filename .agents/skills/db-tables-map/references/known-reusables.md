# Tabelas frequentemente reinventadas

Lista viva. Sempre que pegar o agente quase duplicando algo, adicione aqui.

## WhatsApp

### `whatsapp_groups_index` (Externo)
Índice de todos os grupos das instâncias conectadas. Sync diário mantém `contact_name` (= subject/nome do grupo) atualizado.
- Use para: descobrir nome de grupo a partir do JID.
- NÃO faça: chamar UazAPI `/group/info` toda vez, criar cache próprio, salvar nome em coluna nova.
- Coluna útil: `contact_name`, `last_seen`.

### `lead_whatsapp_groups` (Externo)
Vínculo lead ↔ grupo WhatsApp.
- Colunas: `lead_id`, `group_jid`, `instance_name`, `group_name` (snapshot, atualize quando ver mudança).

### `whatsapp_messages` (Externo, alto volume)
Histórico completo de mensagens. Não crie "conversation_log", "chat_history" etc.

### `whatsapp_conversation_agents` (Externo)
Qual agente está ativo numa conversa (phone+instance). `human_paused_until` para pausa manual.

### `whatsapp_instance_users` (Cloud)
Quais usuários podem ver qual instância. Permissão de leitura SEMPRE do Cloud.

## CRM / Leads

### `lead_custom_fields` + `lead_custom_field_values`
Campos customizados por escopo (board/funnel). Use antes de `ALTER TABLE leads`.

### `contact_leads`
Relação N↔N contato↔lead. Não crie nova tabela de vínculo.
- Colunas reais (conferidas em 11/09/2026): `contact_id`, `lead_id`, `is_primary_client` (o cliente do lead), `relationship_to_victim`, `relationship_to_primary`, `notes`. **Não existe `relationship_type`** — esta linha dizia que existia e induzia ao erro.
- É a ponte de verdade: 10.264 vínculos cobrindo 8.545 leads. `contacts.lead_id` enxerga só 1.270 leads — usar a coluna em vez da ponte deixa 92% dos vínculos invisíveis. Já mordeu uma vez (limite de gasto por cliente, 11/09/2026).

### `form_layout_tabs` + `form_layout_fields`
Layout configurável de formulários. Use antes de hardcodar ordem/visibilidade em componente.

### `lead_stage_history` / `lead_status_history`
Já registram mudança de etapa/status. Não criar `lead_changelog`.

### `lead_followups`
Follow-ups (whatsapp, call, etc.). Triggers já populam ao registrar call/outbound.

### `lead_client_commitments` (Externo)
Pendência do **CLIENTE** — o que ELE ficou de fazer (avaliar no Google, gravar depoimento, mandar documento). Não confundir com `lead_activities` (tarefa do assessor, entra em cronômetro/telão) nem com `lead_followups` (log do escritório). Chaveada por `lead_id` OU `phone`+`instance_name` (conversa ainda sem lead). Guarda `source_message_id` da mensagem que originou, `status` (combinado/cobrado/feito/desistiu) e contador de cobranças.

## Permissões / Equipe

### `member_module_permissions` (Cloud)
Acesso por módulo. Leitura sempre do Cloud (RLS no Externo esconde).

### `access_profiles` + `user_roles.access_profile_id` (Cloud)
Perfis configuráveis. Não criar enum novo de papéis.

## Jurídico

### `legal_cases` / `case_process_tracking` / `process_movements` / `process_parties`
Cobrem ciclo completo de processo. `generate_case_number(nucleus_id)` já gera código.

## Financeiro

### `financial_entries` / `bank_transactions` / `credit_card_transactions`
Lançamentos. `cost_accounts` + `cost_centers` para classificação.

### Conta e forma de pagamento de uma despesa — NÃO crie tabela nova
`cost_accounts` é o ÚNICO vocabulário de conta da casa (5 linhas: PESSOAL,
ABRACI, WHATSJUD, PRUDÊNCIO CAPITAL, PRUDÊNCIO ADVOGADOS). Já é apontada por
`card_assignments.cost_account_id`, `transaction_category_overrides.cost_account_id`
e, desde 11/09/2026, `lead_financials.cost_account_id`.
Forma de pagamento é TEXT (`pix`, `boleto`, `cartao_credito`, `cartao_debito`,
`transferencia`, `dinheiro`) em `payment_method` — mesma lista em
`FORMAS_DE_PAGAMENTO` (`src/hooks/useContasDePagamento.ts`).
QUAL cartão se guarda pelos quatro dígitos (`card_last_digits`), porque é o que
casa com `credit_card_transactions` — id de `card_assignments` casaria com o
cadastro, não com o extrato.

### Despesa ↔ caso: `group_jid`, não só `lead_id`
`transaction_category_overrides.group_jid` diz de QUAL caso é a despesa quando o
lead tem mais de um grupo. `setTransactionOverride` faz **upsert da linha
inteira**: qualquer tela que salve um override e NÃO mande `group_jid` zera o
vínculo do caso sem erro nenhum. Escolha do grupo:
`src/components/finance/SeletorGrupoCaso.tsx` (busca no servidor — são 2.429
jids, não carregue a lista toda).

## Métricas / Metas

### `monitor_kpi_snapshots`
Snapshots de KPI já calculados. Não recalcular tudo no front.

### `member_metric_goals` / `workflow_daily_goals` / `engagement_goals`
Metas por dimensão. Veja qual cabe antes de criar nova.

---

## Como adicionar entrada

Formato:
```
### `tabela_nome` (Cloud|Externo)
Para que serve em 1 linha.
- Use para: ...
- NÃO faça: ...
- Colunas-chave: ...
```

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
Relação N↔N contato↔lead com `relationship_type`. Não crie nova tabela de vínculo.

### `form_layout_tabs` + `form_layout_fields`
Layout configurável de formulários. Use antes de hardcodar ordem/visibilidade em componente.

### `lead_stage_history` / `lead_status_history`
Já registram mudança de etapa/status. Não criar `lead_changelog`.

### `lead_followups`
Follow-ups (whatsapp, call, etc.). Triggers já populam ao registrar call/outbound.

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

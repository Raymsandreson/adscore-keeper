
# Agentes ↔ Etiquetas WhatsApp — Sincronia Bidirecional

## Metáfora
Cada agente vira uma "credencial visual" no WhatsApp. Quando você cria um agente "Carlos", o sistema cola um adesivo verde "Carlos" em todas as carteiras (instâncias). Quando alguém cola esse adesivo numa conversa pelo WhatsApp, o Carlos entra naquela conversa. Quando tira o adesivo, ele sai. Quando o agente é desligado no sistema, o adesivo fica cinza em todas as carteiras.

## O que vai mudar

### 1. Sync agente → etiqueta (sistema → WhatsApp)
- **Criar agente**: cria etiqueta com mesmo nome em TODAS as instâncias UazAPI conectadas, cor **verde** (id 3) se `is_active=true`, **cinza** (id 7) se não.
- **Renomear agente**: renomeia etiqueta em todas instâncias (mantém o `labelid`).
- **Ativar/desativar agente** (`is_active`): re-aplica a cor (verde ↔ cinza) em todas instâncias. Não apaga a etiqueta.
- **Apagar agente**: apaga etiqueta em todas instâncias (com soft-delete na tabela de mapeamento).
- **Adicionar nova instância**: ao detectar instância nova, cria todas etiquetas de agentes existentes nela.

Tabela nova no Externo: `agent_instance_labels` (agent_id, instance_name, label_id, label_name, color, deleted_at) — guarda o mapeamento para conseguir editar/deletar depois.

### 2. Sync etiqueta na conversa → agente (WhatsApp → sistema)
Estender o handler de `chat_labels` já existente em `whatsapp-webhook.ts`:
- Para cada evento, comparar `wa_labels` atuais com snapshot anterior (cache em `whatsapp_conversation_label_state`).
- **Label adicionada** que mapeia a agente: ativa o agente naquela conversa (`whatsapp_conversation_agents.is_active=true`, `agent_id=X`, `activated_by='label_wa'`).
- **Label removida** que mapeia a agente: desativa (`is_active=false`).
- Mantém compat com triggers de documento existentes.

### 3. Sync agente na conversa → etiqueta no WA (UI → WhatsApp)
Em `WhatsAppAgentToggle` (ativar/desativar agente numa conversa):
- Ao ativar: chamar UazAPI para colar a etiqueta do agente naquele chat.
- Ao desativar/remover: chamar UazAPI para descolar a etiqueta.
- Guarda contra loop: marcar a operação como "origem=sistema" via flag pra ignorar o webhook subsequente do mesmo chat/label nos próximos 5s.

### 4. UI
- Aba "Agentes" passa a mostrar bolinha verde/cinza por instância, indicando se a etiqueta está sincronizada e ativa.
- Botão "Re-sincronizar etiquetas" como fallback manual.
- Aba "Etiquetas-Gatilho" continua existindo, mas mostra também as etiquetas-agente (read-only com badge "auto").

## Detalhes técnicos

### Tabelas novas (Externo via `run-external-migration`)
```sql
CREATE TABLE agent_instance_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  instance_name text NOT NULL,
  label_id text NOT NULL,
  label_name text NOT NULL,
  color int NOT NULL DEFAULT 3,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(agent_id, instance_name)
);
CREATE INDEX idx_ail_instance_label ON agent_instance_labels(instance_name, label_id) WHERE deleted_at IS NULL;

CREATE TABLE whatsapp_conversation_label_state (
  phone text NOT NULL,
  instance_name text NOT NULL,
  label_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY(phone, instance_name)
);
```

### Funções novas (Railway)
1. **`sync-agent-labels`** — POST `{ agent_id, operation: 'create'|'rename'|'recolor'|'delete' }`. Itera todas `whatsapp_instances` ativas, chama `/label/edit` em cada, persiste em `agent_instance_labels`. Idempotente.
2. **`apply-label-to-chat`** — POST `{ phone, instance_name, label_id, action: 'add'|'remove' }`. Chama UazAPI `/chat/labels` (endpoint a confirmar via sondagem) e grava lock antiloop.

### Funções alteradas
- **`whatsapp-webhook.ts`** — handler `chat_labels` ganha diff de labels (vs `whatsapp_conversation_label_state`) e cruzamento com `agent_instance_labels` pra ativar/desativar agente.
- **`WhatsAppAgentToggle.tsx`** — chama `apply-label-to-chat` ao ativar/desativar.
- **Form do agente** (criar/editar/deletar) — chama `sync-agent-labels` no afterSave.

### Cores UazAPI
A paleta Meta usa int: 0=cinza claro, 3=verde, 7=cinza escuro. Confirmo com sondagem rápida na 1ª chamada — se a UazAPI ignorar `color` em update, alerto e desisto da parte "também no WhatsApp" da pergunta 2 (mantenho só verde/cinza na UI do sistema).

## O que NÃO vai mexer
- Lógica de `label_document_triggers` (ZapSign automático por etiqueta) — fica intacta. Etiqueta-agente é um TIPO separado, conviva.
- `auto_swap_agent_on_stage_change` (troca por etapa do Kanban) — independente.
- `wjia_command_shortcuts` (tabela do agente) — só leituras, sem alterar schema.

## Ordem de execução
1. Migration tabelas novas
2. Função `sync-agent-labels` (Railway) + sondagem da paleta de cores UazAPI numa instância de teste
3. Hooks no form do agente (chamar após criar/editar/deletar/toggle)
4. Função `apply-label-to-chat` (Railway) + sondagem do endpoint `/chat/labels`
5. `WhatsAppAgentToggle` chama `apply-label-to-chat`
6. Estender handler `chat_labels` no webhook (diff + cruzamento com agent_instance_labels)
7. Lock anti-loop (5s) no Redis-equivalente ou tabela `agent_label_apply_locks`
8. UI: bolinhas verde/cinza por instância no painel de agentes + botão "Re-sincronizar"

## Riscos
- **Endpoint UazAPI `/chat/labels`** não confirmado em código existente — preciso sondar antes da etapa 4. Se não existir como esperamos, etapa 5 muda.
- **Loop infinito** (sistema aplica label → webhook chega → sistema reage → reaplica). Resolvido pelo lock de 5s + `activated_by='label_wa'` vs `'system'` na origem.
- **Custo**: criar agente passa a fazer N chamadas UazAPI (1 por instância). Com 5-10 instâncias, ~2-5s. Aceitável.

## Rollback
- Cada função nova é isolada. Pra reverter: desplugar chamada no form do agente + desabilitar handler estendido no webhook via feature flag `LABEL_AGENT_SYNC_ENABLED`. Tabelas novas ficam (sem efeito colateral).

Posso começar pela etapa 1+2 (migration + sondagem da UazAPI) pra confirmar que a paleta de cores funciona como descrito, e a partir daí seguir o resto?

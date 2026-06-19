## Objetivo

Para as instâncias WhatsApp de **Israel Atendimento** e **Mateus Atendimento** (e qualquer outra que você marcar):
1. **Apagar as etiquetas de agente** (`🤖 ...`) da UazAPI — somem do WhatsApp Web e mobile.
2. **Garantir que as etapas do funil BPC-Loas** estejam presentes como etiquetas naquelas instâncias.

E corrigir o **scrollbar duplicado** no kanban (a barra de cima cortada).

## Como vou fazer

### 1. Limpeza das etiquetas de agente (Israel/Mateus)

Já existe a função `sync-agent-labels` no Railway com `operation: 'delete'`. Ela apaga a etiqueta `🤖 <nome>` na UazAPI e marca `deleted_at` em `agent_instance_labels`.

Vou criar um botão **"Remover etiquetas de agente desta instância"** dentro de `WhatsAppInstanceSettings` (ou aba equivalente) que:
- Lista todos os agentes que têm `agent_instance_settings` apontando para a instância.
- Pra cada um, chama `sync-agent-labels` com `operation: 'delete'` restrito àquela instância (vou adicionar param opcional `only_instance_name` na função pra não afetar as outras).
- Em paralelo, desativa `is_enabled = false` em `agent_instance_settings` daquela instância pra evitar recriação automática.

### 2. Sincronizar etiquetas das etapas BPC-Loas

`sync-stage-labels` já existe e roda em **todas** as instâncias. Vou:
- Localizar o `board_id` de "BPC - Loas" (busca por `name ilike '%bpc%loas%'`).
- Disparar `sync-stage-labels` uma vez — isso já cria as etiquetas `📋 <stage>` em todas as instâncias ativas, incluindo Israel e Mateus.

### 3. Scrollbar duplicado no kanban

O kanban tem 2 scrollbars horizontais porque o wrapper externo tem `overflow-x: auto` e o interno também, com larguras desiguais. Vou ler `DynamicKanbanBoard.tsx` e remover o overflow do container externo (ou unificar a largura) pra ficar só a barra de baixo, indo até o fim.

## Arquivos

- `railway-server/src/functions/sync-agent-labels.ts` — aceitar `only_instance_name`
- `src/components/whatsapp/WhatsAppInstanceSettings.tsx` (ou similar) — botão de limpeza
- `src/components/kanban/DynamicKanbanBoard.tsx` — fix do overflow duplicado
- (opcional) Hook one-shot pra rodar `sync-stage-labels` do board BPC-Loas

## Fora do escopo

- Não vou apagar agentes nem desconectar instâncias.
- Não vou mexer em outras instâncias além das que você marcar.
- Não vou tocar nas etiquetas de resultado (`✅ Fechado` etc).

Aprova?
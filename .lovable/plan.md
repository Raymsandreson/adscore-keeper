## Objetivo

Acoplar 1:1 as **etapas do Kanban** às **etiquetas WhatsApp (UazAPI)** nos funis **BPC - Autismo** e **Acidente de Trabalho**, com 3 efeitos:

1. **Contagem por etapa** no card "Funil de Conversão" passa a refletir quantos leads/conversas têm a etiqueta correspondente em cada instância vinculada ao board.
2. **Mover lead no Kanban → aplica a etiqueta** nas instâncias (já existe `apply-stage-label`, falta amarrar nesses dois funis).
3. **Etiqueta mudada no WhatsApp → move o lead de etapa** no Kanban (via extensão do webhook).

Tudo restrito aos dois funis no piloto. Mapeamento etapa↔etiqueta é gerado automaticamente (1 etiqueta por etapa, prefixo do board), reaproveitando o que `sync-stage-labels` já faz.

## O que já existe (não recriar)

- `railway-server/src/functions/sync-stage-labels.ts` — cria/atualiza/remove labels no UazAPI por etapa.
- `railway-server/src/functions/apply-stage-label.ts` — aplica label no chat quando lead muda de etapa.
- `railway-server/src/functions/list-stage-label-mappings.ts` — devolve mapeamentos.
- `src/hooks/useStageLabelMappings.ts` — hook para consumir mapeamentos.
- Tabela `stage_instance_labels` (Externo) — mapa board↔stage↔instance↔label_id.

## O que vou construir

### 1. Bootstrap dos dois funis (uma vez)
- Botão **"Sincronizar etiquetas com Kanban"** dentro da config do board (já existe `StageLabelSetupPanel` no plano, ainda não foi feito). Para evitar nova UI agora, faço:
  - Script idempotente disparado automaticamente ao abrir o "Funil de Conversão" desses dois boards: chama `sync-stage-labels` se ainda não houver mapeamentos.
  - Apenas para os boards cujos nomes contenham `BPC - Autismo` ou `Acidente de Trabalho` (allowlist via slug do board, configurável).

### 2. Contagem por etapa = leads com a etiqueta
- Nova função Railway: `count-leads-by-stage-label`
  - Input: `boardId`
  - Para cada `(stage, instance, label_id)` em `stage_instance_labels`, conta chats com aquela label (UazAPI `/chat/find` filtrando `labels`) **OU** conta linhas em `whatsapp_messages`/`leads` onde a etiqueta está aplicada (cache local em `lead_whatsapp_groups` / nova coluna `leads.current_stage_label_id`).
  - Para piloto, MVP: consulta `leads.status = stage.id` (já é a fonte de verdade do Kanban) AGRUPANDO por board. Como o objetivo é "etapa = etiqueta", e a etapa do Kanban é o destino oficial, mostrar `count(leads WHERE board_id=X AND status=stage_id)`.
- Substituir o `funnelData` do `BpcFunnelBars` (e similar do AT) por essa contagem real, em vez de jogar tudo na primeira etapa.

### 3. Webhook reverso (etiqueta no WA → muda etapa)
- Estender `railway-server/src/functions/whatsapp-webhook.ts` (ou handler equivalente onde já tratamos eventos UazAPI):
  - Ao receber evento `chat.label.added` / `chat.label.removed`:
    1. Buscar `stage_instance_labels` por `(instance_name, label_id)` para descobrir `board_id` + `stage_id`.
    2. Localizar lead pelo `phone` + `instance_name` (regra de identidade dupla).
    3. Validar que o lead está nesse board (`leads.board_id = board_id`); se não, ignorar.
    4. UPDATE `leads.status = stage_id`, registrar `lead_stage_history`.
    5. Guard anti-loop: só aplica se a mudança não vier do próprio `apply-stage-label` (flag `source='wa-webhook'` vs `source='kanban'` + janela curta de dedupe).
  - Sem nova tabela. Reaproveita `lead_stage_history`.

### 4. Mover no Kanban → aplica etiqueta (amarração nos 2 funis)
- Já existe `apply-stage-label` registrado. Confirmar que `UnifiedKanbanManager` está chamando após `updateLeadStatus` para esses boards (se sim, só validar; se não, adicionar invocação).

## Arquivos tocados

- `railway-server/src/functions/count-leads-by-stage-label.ts` (novo)
- `railway-server/src/index.ts` (registrar rota)
- `src/lib/functionRouter.ts` (`'count-leads-by-stage-label': 'railway'`)
- `railway-server/src/functions/whatsapp-webhook.ts` (estender label events)
- `src/components/kanban/BpcFunnelBars.tsx` (consumir contagem real)
- Equivalente do "Acidente de Trabalho" se for componente separado (a confirmar na execução)
- `src/hooks/useStageLabelCounts.ts` (novo)
- Auto-bootstrap: hook `useEnsureStageLabels(boardId)` chamado nas páginas dos 2 funis

## Banco

Nenhuma migration nova. `stage_instance_labels` e `lead_stage_history` já existem no Externo. Se confirmar que falta coluna `source` em `lead_stage_history` pra guardar origem (`kanban`/`wa-webhook`), adicionar via `run-external-migration`.

## Riscos

- **Loop infinito**: Kanban move → aplica label → webhook recebe → tenta mover de novo. Mitigado por `source` + `updated_at` (skip se atualizado <3s).
- **UazAPI rate limit**: contagem em tempo real chamando `/chat/find` por etapa é cara. Por isso o MVP usa `leads.status` como fonte (idêntico à etiqueta, porque o objetivo é manter sincronizado).
- **Boards fora do piloto**: allowlist em código pra evitar surpresa em outros funis.

## Rollback

- Função Railway nova: remover rota + revert do router.
- Webhook label handler: protegido por feature flag (`ENABLE_LABEL_TO_STAGE`), default true só pros 2 boards.
- Contagem: BpcFunnelBars volta ao comportamento atual revertendo o componente.

## Fora do escopo

- UI completa de configuração visual etapa↔etiqueta (StageLabelSetupPanel) — fica pro próximo passo se for útil.
- Outros boards além dos dois pilotos.
- Reescrita do sync de labels já existente.

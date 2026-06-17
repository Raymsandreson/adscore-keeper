## Objetivo
Sincronizar 1:1 cada coluna do board **BPC - Autismo** com uma etiqueta no WhatsApp (via UazAPI), nos dois sentidos. Reaproveitar as 4 etiquetas globais já existentes (`✅ Fechado`, `❌ Recusado`, `⚠️ Inviável`, `🚫 Cancelado`) e criar as demais.

## Decisões consolidadas (das suas respostas)
- **Mapeamento**: 1 etiqueta por etapa do board. As etapas finais (Fechados, Recusados, Inviáveis, Cancelamentos) reutilizam as etiquetas globais já criadas por `sync-result-labels`. As demais 7 são criadas novas com prefixo `📋`.
- **Instâncias**: aplica em **todas** as instâncias onde o telefone do contato tem histórico (igual ao padrão de `sync-agent-labels`).
- **Webhook**: estender o bloco `isLabelEvent` em `whatsapp-webhook.ts` (não criar endpoint novo).
- **Botão**: aparece nos **dois** lugares — atalho no card do Kanban + Select completo dentro do `LeadEditDialog`.

## Arquitetura

```text
┌─────────────────┐  drag    ┌──────────────────────┐  HTTP   ┌──────────────┐
│ DynamicKanban   │ ───────► │ apply-stage-label    │ ──────► │  UazAPI      │
│ Card / Dropdown │  select  │ (Railway)            │  /chat  │  (N inst.)   │
└─────────────────┘          └──────────────────────┘ /label  └──────┬───────┘
                                                                     │ webhook
┌─────────────────┐  realtime ┌─────────────────────┐ chat_   │
│ Kanban UI       │ ◄──────── │ whatsapp-webhook    │ ◄──────┘ labels
│ (auto-move)     │  updates  │  (handler novo)     │
└─────────────────┘  via DB   └─────────────────────┘
```

## Schema novo (Externo, via `run-external-migration`)

```sql
-- Mapeamento stage -> label por instância (espelhado em todas inst onde precisar)
CREATE TABLE public.stage_instance_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL,
  stage_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  label_id TEXT NOT NULL,        -- id retornado pela UazAPI
  label_name TEXT NOT NULL,      -- nome aplicado (com prefixo)
  color INT NOT NULL DEFAULT 0,
  result_key TEXT,               -- se reaproveita result_instance_labels: 'closed'|'refused'|'inviavel'|'cancelled'
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (board_id, stage_id, instance_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_instance_labels TO authenticated;
GRANT ALL ON public.stage_instance_labels TO service_role;
ALTER TABLE public.stage_instance_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stage_instance_labels read" ON public.stage_instance_labels FOR SELECT TO authenticated USING (true);
CREATE POLICY "stage_instance_labels write" ON public.stage_instance_labels FOR ALL TO service_role USING (true);

CREATE INDEX idx_sil_board_stage ON public.stage_instance_labels(board_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sil_instance_label ON public.stage_instance_labels(instance_name, label_id) WHERE deleted_at IS NULL;
```

Em `kanban_boards.stages` (JSONB) opcionalmente acrescento `result_key` por stage (para o board BPC-Autismo) — define quais etapas reutilizam etiquetas de `result_instance_labels` em vez de criar nova.

## Backend (Railway — 4 functions novas)

Todas em `railway-server/src/functions/`, registradas em `index.ts` e `src/lib/functionRouter.ts`:

1. **`sync-stage-labels.ts`** — clone de `sync-result-labels.ts`. Input `{board_id, operation:'upsert'|'delete'}`. Para cada stage do board × cada instância ativa: cria/atualiza/deleta a etiqueta na UazAPI e grava em `stage_instance_labels`. Reaproveita `result_instance_labels.label_id` quando `stage.result_key` estiver setado.

2. **`apply-stage-label.ts`** — disparado pelo front a cada drag/seleção. Input `{lead_id, board_id, new_stage_id, old_stage_id?}`. Fluxo:
   - Descobre `phone` em `leads.lead_phone`.
   - Descobre instâncias do contato via `SELECT DISTINCT instance_name FROM whatsapp_messages WHERE phone = $1` (helper novo `getInstancesForPhone` em `railway-server/src/lib/uazapi-labels.ts`).
   - Para cada inst: resolve `label_id` da etapa antiga e nova em `stage_instance_labels`. Chama `POST /chat/labels` (UazAPI: `{number, labelid, action:'remove'|'add'}`).
   - Retorna `{success, results:[{instance_name, removed, added, error?}]}`. **Sempre HTTP 200**.

3. **`list-stage-label-mappings.ts`** — `GET /functions/list-stage-label-mappings?board_id=…` → retorna stages + label atual por instância (para o Select).

4. **Extensão de `whatsapp-webhook.ts`** (linha ~1070, dentro do `isLabelEvent`):
   - Recebe `phoneDigits`, `webhookInstanceName`, `waLabels` (já parseados).
   - `SELECT board_id, stage_id FROM stage_instance_labels WHERE instance_name=$1 AND label_id = ANY($2)`.
   - Se encontrou, faz `UPDATE leads SET status=$stage_id, updated_at=now() WHERE lead_phone LIKE %$phone% AND board_id=$board_id RETURNING id`.
   - Realtime já existente no front recebe o update e move o card.

## Frontend

### 1. `src/components/kanban/StageLabelSelect.tsx` (novo, ~120 linhas)
- Props: `leadId, boardId, currentStageId, variant:'card'|'dialog'`.
- `variant='card'` → ícone `Tag` num botão `Popover` ghost no canto do `LeadCard`.
- `variant='dialog'` → `Select` full-width na aba WhatsApp do `LeadEditDialog`.
- Lista as etapas (= etiquetas) via `useStageLabelMappings(boardId)`.
- Ao mudar: spinner local + chama `apply-stage-label` + em sucesso confia no realtime; em erro reverte estado local e dispara `toast.error`.

### 2. `src/hooks/useStageLabelMappings.ts` (novo)
- Cacheia `list-stage-label-mappings` por `board_id` (React Query 5min).

### 3. `src/components/kanban/UnifiedKanbanManager.tsx` (~linha 295)
- Após `updateLead({status})`, chama `apply-stage-label` fire-and-forget. Em erro reverte `status` e mostra toast. Marca o card com flag `syncing` (Set local) — `DynamicKanbanBoard` renderiza spinner sutil no canto enquanto presente.

### 4. `src/components/kanban/DynamicKanbanBoard.tsx`
- Adiciona `<StageLabelSelect variant="card" />` no header do `LeadCard` (canto direito, ao lado do menu).
- Recebe Set `syncingLeadIds` por prop e exibe `<Loader2 className="animate-spin opacity-60" />` quando aplicável.

### 5. `src/components/kanban/LeadEditDialog.tsx`
- Na seção WhatsApp (após o campo de telefone, ~linha 2150), adiciona `<StageLabelSelect variant="dialog" />`.

### 6. `src/components/kanban/StageLabelSetupPanel.tsx` (novo, ~150 linhas)
- Vai dentro das configurações do board (engrenagem do `DynamicKanbanBoard`). Mostra cada stage com:
  - status atual da etiqueta (✓ sincronizada / ⚠ pendente / ❌ erro);
  - dropdown `result_key` (None / Fechado / Recusado / Inviável / Cancelado) para reaproveitar etiquetas globais;
  - botão **"Sincronizar etiquetas com WhatsApp"** → chama `sync-stage-labels` com `operation:'upsert'`;
  - botão **🧪 "Simular webhook"** que faz POST direto no `whatsapp-webhook` com payload mock `{event:'chat_labels', phone, instance_name, labels:[label_id]}` (atende ao requisito de Mock de Testes).

## UX/Loading/Erro
- Drag → otimista, com `syncingLeadIds.add(id)` (spinner no canto do card).
- Sucesso → `syncingLeadIds.delete(id)`.
- Falha → reverte `status` no banco, remove do Set, `toast.error("Falha ao sincronizar etiqueta no WhatsApp. Card revertido.")`.
- Select no Dialog → mesmo padrão, mas com estado local `pendingValue` que reverte em erro.

## Ordem de implementação
1. SQL: criar `stage_instance_labels` via `run-external-migration`.
2. Railway: `sync-stage-labels` + `apply-stage-label` + `list-stage-label-mappings`. Registrar em `index.ts` e `functionRouter.ts`. Deploy.
3. Estender `whatsapp-webhook.ts` com handler reverso. Deploy.
4. Frontend: hook + `StageLabelSelect` + `StageLabelSetupPanel`.
5. Integração no `UnifiedKanbanManager` (drag) + `DynamicKanbanBoard` (card) + `LeadEditDialog` (gaveta).
6. Rodar `sync-stage-labels` pro board BPC-Autismo via o painel novo → confere as etiquetas no app UazAPI.
7. Teste manual: drag card / mudar via Select / simular webhook.

## O que NÃO vai mexer
- `sync-agent-labels` (etiquetas-de-agente) — fica intacto. Continua coexistindo (memória `agent-label-sync-system` preservada).
- `sync-result-labels` — só passa a ser **lido** por `sync-stage-labels` quando uma etapa do board declarar `result_key`.
- Tabelas de leads, board structure, RLS de outros módulos.
- Lovable Cloud (auth/profiles) — tudo novo vai no Externo + Railway, conforme regra de roteamento.

## Risco / Rollback
- Reversível: cada function nova é arquivo isolado, tabela nova é independente. Rollback = remover registros no router + drop da tabela.
- Risco médio: webhook handler novo. Mitigação — bloco isolado dentro de `try/catch`, falhas só logam (não bloqueiam o resto do webhook que já funciona).
- Custo: ~3 chamadas UazAPI por drag (lookup + remove + add) × N instâncias. Para BPC-Autismo com ~1-2 instâncias é desprezível.

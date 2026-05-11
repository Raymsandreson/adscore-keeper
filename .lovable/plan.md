## Objetivo

Quando uma atividade está aberta, mostrar de forma limpa, dentro do form, **o que está configurado para o passo atual do funil/processo do lead**:

- Mensagens pré-definidas para cada caixa de texto (com suporte a **múltiplas variações** por caixa).
- Checklist do passo (acessível por ícone expansível, sem ocupar espaço no form).

Configuração continua na tela do **Funil de Vendas** (WorkflowBuilder), reaproveitando o dialog "Modelos de mensagem da atividade" já existente.

---

## UX

### Acima de cada caixa de texto (Como está / O que foi feito / Próximo passo / Observações)

Renderiza apenas se o passo atual tiver modelo para aquela caixa:

- **1 modelo:** chip discreto `✦ Aplicar modelo` (clique substitui o conteúdo da caixa, com confirmação se já houver texto).
- **2+ modelos:** chip com balão `✦ 3 modelos ▾` → abre dropdown com nome + preview de cada variação. Clique aplica.
- **0 modelos:** nada renderizado (zero poluição).

### Acima do bloco "Detalhes e Observações"

Botão-ícone `📋 Checklist do passo (2/5)` — expansível inline. Mostra os itens (docChecklist) do passo atual como referência visual (read-only por enquanto). Se passo não tem checklist, botão não aparece.

---

## Schema

`ChecklistItem.messageTemplates` muda de `Record<string, string>` para `Record<string, string | TemplateVariation[]>` onde:

```ts
type TemplateVariation = { id: string; name: string; content: string };
```

Leitores normalizam string solta → `[{id, name: 'Padrão', content: string}]`. Sem migration de banco (campo é JSONB livre).

---

## Mudanças

### 1. `src/hooks/useChecklists.ts`
- Exporta `TemplateVariation` e helper `normalizeMessageTemplates(raw) → Record<fieldKey, TemplateVariation[]>`.
- Atualiza tipagem de `ChecklistItem.messageTemplates`.

### 2. `src/components/workflow/WorkflowBuilder.tsx` — dialog "Modelos de mensagem"
- Por aba (campo), em vez de uma Textarea única: lista de variações (Nome + Textarea + remover) + botão `+ Adicionar variação`.
- Salva sempre como array. Se array tem 1 item sem nome, salva como string (compat com dados antigos).

### 3. `src/hooks/useActivityStepContext.ts` (novo)
Input: `leadId`, `boardId` (do funil de vendas OU do workflow do processo selecionado).
Faz:
- Lê `leads.status` (stage atual) na tabela do banco externo.
- Busca `lead_checklist_instances` daquele lead/board/stage; pega o primeiro item não concluído como **passo ativo**.
- Retorna `{ stepLabel, docChecklist, messageTemplates: Record<fieldKey, TemplateVariation[]>, completedCount, totalCount }`.

### 4. `src/components/activities/StepTemplatePicker.tsx` (novo)
Componente puro:
- Props: `variations: TemplateVariation[]`, `onApply(content)`, `currentValue`.
- Renderiza chip único OU dropdown conforme contagem.
- Variáveis dinâmicas (`{{lead_name}}` etc.) **não** são interpoladas aqui — apenas insere texto cru. Interpolação acontece quando a mensagem é enviada (já existe no fluxo).

### 5. `src/components/activities/StepChecklistButton.tsx` (novo)
- Botão pequeno com badge `2/5`. Popover/Collapsible mostra os itens com check visual (read-only).

### 6. `src/components/activities/ActivityFormCompact.tsx`
- Aceita prop `stepContext` opcional.
- Renderiza `StepChecklistButton` no topo do bloco "Detalhes e Observações" se houver checklist.
- Renderiza `StepTemplatePicker` acima de cada `RichTextEditor` se houver variações para aquele `field_key`.

### 7. `src/pages/ActivitiesPage.tsx`
- Calcula `boardId` ativo (mesma lógica da progress bar: workflow do processo > board do lead).
- Usa `useActivityStepContext(formLeadId, boardId)` e passa `stepContext` para `<ActivityFormCompact>`.

---

## O que NÃO muda

- Tabelas do banco (campo já é JSONB).
- Lógica de envio ao grupo / interpolação de variáveis.
- Tela do Funil em si — só o conteúdo do dialog de modelos ganha lista de variações.
- Layout geral da atividade, header, footer, botões.

---

## Risco / rollback

Mudança puramente de UI + leitura. Schema retrocompatível (string → array normalizado em runtime). Reverter = `git restore` nos 7 arquivos. Sem deploy de função, sem migration.
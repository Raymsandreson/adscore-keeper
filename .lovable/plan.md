## Escopo

Três blocos independentes. Sem mexer em backend/edge functions — só frontend e regra de validação.

---

### 1. Card "Contatos Vinculados" do lead — `src/components/leads/LeadLinkedContacts.tsx`

**Estado atual:**
- Botão **Desvincular** (X) — clica e remove direto, **sem confirmação**.
- Botão **Excluir** (lixeira) — usa `window.confirm()` feio do navegador.
- Ambos só aparecem no hover (`opacity-0 group-hover:opacity-100`), ruim em mobile.

**Mudanças:**
- Trocar os dois para usar o hook `useConfirmDelete` (dialog padrão do app).
- **Desvincular:** dialog "Desvincular [nome] deste lead? O contato continua no banco."
- **Excluir:** dialog "Excluir DEFINITIVAMENTE [nome]? Remove de todos os leads e do banco de contatos. Não pode desfazer." (texto destrutivo claro).
- Tirar `opacity-0 group-hover:opacity-100` → botões sempre visíveis (melhor mobile).

---

### 2. Nº do Caso — `src/components/kanban/LeadEditDialog.tsx`

**Estado atual (linha 2333-2341):**
- Input `readOnly`, label "Nº do Caso (auto)", preenchido automaticamente pela ordem de assinatura ZapSign.
- Na hora de criar `legal_case` (linha 1240-1245): se `caseNumber` está vazio, chama RPC `generate_case_number` automaticamente.
- Foi exatamente isso que gerou o caos 1070/1071.

**Mudanças:**
- Input passa a ser **editável** (`readOnly` removido). Label vira "Nº do Caso *" (obrigatório quando fechado).
- Hint trocado para: "Preencha manualmente. Esta é a numeração oficial do caso e não será gerada automaticamente."
- **Validação no save:** se `leadOutcome === 'closed'` e `caseNumber` vazio/só espaços → toast de erro "Nº do Caso é obrigatório ao fechar um lead" e bloqueia o save (não prossegue).
- **Remover geração automática** na criação do `legal_case` (linha 1239-1245): se `caseNumber` vazio, não chama mais `generate_case_number` — usa o que o usuário digitou (que agora é obrigatório). Mantém `matchedNucleusId` só pra associar ao núcleo, não pra numerar.
- Manter o banner amarelo de "Nº do caso desatualizado" (caseSyncCheck) — agora ele vira sugestão pra editar manualmente, não auto-aplicação silenciosa.

**O que não muda:**
- O banner de sugestão (`applyCaseSync`) continua existindo — só renomeia o lead quando o usuário clica.
- `generate_case_number` RPC continua existindo no banco (não removo função), só não é mais chamada daqui.

---

### 3. Extrair com IA — picker de quantidade de mensagens

**Pergunta antes de codar:** o botão "Extrair com IA" com escolha de fonte (conversa do grupo / contato vinculado) **ainda não existe no código** — foi proposta minha do plano anterior que não foi implementada. Hoje só existe o "Extrair dados de notícia/documento" no `LeadNewsLinksManager`.

Opções:
- **(a)** Implementar agora a feature inteira: novo botão "Extrair com IA" dentro do `LeadEditDialog` com 3 escolhas: fonte (grupo/contato privado), quantidade (50/200/todas), e disparo. Vai pra função `extract-conversation-data` existente.
- **(b)** Por enquanto só adicionar o seletor 50/200/todas no botão "Preencher com IA" que já existe (linha 2278-2322, gera motivo do fechamento).
- **(c)** Esperar você confirmar onde quer o botão antes de eu codar.

Vou parar aqui no item 3 e perguntar via `ask_questions` qual das opções, em vez de chutar. Itens 1 e 2 já posso executar.

---

### Arquivos tocados
- `src/components/leads/LeadLinkedContacts.tsx` — confirmações + botões sempre visíveis
- `src/components/kanban/LeadEditDialog.tsx` — input editável, validação obrigatória, remoção do auto-generate

### Rollback
- Item 1: trivial, reverte arquivo.
- Item 2: reverte arquivo. Nenhum dado é tocado (zero SQL).

### Risco
- Item 2 muda comportamento de fechamento de lead: quem fechar sem preencher Nº do Caso vai ser bloqueado. **Isso é o pedido explícito** — mas pode quebrar fluxo de quem está acostumado a fechar e deixar pra preencher depois. Posso suavizar com warning em vez de bloqueio se preferir.

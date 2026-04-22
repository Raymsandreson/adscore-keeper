

# Plano: Corrigir cadastro de lead lento + 3 bugs do diálogo

## Diagnóstico (com evidência)

**1. Lentidão ao abrir e clicar no diálogo**
Console mostra refetch em loop:
- `📋 Kanban boards loaded: 16` — **4x** seguidas (hook sem cache, chamado por múltiplos componentes)
- `✅ Leads carregados: 2338 (3 página(s))` — **3x**, intercalado com `🔄 Realtime: atualizando leads...`
Cada ciclo baixa 2338 leads × ~65 colunas. O realtime dispara a cada UPDATE e o próprio refetch causa novo evento → loop. O diálogo não é lento por culpa própria; ele herda uma página travada.

**2. "Link da Notícia" salvo no Jurídico em vez do Básico**
Em `src/components/leads/AccidentLeadForm.tsx`:
- Linha 268-275 (aba **Básico**): label "Link da Notícia" mas ligado a `formData.group_link` (placeholder `chat.whatsapp.com`). Esse é o **link do grupo do WhatsApp**, rotulado errado.
- Linha 541-548 (aba **Jurídico**): label "Link da Notícia" ligado a `formData.news_link` — esse é o campo correto.
Resultado: usuário digita o link da notícia em Básico e ele vai pra coluna `group_link` do banco. O `news_link` real só pode ser preenchido na aba Jurídico.

**3. Nome do lead não segue o padrão do funil**
`UnifiedKanbanManager.handleAddLead` (linha 322-360) salva `lead_name` cru, sem aplicar prefixo + sequence do board. Padrão correto existe em `ImportFromSocialLinkDialog.tsx:478` usando `groupSettings.group_name_prefix` + `current_sequence` da tabela `kanban_boards`. Está faltando aqui.

**4. Lista de funis não aparece para selecionar**
O diálogo não tem dropdown de board. Usa `selectedBoardId` herdado da página. Se o usuário abre o "Adicionar Lead" sem ter um board pré-selecionado, ou quer mover pra outro funil, não consegue.

---

## O que vai mudar

### Bug #2 — Renomear o campo da aba Básico
- Em `AccidentLeadForm.tsx` linha 269, trocar label de "Link da Notícia" para **"Link do Grupo (WhatsApp)"**
- Manter o binding em `group_link` (já está correto semanticamente)
- **Adicionar** na aba Básico um campo novo "Link da Notícia" ligado a `news_link` (col-span-2, abaixo do grupo), pra usuário não precisar ir até Jurídico
- **Manter** o campo "Link da Notícia" da aba Jurídico funcionando (mesma fonte `news_link`) — assim os dois espelham o mesmo dado

### Bug #3 — Nome seguindo o funil
Em `UnifiedKanbanManager.handleAddLead`:
- Antes do insert, buscar `kanban_boards` do `selectedBoardId` pegando `group_name_prefix` e `current_sequence`
- Se houver prefixo, montar: `${prefix} ${sequence + 1} | ${nome digitado pelo usuário}`
- Após insert bem-sucedido, fazer `UPDATE kanban_boards SET current_sequence = sequence + 1`
- Se o board não tem prefixo configurado, manter o nome cru (comportamento atual)

### Bug #4 — Picker de funil no diálogo
Em `UnifiedKanbanManager` dentro do `<Dialog>` "Adicionar Lead" (linha 772):
- Adicionar acima do `AccidentLeadForm` um `<Select>` "Funil de Vendas" listando todos os boards de `boards`
- Default = `selectedBoardId` atual
- Estado local `selectedBoardForNewLead`, usado no `handleAddLead` em vez de `selectedBoardId` direto
- Validação: se vazio, erro "Selecione um funil"

### Bug #1 — Reduzir refetch em loop
Duas frentes mínimas (sem refatorar tudo):
- **`useKanbanBoards`**: introduzir cache via React Query (key `['kanban-boards']`, `staleTime: 5min`) ou singleton no módulo. Hoje cada componente que chama o hook dispara fetch novo — visto pelos 4 logs idênticos consecutivos.
- **`useLeads` realtime**: o handler do canal está chamando `fetchLeads()` cheio em vez de atualizar localmente o registro mudado. Trocar por: ao receber `UPDATE`, fazer merge do payload no estado local; ao receber `INSERT`, dar `unshift`; ao receber `DELETE`, filter. Refetch completo só no mount inicial. Isso elimina o ciclo "realtime → fetch 2338 → trigger realtime → fetch 2338".

---

## Não vou mexer em

- `LeadEditDialog`, `LeadManager.tsx` (diálogo diferente, sem o bug do screenshot)
- `CreateLeadFromSearchDialog`, `ImportFromSocialLinkDialog` (fluxos próprios, não relatados)
- Schema do banco (`group_link` e `news_link` já existem corretos)
- Política de realtime do Supabase
- Permissões/RLS

---

## Detalhes técnicos

**Arquivos editados:**
1. `src/components/leads/AccidentLeadForm.tsx` — renomear label linha 269; adicionar campo `news_link` na aba Básico
2. `src/components/kanban/UnifiedKanbanManager.tsx` — adicionar Select de board no Dialog (~linha 776); refatorar `handleAddLead` (~linha 322) para aplicar prefixo+sequence e usar `selectedBoardForNewLead`
3. `src/hooks/useKanbanBoards.ts` — migrar para `useQuery` com `staleTime`
4. `src/hooks/useLeads.ts` (ou onde está o realtime de leads) — trocar `fetchLeads()` por merge incremental no handler do canal

**Validação após implementar:**
- Cadastrar lead em board com prefixo configurado → nome final começa com `Prefixo N |`
- Cadastrar lead, conferir no banco que `news_link` foi populado quando preenchido em Básico
- Mudar funil no Select e confirmar que o lead foi salvo no board escolhido (não no `selectedBoardId`)
- Console: ver `📋 Kanban boards loaded` aparecer **1x** por carga de página, não 4x
- Console: editar 1 lead e confirmar que não aparecem mais `✅ Leads carregados: 2338` em sequência

**Risco:** mudar handler de realtime mexe num caminho quente. Vou manter um fallback de `fetchLeads()` em caso de evento sem `payload.new` válido, e versionar a função antiga como `_legacy` por 24h conforme prática do projeto.


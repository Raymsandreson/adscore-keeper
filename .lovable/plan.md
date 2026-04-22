

## Sincronização de participantes + seleção de contatos do lead ao fechar

### O que muda em relação ao plano anterior

Mantém tudo que já estava planejado para `rename-whatsapp-group` (sincronizar instâncias open/closed) e **adiciona** uma etapa interativa antes da renomeação: perguntar ao usuário quais **contatos do lead** devem ser adicionados ao grupo e marcados como `client` na tabela `contacts`.

### Fluxo novo ao fechar lead

1. Usuário muda lead para `closed` (via UI normal de fechamento).
2. **Antes** de chamar `rename-whatsapp-group`, abrir um diálogo `CloseLeadGroupDialog`:
   - Lista todos os contatos vinculados ao lead (via `contact_leads` join `contacts`)
   - Cada contato tem checkbox "Adicionar ao grupo" + checkbox "Marcar como cliente"
   - Padrão: ambos marcados para todos
   - Mostra também resumo do que vai acontecer com instâncias (X entram, Y saem)
   - Botões: "Confirmar e fechar" / "Cancelar"
3. Ao confirmar, chama `rename-whatsapp-group` passando `contacts_to_add: [{phone, mark_as_client}]` no body.

### Mudanças técnicas

**1. `supabase/functions/rename-whatsapp-group/index.ts`** (acumula com plano anterior)
- Aceitar novo payload opcional `contacts_to_add: Array<{phone, mark_as_client}>`
- Após sincronizar instâncias:
  - Para cada contato: chamar `${baseUrl}/group/participants` com `action:'add'` e `phone@s.whatsapp.net`
  - Se `mark_as_client = true`: `UPDATE contacts SET classification='client' WHERE id = X`
- Soft fail por contato (loga e continua se um número não puder ser adicionado)

**2. Novo componente `src/components/leads/CloseLeadGroupDialog.tsx`**
- Props: `leadId`, `boardId`, `open`, `onClose`, `onConfirm(payload)`
- Query 1: `contacts` vinculados ao lead via `contact_leads`
- Query 2: `board_group_instances` do board, agrupados por `applies_to` para mostrar preview
- Renderiza tabela: contato | telefone | "Adicionar ao grupo" | "Marcar como cliente"
- Footer mostra: "X instâncias entrarão, Y sairão, Z contatos serão adicionados"

**3. Integração na UI de fechamento**
- Localizar onde hoje o lead vira `closed` (provavelmente `LeadEditDialog` ou `UnifiedKanbanManager` no drag para última stage)
- Interceptar a transição: abrir `CloseLeadGroupDialog` antes de gravar `lead_status='closed'`
- Só após confirmação: gravar status + invocar `rename-whatsapp-group` com payload de contatos

**4. Trigger `auto_classify_contacts_on_lead_close`**
- Já existe e marca **todos** contatos do grupo como `client` automaticamente
- Conflito com a nova UX (usuário pode querer marcar só alguns)
- Solução: manter trigger como fallback, mas a edge function processa a lista explícita primeiro. Se `contacts_to_add` veio com `mark_as_client=false` para algum contato, o trigger ainda assim sobrescreve.
- **Decisão**: alterar o trigger para só marcar contatos que **não estão** em `contact_leads` do lead (pega só "extras" do grupo), deixando os contatos vinculados sob controle do usuário via dialog.

### O que NÃO muda

- Schema de `board_group_instances` (coluna `applies_to` já existe)
- UI de configuração de instâncias por status (`BoardGroupInstancesConfig.tsx`)
- Lógica de criação de grupo (`create-whatsapp-group`)
- Lógica de nome do grupo
- Fluxo de fechamento que **não passa** por mudança de status (ex: criação direta de caso) — o trigger `auto_close_lead_on_case_creation` segue como está

### Verificação pós-deploy

1. Lead aberto com 3 contatos vinculados → fechar → dialog aparece com 3 linhas marcadas
2. Desmarcar 1 "adicionar ao grupo" e 1 "marcar como cliente" → confirmar
3. Conferir no grupo: só 2 contatos novos foram adicionados
4. Conferir `contacts.classification`: só os marcados viraram `client`
5. Conferir instâncias: open saiu, closed entrou (sem regressão do plano anterior)

### Risco e rollback

- Trigger `auto_classify_contacts_on_lead_close` alterado → backup do código atual em comentário no migration; reverter via novo migration restaura comportamento original
- `rename-whatsapp-group` aceita payload novo de forma **opcional** → chamadas antigas (sem `contacts_to_add`) continuam funcionando idênticas
- Dialog é uma camada nova; se der erro pode ser bypassado deixando fluxo direto temporariamente


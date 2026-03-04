

## Plano: Botão "Criar Atividade" destacado + Chat com mídias no modo criação

### O que será feito

1. **Botão "Criar Atividade" mais destacado**
   - No header da página, trocar o botão de ícone discreto (`variant="ghost"`) por um botão com texto visível, cor de destaque (primária) e ícone `Plus`.
   - Na barra de ação do formulário (modo `create`), destacar o botão "Criar" com cor mais forte e ícone.

2. **Chat com suporte a mídias no modo criação**
   - Atualmente o botão "Chat" só aparece no modo `edit` (quando a atividade já existe). No modo `create`, ele não existe.
   - Adicionar o botão "Chat" também na barra de ação do modo `create`, abrindo o `ActivityChatSheet` em modo de criação (sem `activityId`, usando um ID temporário ou `null`).
   - O `ActivityChatSheet` já suporta mídias (imagens, PDFs, áudio) — basta disponibilizá-lo no fluxo de criação.
   - Após criar a atividade, migrar as mensagens de chat do ID temporário para o ID real da atividade criada.

### Mudanças técnicas

**`src/pages/ActivitiesPage.tsx`:**
- **Linha ~1500**: Substituir o `Button variant="ghost" size="icon"` por um botão destacado: `<Button size="sm" className="bg-white text-primary font-semibold hover:bg-white/90 gap-1"><Plus /> Nova Atividade</Button>`
- **Linha ~2714-2718**: No bloco `sheetMode === 'create'`, adicionar botão "Chat" (igual ao do modo edit) antes do botão "Criar", e destacar o botão "Criar" com ícone e cor.
- **Estado**: Usar um `tempChatKey` (ex: `temp_${Date.now()}`) quando o chat é aberto no modo criação, para que mensagens sejam salvas com esse identificador temporário.
- **Após `handleCreate`**: Se o chat foi usado, atualizar as mensagens no banco migrando o `activity_id` de `null` / temporário para o ID real retornado pelo `createActivity`.

**`src/components/activities/ActivityChatSheet.tsx`:**
- Já funciona com `activityId: null` e `leadId: null` — usa `leadId` como fallback. Precisará aceitar um `tempKey` opcional para o caso de criação sem ID.


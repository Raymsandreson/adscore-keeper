

## Problema

Ao abrir um grupo no WhatsApp, alternar para outra aba do navegador e voltar (ou recarregar a página), o histórico do grupo desaparece e só sobra a última mensagem.

## Causa raiz

Três fatores se combinam em `WhatsAppInbox.tsx` + `useWhatsAppMessages.ts`:

1. **A conversa selecionada não persiste.** `selectedPhone` e `selectedInstance` são `useState` simples (linhas 132 e 348 de `WhatsAppInbox.tsx`). No reload, voltam para `null` — não temos como saber qual era a conversa ativa para recarregar.

2. **O cache de histórico vive só em `ref` na memória.** `activeConversationKeyRef` e `fullConvCacheRef` (em `useWhatsAppMessages.ts`) são `useRef` — somem no remount/reload.

3. **O `fetchMessages` periódico só carrega 1 mensagem por conversa.** Linha 488: `setMessages(convList.map(c => c.messages[0]))`. O `summaryMessage` (linhas 407-425) é construído com a última mensagem do RPC `get_conversation_summaries`. Sem `fetchFullConversation` ter rodado depois do reload, o chat exibe exatamente esse 1 item.

Em grupos a degradação é mais visível porque chegam dezenas de mensagens novas — o "buraco" entre o summary e o histórico real fica óbvio. Em conversas 1:1 raramente se nota.

## Solução proposta

**Persistir a conversa selecionada e refazer o fetch completo no mount.**

### Mudanças em `src/components/whatsapp/WhatsAppInbox.tsx`

1. Trocar:
   ```ts
   const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
   const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
   ```
   por `usePageState` (já existe em `src/hooks/usePageState.ts`):
   ```ts
   const [selectedPhone, setSelectedPhone] = usePageState<string | null>('wa_selected_phone', null);
   const [selectedInstance, setSelectedInstance] = usePageState<string | null>('wa_selected_instance', null);
   ```

2. Adicionar `useEffect` que, quando `hasLoaded === true` e existir `selectedPhone + selectedInstance` restaurados do storage, dispara `fetchFullConversation(selectedPhone, selectedInstance)` uma vez. Isso reidrata o histórico completo do grupo no remount.

3. Garantir que `Select` de instância e o botão "voltar para lista" (mobile) limpam ambos os states (já limpa no `setSelectedInstanceId` da linha 724 — só estender para o `selectedInstance`).

### Mudança em `src/hooks/useWhatsAppMessages.ts`

4. Após o `fetchMessages` rodar, se `activeConversationKeyRef.current` estiver setado mas **sem** entrada em `fullConvCacheRef.current[key]`, disparar `fetchFullConversation` automaticamente (cobre o caso "ref preservada mas cache vazio após remount").

### O que NÃO vou mexer

- `getConversationSummaries` / RPC externa — a lógica de listagem está correta.
- `fetchFullConversation` em si — o pull de até 3000 msgs já funciona; o problema é apenas que ele não é redisparado no reload.
- Realtime subscription, dedupe de mensagens de grupo, lógica de envio.
- `WhatsAppChat.tsx` — exibição já lê de `selectedConversation.messages`, basta o estado superior estar correto.

## Plano de verificação

1. Abrir um grupo com histórico longo.
2. Abrir nova aba do navegador, esperar 30s, voltar.
3. Confirmar que o grupo continua selecionado e com histórico completo (não só a última mensagem).
4. Fazer reload (F5).
5. Confirmar que o grupo é reaberto automaticamente com histórico completo.
6. Trocar de instância no `Select` — deve limpar a seleção (comportamento atual).

## Risco e rollback

Risco: baixo. Mudança isolada a state management do Inbox; usa hook `usePageState` já em produção.
Rollback: reverter `WhatsAppInbox.tsx` e o efeito adicionado em `useWhatsAppMessages.ts` — sem migração, sem alteração de schema, sem deploy de edge function.


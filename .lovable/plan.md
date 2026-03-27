

## Plano: Implementar comando `#limpar`

### Resumo
Adicionar o comando `#limpar` ao webhook do WhatsApp. Quando enviado (outbound), limpa todas as mensagens daquela conversa (phone + instance), cancela sessões e desativa agentes. Apaga o comando e a confirmação do WhatsApp.

### Alterações em `supabase/functions/whatsapp-webhook/index.ts`

**1. Função `resolveAgentControlCommand` (linha 195)**
- Alterar tipo de retorno para incluir `'#limpar'`
- Adicionar reconhecimento de `#limpar` no texto exato e variantes de voz (limpar, limpe, apagar conversa)

**2. Lista `controlCommands` (linha 1546)**
- Adicionar `'limpar'` ao array para que não seja tratado como shortcut de agente

**3. Novo bloco após `#status` (após linha 1917)**
- `else if (resolvedControlCommand === '#limpar')`:
  - Apenas para `direction === 'outbound'`
  - Deletar todas as mensagens em `whatsapp_messages` com `phone` + `instance_name`
  - Cancelar sessões ativas em `wjia_collection_sessions` (update status → cancelled)
  - Desativar agentes em `whatsapp_conversation_agents` (update is_active → false)
  - Enviar confirmação "✅ Conversa limpa." via API
  - Aguardar 2s e apagar a mensagem de confirmação via `/message/delete`

### Fluxo
```text
Usuário envia "#limpar" (outbound)
  → resolveAgentControlCommand retorna '#limpar'
  → Webhook apaga #limpar do WhatsApp (bloco existente linha 1726)
  → Apaga #limpar do DB (bloco existente linha 1751)
  → Deleta whatsapp_messages WHERE phone=X AND instance_name=Y
  → Cancela sessões + desativa agentes
  → Envia "✅ Conversa limpa." → aguarda 2s → apaga confirmação
```

### Segurança
- Apenas `direction === 'outbound'` pode disparar (mensagens inbound ignoradas)
- Escopo restrito a `phone + instance_name` — não afeta outras conversas


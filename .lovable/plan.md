

## Plano: Corrigir resumo de caso não sendo enviado no grupo WhatsApp

### Problema identificado

Quando você envia um comando de texto livre (como "Crie um resumo do caso...") dentro de um grupo WhatsApp, o sistema:

1. Reconhece o remetente como autorizado e encaminha para o **command processor**
2. O command processor entra em **modo de coleta** ("Recebido! Tem mais alguma coisa?") e envia essa resposta no **chat privado**, não no grupo
3. O grupo nunca recebe o resumo solicitado

### Solução

Modificar o `whatsapp-command-processor` para tratar comandos vindos de grupos de forma diferente:

1. **Quando `is_group` é true, processar imediatamente** em vez de entrar no modo de coleta. Mensagens de grupo são auto-contidas (o contexto do grupo já está disponível via `group_id`).

2. **Enviar a resposta no grupo** (usando `group_id`) em vez de enviar no chat privado do remetente. Quando a mensagem vem de um grupo, o `sendWhatsAppText` deve usar o `group_id` como destinatário.

3. **Pular o modo de coleta para grupos**: Quando `is_group` é true, ir direto para o CASE 3 (processar com IA) usando o `groupConversationContext` como contexto completo.

### Arquivos a alterar

- `supabase/functions/whatsapp-command-processor/index.ts`
  - CASE 1 (linha ~441): Quando `is_group`, pular a coleta e processar imediatamente
  - Linha ~1582: Quando `is_group && group_id`, enviar resposta para `group_id` em vez de `normalizedPhone`
  - Garantir que o `groupConversationContext` seja carregado mesmo no processamento imediato

### Detalhes técnicos

```text
Fluxo atual (grupo):
  Mensagem no grupo → command processor → modo coleta → resposta no privado

Fluxo corrigido (grupo):
  Mensagem no grupo → command processor → processa com IA + contexto do grupo → resposta no grupo
```

- A lógica do `sendWhatsAppText` final usará `is_group && group_id ? group_id : normalizedPhone` como número de destino
- O anti-loop existente (`🤖 *WhatsJUD IA*`) já protege contra re-processamento da própria resposta


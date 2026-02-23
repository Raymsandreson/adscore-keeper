

# Plano: Registro Automatico de Chamadas WhatsApp

## Problema Atual
O webhook da UazAPI aponta para um intermediario (n8n em `webhooks.prudenciosolucoes.com.br`). A Edge Function `whatsapp-webhook` ja tem toda a logica para processar eventos de chamada (`offer`, `accept`, `terminate`), mas so funciona se o n8n repassar esses eventos.

## Solucao em 2 Partes

### Parte 1 - Registro automatico ao iniciar chamada pelo sistema
Quando o usuario clica "Ligar" no chat, o sistema ja chama `/call/make` da UazAPI. Vamos aproveitar esse momento para criar automaticamente um registro na `call_events_pending` e na `call_records`, sem depender do webhook.

**Alteracao na Edge Function `make-whatsapp-call`:**
- Apos chamar `/call/make` com sucesso, inserir um registro em `call_events_pending` com `event_type: 'offer'` e `from_me: true`
- Inserir um registro preliminar em `call_records` com `call_result: 'em_andamento'`
- Retornar o `call_record_id` para o frontend

**Alteracao no `WhatsAppCallRecorder.tsx`:**
- Receber o `call_record_id` da Edge Function
- Quando o usuario clicar "Atendeu" ou "Nao atendeu", atualizar esse registro com o resultado e duracao corretos
- Remover a necessidade de gravar audio obrigatoriamente para ter o registro

### Parte 2 - Garantir que o webhook receba eventos de chamada
Duas opcoes (nao requer mudanca de codigo):

**Opcao A (Recomendada):** No n8n, adicionar um node HTTP Request que encaminha payloads com `EventType === 'call'` para:
```
POST https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/whatsapp-webhook
```

**Opcao B:** Na UazAPI, usar o botao "Webhook Global" para adicionar um segundo webhook apontando diretamente para a Edge Function, com apenas o evento `call` habilitado.

## Detalhes Tecnicos

### Arquivo: `supabase/functions/make-whatsapp-call/index.ts`
- Adicionar insercao em `call_records` apos chamada bem-sucedida
- Campos: `user_id` (do token JWT), `call_type: 'realizada'`, `call_result: 'em_andamento'`, `contact_phone`, `phone_used: 'whatsapp'`
- Retornar `call_record_id` na resposta

### Arquivo: `src/components/whatsapp/WhatsAppCallRecorder.tsx`
- Salvar o `call_record_id` retornado pela Edge Function
- Nos botoes "Atendeu" e "Nao atendeu", fazer `UPDATE` no `call_records` com o resultado final e duracao
- Se houver gravacao de audio, atualizar o mesmo registro com `audio_url`

### Resultado Final
- Toda chamada feita pelo sistema sera registrada automaticamente
- O usuario so precisa indicar o resultado (atendeu/nao atendeu) 
- Se o webhook do n8n tambem repassar, nao havera duplicatas pois usamos o mesmo `call_id`

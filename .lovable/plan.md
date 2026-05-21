## Objetivo

Quando o operador colocar a etiqueta `Proc.BPC` na conversa do WhatsApp, o sistema:
1. Detecta via webhook UazAPI
2. Puxa últimas N mensagens + mídias diretamente da UazAPI (não do nosso banco)
3. Roda OCR + extração de campos com IA
4. Notifica o operador na extensão Chrome
5. Operador revisa/edita e clica "Gerar" → ZapSign envia o documento

Hoje 2 gatilhos já estão configurados (`Proc.BPC` em ISRAEL e João Manoel), mas o webhook ignora o evento `labels`. Nada dispara.

---

## Escopo desta entrega

### Peça 1 — Webhook ouve etiquetas (Railway)
**Arquivo:** `railway-server/src/functions/whatsapp-webhook.ts`

- Remover `labels` da lista de eventos ignorados (linha 692)
- Adicionar handler que, quando label é **adicionada** (não removida):
  - Normaliza `instance_name` + `label_name` (case-insensitive)
  - Busca em `label_document_triggers` (Externo) gatilho ativo
  - Se achar, chama `prepare-label-document-trigger` (HTTP POST async, fire-and-forget)
- **Anti-duplicação:** antes de disparar, checa se já existe `pending_label_documents` com status `pending` pra esse chat+label

### Peça 2 — Função de extração (Railway, nova)
**Arquivo:** `railway-server/src/functions/prepare-label-document-trigger.ts`

Recebe `{ chatId, phone, instance, labelName, templateId, triggerId }`. Fluxo:

1. Token UazAPI da instância (de `whatsapp_instances` no Cloud)
2. `GET /message/find` na UazAPI → últimas 50 mensagens do chat
3. `GET /message/download` pra cada mídia imagem/PDF
4. Roda extração de texto + OCR via `ai.gateway.lovable.dev` (Gemini Vision)
5. Insere em `pending_label_documents` (Externo): `chat_id, phone, instance, label_name, template_id, trigger_id, extracted_fields jsonb, media_urls jsonb, status='pending', expires_at = now() + 24h`
6. Cria notificação no chat interno (toast pro operador dono da instância)

### Peça 3 — Tabela `pending_label_documents` (migration Externo)
Campos: `id, chat_id, phone, instance_name, label_name, template_id, trigger_id, extracted_fields jsonb, media_urls jsonb, status (pending|generated|discarded), created_by, created_at, expires_at, deleted_at`

Índice único parcial: `(chat_id, label_name) WHERE status='pending' AND deleted_at IS NULL` — evita rascunho duplicado.

### Peça 4 — Painel na extensão Chrome
**Arquivo:** `chrome-extension/content.js` (já tem infra de sidebar)

- Polling de 10s em `pending-label-documents?phone=X&instance=Y` quando há conversa aberta
- Se houver pendente: **selo flutuante** no header ("📄 Procuração pronta pra revisão")
- Click → drawer lateral com:
  - Campos extraídos editáveis (nome, CPF, RG, endereço, etc.)
  - Lista de mídias usadas
  - Botão **Gerar e enviar** → chama `zapsign-api/generate-document` com dados editados + marca pending como `generated`
  - Botão **Descartar** → soft-delete

### Peça 5 — Endpoint de leitura pra extensão
**Edge function Cloud nova:** `list-pending-label-documents` (proxy leve, lê do Externo + valida que o user logado tem acesso à instância)

---

## O que NÃO vou mexer

- Fluxo atual do popup "Gerar Documento para Assinatura" — continua igual em paralelo
- Tela de configuração de gatilhos (`/settings` → Etiquetas-Gatilho) — já está pronta
- Eventos do webhook que não são `labels`
- `zapsign-api/generate-document` — só chamo, não altero

---

## Rota de fuga

- Flag `enabled=false` no gatilho desliga sem deletar
- `pending_label_documents` com TTL 24h + soft-delete — operador descarta sem perder rascunho
- Webhook: se mapeamento não existir, no-op silencioso (adicionar etiqueta nova é seguro)
- Se a função de extração falhar, ela grava `pending` com `extracted_fields={}` e `error` no payload — operador ainda vê o card e preenche manual

---

## Ordem de execução

1. Migration `pending_label_documents` no Externo
2. `prepare-label-document-trigger.ts` no Railway + registro em `index.ts`
3. Ativar handler de `labels` no `whatsapp-webhook.ts`
4. Edge `list-pending-label-documents` no Cloud
5. Painel + polling na extensão Chrome
6. Rebuild do ZIP da extensão e teste end-to-end com a etiqueta **Proc.BPC** que você já aplicou

---

## Importante sobre o teste atual

A etiqueta que você acabou de aplicar **agora** no chat do João Manoel + 86 8130-2092 **vai se perder** — o webhook ignorou o evento. Depois que eu subir tudo, você precisa:

- Tirar a etiqueta `Proc.BPC` e botar de novo → aí o webhook captura e o fluxo roda
- OU eu disparo manualmente uma vez via curl pra processar essa conversa específica

---

## Tempo estimado

- Peças 1–3 (backend): ~30 min
- Peça 4 (extensão Chrome): ~20 min
- Teste end-to-end: ~10 min

Total: ~1h de implementação. Pode confirmar que sigo?

## Objetivo

Quando o operador colocar uma etiqueta no chat do WhatsApp (ex: `PROCURAÇÃO_GERAL_`), o sistema:
1. Detecta via webhook UazAPI
2. Olha o mapeamento "etiqueta → template ZapSign" configurado
3. Puxa a conversa inteira **da UazAPI** (não do nosso banco) + mídias
4. Extrai dados com IA (texto + OCR dos documentos enviados)
5. Notifica o operador na **extensão Chrome** (sem sair do WhatsApp Web)
6. Operador revisa/edita os campos preenchidos e clica "Gerar"
7. ZapSign cria o documento e envia

Pense assim: a etiqueta é o "botão invisível" que o operador aperta dentro do próprio WhatsApp. A extensão é o "balcão de revisão" que aparece pra ele conferir antes de mandar.

---

## Por que puxar tudo da UazAPI e não do nosso banco?

Você levantou o ponto certo. Hoje a extração lê de `whatsapp_messages` (banco Externo), que tem dois problemas:
- Depende da instância ter estado conectada quando a mensagem chegou
- Mídias antigas podem não ter sido baixadas ou estarem expiradas

Indo direto na UazAPI (`/message/find` + `/message/download`) a gente garante:
- Histórico completo, mesmo se a instância caiu e voltou
- Acesso fresh às mídias pra OCR

---

## Peças a construir

### 1. Tabela de mapeamento (Externo)
`label_document_triggers`
- `label_name` (texto, case-insensitive)
- `instance_name` (qual instância dispara)
- `zapsign_template_id` (qual template usar)
- `auto_extract_media` (bool — fazer OCR dos docs do chat?)
- `enabled` (bool)
- `created_by`, `created_at`

### 2. Tela de configuração
Em `Configurações → WhatsApp → Etiquetas-Gatilho`:
- Listar etiquetas existentes (puxar via `GET /labels` da UazAPI por instância)
- Pra cada etiqueta, escolher o template ZapSign
- Toggle de ativo/inativo

### 3. Webhook — tratar evento `labels`
Em `railway-server/src/functions/whatsapp-webhook.ts`:
- Tirar `labels` da lista de skip
- Quando chegar evento de label **adicionada** (não removida):
  - Buscar mapeamento ativo pra essa `label_name` + `instance_name`
  - Se achar, chamar a função `prepare-label-document-trigger`

### 4. Função `prepare-label-document-trigger` (Railway)
- Recebe `{ chatId, phone, instance, labelName, templateId }`
- Puxa últimas N mensagens via UazAPI `/message/find`
- Baixa mídias (imagens/PDFs) via `/message/download`
- Roda OCR + extração de campos (reaproveita `extract-conversation-data` + `classify-document`)
- Salva resultado em `pending_label_documents` (rascunho com TTL de 24h)
- Notifica operador via:
  - Toast no chat interno
  - Push pra extensão Chrome (via `chrome.storage` + polling)

### 5. Extensão Chrome — painel de revisão
- Quando há `pending_label_document` pra esse chat, mostra **selo flutuante** no header da conversa do WhatsApp Web ("📄 Procuração pronta pra revisão")
- Clicando, abre **drawer lateral** dentro do próprio WhatsApp Web (não popup):
  - Lista de campos extraídos (nome, CPF, RG, endereço, etc.) editáveis
  - Preview do template
  - Botão "Gerar e enviar" → chama `zapsign-api/generate-document`
  - Botão "Descartar"

### 6. Reuso do que já existe
- `extract-conversation-data` (Railway) — só adicionar parâmetro `source: 'uazapi'` pra puxar da UazAPI ao invés do DB
- `classify-document` (edge) — já faz OCR multi-imagem, perfeito
- `zapsign-api` (edge) — já gera documento, só chamar com dados prontos

---

## Detalhes técnicos

### Roteamento das funções novas
- `prepare-label-document-trigger` → **Railway** (puxa muita mídia, faz OCR pesado)
- Tabela `label_document_triggers` e `pending_label_documents` → **Supabase Externo** (dados de negócio)
- Tela de config → frontend Lovable normal usando `db` do barrel

### Secrets necessários
Tudo que já temos: `UAZAPI_TOKEN` por instância, `LOVABLE_API_KEY` pra IA, `ZAPSIGN_API_KEY`. Nada novo.

### Anti-duplicação
`pending_label_documents` tem unique em `(chat_id, label_name, status='pending')` — se já existe rascunho pendente, webhook não cria outro.

### Polling da extensão
A extensão já tem infra pra renderizar na sidebar (memória `chrome-extension-whatsapp`). Adicionar polling de 10s em `/pending-label-documents?phone=X` quando estiver numa conversa aberta.

---

## Ordem de execução proposta

1. Migration: criar `label_document_triggers` + `pending_label_documents`
2. Tela de Configurações com listagem de etiquetas via UazAPI
3. Webhook: ativar tratamento de `labels` + chamar trigger
4. Função `prepare-label-document-trigger` no Railway
5. Extensão: selo flutuante + drawer de revisão
6. Teste end-to-end com etiqueta real

---

## Rota de fuga

- Flag `enabled` por linha — desliga gatilho sem deletar
- `pending_label_documents` com soft-delete e TTL — operador pode descartar sem perder rascunho
- Webhook ignora se mapeamento não existir → adicionar etiqueta sem config é no-op seguro

---

## O que NÃO vou mexer

- Fluxo atual do popup "Gerar Documento para Assinatura" — continua existindo igual, é só uma rota paralela
- `whatsapp_messages` / banco de mensagens — leitura UazAPI é adicional, não substitui
- Outros eventos de webhook (`messages.upsert` etc.) — só destravo `labels`

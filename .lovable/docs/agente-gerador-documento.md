# Fluxo: Agente Gerador de Documento (Etiqueta → Link → Procuração)

> Documentação viva. Atualizar sempre que mudar algo do fluxo.
> Última atualização: 2026-05-23

## 1. Configuração do agente (aba "Documento")

**Arquivo:** `src/components/whatsapp/WhatsAppCommandConfig.tsx` (linhas 1356–1620+)
**Quando aparece:** apenas para agentes do tipo `📄 Gerador de Documentos` ou `🔄 Híbrido`.

Campos disponíveis hoje:

| Campo | Descrição | Storage |
|---|---|---|
| `template_token` / `template_name` | Modelo ZapSign selecionado | `agent.template_token` |
| `notify_on_signature` | Avisa quando documento for assinado | `agent.notify_on_signature` |
| `send_signed_pdf` | Envia PDF assinado pelo WhatsApp | `agent.send_signed_pdf` |
| `request_documents` + `document_types` + `document_type_modes` | Pede RG/CNH, comprovante endereço, renda, outros (required/optional) | `agent.document_types[]` |
| `zapsign_mode` | `final_document` (só assinar) ou `prefilled_form` (formulário pré-preenchido) | `agent.zapsign_mode` |
| `skip_confirmation` + `partial_min_fields` | Gera com dados parciais (modo prefilled_form) | `agent.partial_min_fields[]` |

## 2. Trigger por etiqueta (Railway)

**Arquivo:** `railway-server/src/functions/prepare-label-document-trigger.ts`
**Fluxo:**

1. Webhook UazAPI dispara quando etiqueta é colocada no chat.
2. Função extrai dados da conversa (IA) e identifica campos preenchidos vs faltantes.
3. Insere em `pending_label_documents` (Externo) com:
   - `status: 'awaiting_operator_review'`
   - `review_token` (token curto único)
   - `expires_at` (48h)
   - `extracted_fields`, `extracted_documents` (mídia já enviada no chat)
4. Gera URL: `https://adscore-keeper.lovable.app/revisar/{token}`
5. **HOJE:** envia notificação no WhatsApp **PARA O OPERADOR** (número configurado em `notifier_instance_settings.reviewPhone`).

## 3. Página de revisão pública

**Rota:** `/revisar/:token` → `src/pages/DocumentReviewPage.tsx`
**Backend:** Railway `/public/review/get` e `/public/review/submit` (`submit-document-review.ts`)

**O que faz hoje:**
- Carrega campos do template + valores extraídos pela IA (marcados com ✨).
- Operador revisa os campos no celular/desktop.
- Botão "Confirmar e enviar ao cliente" → gera ZapSign → envia link de assinatura no WhatsApp do cliente.
- Botão descartar.

**O que NÃO faz hoje (gaps vs popup do print):**
- ❌ Upload de novos documentos (RG, comprovante) para extração adicional.
- ❌ Re-rodar extração da IA depois de upload.
- ❌ Seleção/troca de template (já vem fixo do agente).
- ❌ Configuração de signatários múltiplos.
- ❌ Preview do PDF antes de enviar.

## 4. Popup "do print" (referência do que o usuário quer no link)

**Arquivo:** `src/components/whatsapp/ZapSignDocumentDialog.tsx` (1197 linhas)
**Steps:** `select` → `signers` → `fill` → `creating`

Funções principais (que o usuário quer ver dentro do `/revisar/:token`):
- Upload de arquivos (RG, CNH, comprovantes) com extração via IA (`zapsign-api` action `extract_fields`).
- Texto colado adicional (`pastedText`).
- Origem da extração: `upload_only` ou `upload_and_chat`.
- Preview do prompt enviado à IA.
- Edição de campos com badge "✨ preenchido pela IA".
- Confirmação dupla (pré-create + pré-send).
- Preview do PDF gerado antes de mandar.

## 5. Pedido atual do usuário (em construção)

> "Quando agente com função 'gerar documento' for acionado pela etiqueta:
>  - Sistema posta nota no contato (via UazAPI) com link.
>  - Link abre formulário online no WhatsJUD (mobile-first).
>  - Formulário tem MESMAS funções do popup do print (upload, extração IA, edição).
>  - Após coleta completa → gera procuração → envia pro número que originou o link."

### Gaps a fechar
1. **UazAPI Note Update:** adicionar chamada `POST /chat/edit` (ou equivalente) no `prepare-label-document-trigger.ts` para gravar o link na nota do contato. Endpoint a confirmar na doc UazAPI.
2. **Expandir `DocumentReviewPage`** para suportar:
   - Upload de arquivos → enviar pro `zapsign-api` `extract_fields` → re-popular campos com badge ✨.
   - Texto colado adicional.
   - Preview do PDF antes do submit.
3. **Backend `submit-document-review.ts`** já gera ZapSign e envia link pro telefone do `pending_label_documents.phone` — não muda.

## 6. Tabelas e endpoints chave

- **Externo:** `pending_label_documents` (revisão), `zapsign_documents` (docs gerados).
- **Cloud:** `notifier_instance_settings` (config de notificação).
- **Railway:** `POST /public/review/get`, `POST /public/review/submit`, `POST /internal/prepare-label-document-trigger`.
- **Cloud function:** `zapsign-api` (actions: `create_doc`, `extract_fields`, `preview_extract_prompt`, `list_templates`, `get_template_fields`).

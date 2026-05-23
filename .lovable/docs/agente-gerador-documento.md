# Fluxo: Agente Gerador de Documento

> Documentação viva. Atualizar sempre que mudar algo do fluxo.
> Última atualização: 2026-05-23 (link único)

## TL;DR — Modelo atual (link único)

Existe uma **porta fixa** no app: `/gerar-procuracao` (com login).
O operador entra, digita o telefone do cliente, e o sistema:
1. Acha contato/lead pelo telefone (Externo)
2. Abre o `ZapSignDocumentDialog` (mesmo popup do chat)
3. IA puxa campos da conversa
4. Operador revisa, opcionalmente faz upload de docs (RG, etc.), e envia.
5. O WhatsApp de destino do link é sempre o **celular revisado do signatário principal** no popup. Se vier número BR antigo com 10 dígitos, o sistema adiciona o 9º dígito antes de chamar o envio.

A **etiqueta UazAPI** vira apenas um *atalho*: dispara o webhook,
o Railway monta o link pré-preenchido e manda no WhatsApp pro operador
configurado em `whatsapp_instances.review_notification_phone`.

## 1. Configuração do agente (aba "Documento")

**Arquivo:** `src/components/whatsapp/WhatsAppCommandConfig.tsx`
**Quando aparece:** agentes do tipo `📄 Gerador de Documentos` ou `🔄 Híbrido`.

Campos principais armazenados em `whatsapp_agent_commands`:
- `template_token` / `template_name` — modelo ZapSign
- `notify_on_signature`, `send_signed_pdf`
- `request_documents`, `document_types[]`, `document_type_modes`
- `zapsign_mode` — `final_document` ou `prefilled_form`
- `skip_confirmation`, `partial_min_fields[]`

## 2. Página `/gerar-procuracao` (novo modelo)

**Arquivo:** `src/pages/GerarProcuracaoPage.tsx`
**Rota:** protegida por `<ProtectedRoute>` (mesmo login do app — atende LGPD).

Query params aceitos (link pré-preenchido):
- `?phone=5511999999999` — abre automaticamente
- `&instance=oficial` — instância de origem
- `&template=BPC_LOAS_TOKEN` — modelo sugerido (pré-seleciona no popup)

Internamente apenas:
- Busca `contacts`/`leads` pelo telefone no Externo
- Renderiza `<ZapSignDocumentDialog open phone=... contactId=... leadId=... />`

Toda a inteligência (upload, extração IA, edição, preview, envio) está **dentro**
do dialog já existente — zero código duplicado.

Regra crítica de envio: o link de assinatura não usa cegamente o `phone` da URL/conversa.
Ele usa o telefone editado no bloco **Signatário principal** do `ZapSignDocumentDialog`,
porque a IA/ZapSign pode corrigir um número antigo como `86 8181-2709` para `86 98181-2709`.

## 3. Trigger por etiqueta (Railway)

**Arquivo:** `railway-server/src/functions/prepare-label-document-trigger.ts`

Fluxo (atualizado):
1. Webhook UazAPI dispara quando a etiqueta entra no chat.
2. Função extrai dados da conversa (IA) e grava `pending_label_documents`
   com `status: 'awaiting_operator_review'` + `review_token` + `expires_at`
   (mantido por compatibilidade/auditoria).
3. Monta URL **nova**:
   `https://adscore-keeper.lovable.app/gerar-procuracao?phone=X&instance=Y&template=Z`
4. Renderiza `settings.message_template` com `{review_url}` e `{generate_url}`
   apontando pra essa URL nova.
5. Envia no WhatsApp pro `review_notification_phone` da instância de origem.

## 4. Rota `/revisar/:token` (legado)

Mantida. Links já enviados antes da mudança continuam funcionando.
Não geramos novos tokens pra esse fluxo a partir de agora.
- Página: `src/pages/DocumentReviewPage.tsx`
- Backend: `get-pending-review.ts` + `submit-document-review.ts`

## 5. Tabelas e endpoints chave

- **Externo:** `pending_label_documents`, `zapsign_documents`, `contacts`, `leads`, `whatsapp_messages`
- **Cloud:** `label_review_notification_settings`, `whatsapp_instances`
- **Railway:** `POST /functions/prepare-label-document-trigger`, `POST /public/review/get`, `POST /public/review/submit`
- **Cloud edge function:** `zapsign-api` (actions: `list_templates`, `get_template`, `extract_data`/`extract_fields`, `create_doc`, `preview_extract_prompt`)

## 6. Como reverter (rollback)

1. `/gerar-procuracao` → remover rota em `src/App.tsx` e deletar `GerarProcuracaoPage.tsx`
2. Trigger → reverter o bloco da URL em `prepare-label-document-trigger.ts` pra `/revisar/{reviewToken}`
3. Rota `/revisar/:token` nunca foi tocada — não precisa reverter.

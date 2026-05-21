## Objetivo

Quando a etiqueta-gatilho for aplicada:
1. IA extrai **só o que tem evidência clara** na conversa (nada de inventar).
2. Sistema **NÃO envia** o ZapSign automaticamente pro cliente.
3. Sistema manda **link de revisão no WhatsApp do operador dono da instância**.
4. Operador abre o link no celular (ou desktop), revisa/edita campos, clica **Confirmar e enviar** → aí sim ZapSign vai pro cliente.

**Metáfora:** hoje o sistema é tipo um estagiário que preenche o formulário sozinho e já envia. Vai virar: estagiário preenche **só o que tem certeza**, deixa o resto em branco, e manda WhatsApp pro chefe revisar antes de mandar pro cliente.

---

## Peça 1 — IA mais honesta (`zapsign-api action=extract_data`)

**Arquivo:** edge function `zapsign-api` no Externo (eu baixo via Management API, edito, faço deploy)

Mudanças no prompt do `extract_data`:
- Regra explícita: "Se não houver evidência **explícita e literal** na conversa, deixe `para: ''` (string vazia). NÃO infira, NÃO complete, NÃO use conhecimento geral."
- Exemplos negativos no prompt: "se o cliente não disse o nome do filho → NOME_COMPLETO_FILHO fica vazio".
- Validações pós-extração: CPF precisa ter 11 dígitos com pattern, RG idem, CEP 8 dígitos. Se não bater → descarta o valor (vira vazio).

## Peça 2 — Mudar fluxo: não auto-enviar pro cliente

**Arquivo:** `railway-server/src/functions/prepare-label-document-trigger.ts`

- Remove o bloco `shouldAutoGenerate` que cria doc no ZapSign + manda link pro cliente.
- Em vez disso, sempre grava `pending_label_documents` com status `awaiting_operator_review`.
- Gera um **token curto único** (`review_token`, 12 chars) e grava no registro.
- Resolve o operador dono: `whatsapp_instances.assigned_user_id` (ou primeiro user em `whatsapp_instance_users` da instância) → busca telefone WA dele em `profiles.whatsapp_phone`.
- Manda WhatsApp **pro operador** (não pro cliente):
  > 📋 Documento *Proc.BPC* pronto pra revisão  
  > Cliente: João Manoel (+86 8130-2092)  
  > Campos preenchidos: 4/12  
  > 👉 https://adscore-keeper.lovable.app/revisar/{review_token}

## Peça 3 — Tabela `pending_label_documents` (migration Externo)

Adicionar colunas:
- `review_token text unique` — pra rota pública
- `review_token_expires_at timestamptz` — TTL 48h
- `reviewed_by uuid` — quem confirmou
- `reviewed_at timestamptz`
- Novo status: `awaiting_operator_review`

Index: `(review_token) WHERE deleted_at IS NULL`.

## Peça 4 — Página de revisão `/revisar/:token` (mobile-first PWA)

**Arquivo novo:** `src/pages/DocumentReviewPage.tsx` + rota em `App.tsx`

- Rota **pública** (não exige login — token já é a credencial, igual link mágico). Validação de token + expiração na edge function.
- Layout single-column, otimizado pra 375px (iPhone SE até iPhone Pro Max e Android).
- Mostra:
  - Header: nome do cliente, telefone, etiqueta, instância
  - Lista de **campos editáveis** (Input por campo, label do template, valor pré-preenchido pela IA ou vazio)
  - Campos vazios destacados em amarelo ("⚠️ Preencher")
  - Campos preenchidos pela IA marcados com 🤖 (operador sabe que pode revisar)
  - Botão grande **Confirmar e enviar ao cliente** (sticky no rodapé)
  - Botão secundário **Descartar**

PWA já tá ativo no projeto → operador pode adicionar o site à tela inicial e o link abre direto, sem barra do navegador. Funciona igual iPhone (Safari → Compartilhar → Adicionar à Tela de Início) e Android (Chrome → menu → Instalar app).

## Peça 5 — Edge function `submit-document-review` (Railway)

**Arquivo novo:** `railway-server/src/functions/submit-document-review.ts`

Recebe `{ review_token, fields: [{de, para}], reviewed_by_phone }`. Fluxo:
1. Busca `pending_label_documents` pelo token, valida não expirou e status = `awaiting_operator_review`
2. Chama `zapsign-api action=create_doc` com os campos revisados (já com `signer_has_incomplete_fields: true` como fallback)
3. Manda WhatsApp pro **cliente** com o link de assinatura
4. Atualiza pending: `status='sent_after_review'`, `sign_url`, `reviewed_at=now()`

## Peça 6 — Edge function `get-pending-review` (Railway)

Endpoint público GET `?token=xxx` que retorna `{ pending, template_fields, contact, lead }` pra página de revisão carregar.

---

## O que NÃO vou mexer

- Fluxo de etiqueta-gatilho atual (continua disparando webhook → prepare-label)
- `zapsign-api action=create_doc` (continua igual, só passa a ser chamado mais tarde)
- Extensão Chrome (fica como caminho alternativo pra quem usa desktop, mas não é o principal)
- Auth/RLS de outras tabelas

## Rota de fuga

- Token expira em 48h — se operador não revisar, pending vira `expired` via pg_cron diário
- Se WhatsApp do operador não estiver configurado → cai pro chat interno como backup
- Flag global no settings: "Modo revisão" on/off — desliga e volta ao auto-envio antigo
- Versão antiga do `prepare-label-document-trigger.ts` fica como `_legacy` por 24h

## Ordem de execução

1. Migration adicionando colunas em `pending_label_documents` (via `run-external-migration`)
2. Editar `zapsign-api/extract_data` no Externo (prompt conservador + validações) — eu baixo, edito, faço deploy
3. Reescrever `prepare-label-document-trigger.ts` no Railway (sem auto-envio, manda link pro operador)
4. Criar `get-pending-review.ts` + `submit-document-review.ts` no Railway + registrar em `index.ts`
5. Criar `src/pages/DocumentReviewPage.tsx` + rota `/revisar/:token` + commit
6. Teste end-to-end: aplicar etiqueta `Proc.BPC` num chat de teste → verificar WhatsApp do operador → abrir link no celular → confirmar → ver mensagem chegar no cliente

## Tempo estimado

- Peças 1–3 (backend + migration): 25 min
- Peças 4–6 (página + edges): 30 min  
- Teste end-to-end: 10 min

Total: ~1h.

## Pergunta de confirmação (uma só)

Pro WhatsApp **do operador**, eu uso qual número?
- (a) Campo `whatsapp_phone` no `profiles` (Cloud) — se já estiver preenchido pra cada user
- (b) Configuro um único número-coringa (tipo o seu pessoal) que recebe TODOS os links, independente de qual operador é dono da instância

Confirma o plano e me responde (a) ou (b) que eu sigo.
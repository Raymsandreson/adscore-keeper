## Bug
Quando um cliente assina pelo seu próprio WhatsApp e depois encaminha contratos de OUTROS signatários pela mesma conversa, o webhook ZapSign vincula todos esses documentos ao lead original (por `whatsapp_phone`). O `zapsign-enrich-lead` então sobrescreve city/state/neighborhood/cpf/cep/victim_name do lead com os dados do último signatário.

Caso atual no lead `bfaddfed`:
- doc 1 — RAYMSANDRESON (cliente real, dono do telefone)
- doc 2 — ANDRÉIA BARBOSA (sobrescreveu)
- doc 3 — CAROLINE MATOS (sobrescreveu de novo)

## Regra nova
Cada `signer_token` único = um lead único. Documento só é vinculado a lead existente se o `signer_token` (ou nome+CPF) for o mesmo. Caso contrário → cria lead novo.

## Mudanças de código

### 1. `supabase/functions/zapsign-webhook/index.ts`
**Bloco AUTO-RESOLVE (linhas 238–292):** antes de gravar `localDoc.lead_id` a partir de `lead_phone`, verificar se aquele lead já tem documento com `signer_token` diferente. Se sim → NÃO vincula. O doc segue sem `lead_id`, cai no bloco AUTO-CREATE (793+) e gera lead próprio para o novo signatário.

**Bloco AUTO-CREATE (linhas 786–1057):** já cria lead novo quando `!localDoc.lead_id`. Adicionar: usar `signer_phone` da ZapSign como `lead_phone` quando existir e tiver >4 dígitos (preserva identidade real do signatário, em vez do WhatsApp do encaminhador).

### 2. `supabase/functions/zapsign-enrich-lead/index.ts`
Salvaguarda dupla: se o lead já tem `cpf` preenchido E o `cpf` extraído do PDF é diferente → aborta o `update` dos campos pessoais (cpf/rg/birth_date/cep/street/number/complement/neighborhood/city/state/victim_name). Mantém apenas o upload do PDF no Drive e o vínculo do doc. Loga aviso `signer mismatch`.

### 3. UI (Aba Documentação) — sem mudança
Já lista por `lead_id`, então com a regra nova cada lead mostrará só os docs do seu próprio signatário. Drive já está anexando — manter como está.

## Correção de dados (one-shot)
1. Restaurar lead `bfaddfed` para Raymsandreson: rodar `zapsign-enrich-lead` apontando para o doc `9e02a671` (PDF do Raymsandreson) — ele sobrescreve com os dados certos.
2. Criar lead novo para **ANDRÉIA**: clonar a partir do board original, `lead_phone` = `signer_phone` da ZapSign quando válido (caso contrário deixar do WhatsApp + sufixo), repassar `lead_id` ao doc `cce9482b`, rodar enrich.
3. Idem para **CAROLINE**: novo lead, doc `860d6186` revinculado, enrich.

Tudo via `run-external-migration` + `curl_edge_functions` para o enrich. Lead antigo (`bfaddfed`) NÃO é apagado, só restaurado.

## O que NÃO vai mexer
- Schema das tabelas.
- Lógica de criação de grupos / renomeação.
- `lead-drive` (já funciona).
- Railway `zapsign-webhook.ts` (138 linhas, é só proxy — não decide vínculo).
- Outras funções `zapsign-*` (audit, backfill, bulk-sync).

## Riscos
- Risco baixo: a verificação de `signer_token` é defensiva — se a query falhar, mantém comportamento atual (vincula). Não quebra fluxos onde só há 1 signatário.
- Risco médio na correção de dados: se algum signer_phone vier vazio (ex.: Andréia/Caroline têm `signer_phone="55"`), o lead novo nasce com `lead_phone` igual ao do Raymsandreson + sufixo `-2/-3` para não colidir UNIQUE (se houver). Conferir constraint antes.

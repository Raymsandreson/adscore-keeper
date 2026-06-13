---
name: code-reusables-map
description: Antes de criar edge function nova, hook, RPC, webhook, processador, integração WhatsApp/ZapSign/Meta/IA, ou qualquer lógica que pareça "já vi isso em algum lugar". Anti-duplicação de CÓDIGO (irmã da db-tables-map, que cuida de tabelas).
---

# Mapa de Funções — Anti-Duplicação de Código

Metáfora: antes de contratar funcionário novo, olha se já tem alguém na firma que faz aquilo. Esta skill é o organograma.

## Regra dura — em DUAS etapas

PROIBIDO propor edge function nova, hook novo, ou novo "processador" SEM antes:

1. **Etapa 1 — Existe?** Rodar `scripts/find-function.sh <palavra-chave>` para listar nomes de funções/hooks que batem.
2. **Etapa 2 — O que faz, de verdade?** Para cada candidato, rodar `scripts/describe-function.sh <nome>` e LER o cabeçalho. Nome de função engana — só o código mostra a verdade.
3. Citar no plano: *"rodei describe-function em X e Y. X só faz proxy pro Externo, Y é o que tem lógica. Vou estender Y."* OU *"não existe — vou criar novo."*

Pulou as etapas = violou a skill. (Eu mesmo violei na criação dessa skill — escrevi descrições por palpite. Não repita.)

## Onde mora cada coisa

```
railway-server/src/functions/   → webhooks pesados, processadores HTTP (PADRÃO de código novo)
supabase/functions/             → funções Cloud. MAJORITARIAMENTE proxies pra Externo OU código legado
src/hooks/use*.ts               → leitura/escrita de dados no front (sempre via `db`/`authClient`)
src/lib/                        → utilitários puros
```

**Padrão observado:** Muitas funções em `supabase/functions/` são **proxies** que só repassam o request para a função homônima no Externo (`kmedldlepwiityjsdahz`). A lógica real mora no Externo. Sempre confirme com `describe-function.sh` antes de assumir.

## Hot-list — VERIFICADA (lida em 2026-06-13)

Estas eu abri o código e confirmei o que faz. Para o resto, use `describe-function.sh`.

### WhatsApp — envio
- `supabase/send-whatsapp` → **proxy**. Encaminha pro Externo (UazAPI). Se `body.channel === 'cloud'` re-roteia pro Railway `send-whatsapp-cloud` (Meta Cloud API). Lógica real está nos dois destinos.
- `railway/send-whatsapp-cloud.ts` → envia via Cloud API Meta.

### WhatsApp — webhooks (entrada)
- `railway/whatsapp-webhook.ts` → **entrada principal UazAPI**. Tem lógica de proactive first message, geo via DDD, gravação de mídia. **Porta migrada da edge `supabase/functions/whatsapp-webhook`** (provavelmente legada).
- `railway/whatsapp-cloud-webhook.ts` → **entrada Cloud API Meta**. Valida assinatura `X-Hub-Signature-256`, normaliza para `whatsapp_messages` com `instance_name = 'cloud_gerencia'`, faz roteamento round-robin.

### WhatsApp — grupos
- `railway/get-whatsapp-group-info.ts` → busca nome/info de grupo via UazAPI `/group/info`, varre instâncias ativas se a primeira falhar, persiste em `lead_whatsapp_groups`. **Use isto, não chame UazAPI direto.**

### WhatsApp — chamadas de voz
- `railway/call-queue-processor.ts` → roda a cada minuto via pg_cron, pula se chamada ativa nos últimos 2min, pega próxima da fila `whatsapp_call_queue`. Migrado de `supabase/whatsapp-call-queue-processor`.

### WhatsApp — IA / Followup
- `supabase/wjia-agent` → **proxy puro** pro Externo. Lógica real lá.
- `supabase/wjia-followup-processor` → tem lógica local (cron). Lê body `{ session_id, target_phone, target_instance, force_immediate, reset_cycle }`. Roda no Cloud, lê do Externo.

### Leads
- `supabase/auto-enrich-lead` → **proxy** pro Externo.
- `supabase/receive-lead-webhook` → **proxy** pro Externo.
- `railway/regenerate-lead-name.ts` → regera lead_name seguindo `board_group_settings`. Sequência determinística pela posição na fila de fechados (ordenada por `confirmed_at` do checkpoint `setup_lead_close`).

### Conversação → estruturação
- `railway/extract-conversation-data.ts` → extrai lead/contato das últimas mensagens + resumos CallFace. Body: `{ phone, instance_name, targetType, extra_context?, call_summaries? }`. Usa Lovable AI Gateway. **Substitui** a edge Cloud homônima (que era proxy).

### ZapSign
- `railway/zapsign-webhook.ts` → grava raw em `zapsign_document_events`, atualiza `zapsign_documents`. Sempre 200. Resolve contact/lead por variantes de telefone (com/sem DDI, com/sem 9).
- `railway/zapsign-post-sign-extras.ts` → **NÃO executa nada automaticamente**. Apenas REGISTRA 5–7 checkpoints (`confirm_funnel`, `setup_lead_close`, `create_group`, `send_initial_message`, `import_docs`, `create_case_process`, `create_onboarding_activity`) como `pending` em `onboarding_checkpoints`. Modal bloqueante no frontend é quem dispara cada passo. (Histórico: antes criava grupo+docs em paralelo, causava duplicação. Migrado em 2026-05-07.)

### Infra
- `supabase/run-external-migration` → roda SQL no Externo. Body `{ sql }` (string ou array). Tenta `EXTERNAL_DB_URL` direto, fallback REST. **Única via oficial** pra mudar schema do Externo.
- `supabase/deploy-to-external` → deploya edge function no Externo via Management API. Body `{ slug, code, verify_jwt? }`. Usa `EXTERNAL_SUPABASE_ACCESS_TOKEN`.

## Lista de candidatos NÃO verificados ainda

**Tratamento:** antes de reutilizar QUALQUER um destes, rode `describe-function.sh <nome>`. Não assuma pelo nome.

### Railway (`railway-server/src/functions/`)
`check-whatsapp-cloud-token`, `get-pending-review`, `gmail-inss-sync`, `lead-close-sequence-info`, `list-uazapi-labels`, `manage-uazapi-label`, `manage-whatsapp-group-participants`, `meta-call-queue-processor`, `notify-inss-update`, `onboarding-checkpoint-execute`, `onboarding-checkpoint-reprocess`, `prepare-label-document-trigger`, `repair-whatsapp-group`, `sheet-lead-ingest`, `submit-document-review`, `sync-agent-labels`, `sync-result-labels`, `whatsapp-backfill-media`, `whatsapp-cloud-webhook`, `whatsapp-download-media`, `whatsapp-group-exit`.

### Supabase (`supabase/functions/`) — 191 funções
Categorias frequentes (muitas são proxies, confirme):
- **Sugestões IA:** família `suggest-*` (next-step, message-template, activity-type, best-agent, routine, career-plan, goals, cost-organization, search-keywords, product-fields).
- **ZapSign:** `zapsign-*` (webhook, enrich-lead, enrich-from-detail, audit, api, backfill-*, bulk-sync).
- **Migração:** `migrate-*`, `bridge-*`, `migration-orchestrator`, `migration-validate`.
- **Meta/Marketing:** `create-meta-campaign`, `campaign-ai-assistant`, `monitor-campaign-status`, `sync-instagram-metrics`, `search-instagram-*`, `post-instagram-reply`, `extract-news-comments`, `n8n-comment-webhook`.
- **Legal:** `analyze-legal-viability`, `analyze-petition`, `extract-pdf-process-tracking`, `check-process-movements`, `search-oab-lawyer`, `search-escavador`, `classify-document`.
- **Voz/IA:** `elevenlabs-tts`, `elevenlabs-sts`, `elevenlabs-voice-clone`, `ai-text-editor`, `parse-knowledge-document`, `parse-activity-dictation`, `analyze-activity-chat`.
- **Equipe/Auth:** `send-team-invitation`, `bulk-create-users`, `create-cloud-user`, `send-password-reset`, `sync-auth-cloud-to-external`, `sync-user-to-external`, `sync-new-user-mapping`, `notify-activity-created`, `notify-team-mention`, `notify-conversation-share`.
- **Sincronização WA:** `sync-all-whatsapp-groups`, `sync-group-contacts`, `sync-whatsapp-group-description`, `sync-whatsapp-recent`, `monitor-instance-connection`, `reconnect-whatsapp`, `register-whatsapp-instance`, `rename-whatsapp-group`, `repair-whatsapp-group`, `whatsapp-fetch-history`, `whatsapp-bulk-history-sync`, `whatsapp-command-processor`, `whatsapp-handoff-dispatch`, `whatsapp-instance-report`, `whatsapp-ai-agent-reply`.
- **Financeiro:** `pluggy-integration`, `expense-form`, `expense-form-reminders`.
- **Debug/infra:** `db-drift-monitor`, `compute-monitor-snapshots`, `count-external-messages`, `count-external-tables`, `sentry-issues`, `railway-status`, `railway-redeploy`, `audit-uuid-divergence`, `apply-external-perf-indexes`, `debug-*`.

## Hooks-chave (front)

Antes de criar `useXxx` novo, `ls src/hooks/ | grep <palavra>`. Listagem completa não cabe aqui e fica desatualizada — sempre liste.

## Decisão antes de criar

```
Preciso de lógica X?
│
├─ 1. find-function.sh <keyword> → lista candidatos por nome
├─ 2. describe-function.sh <nome> → LÊ o cabeçalho de cada candidato
├─ 3. É só proxy? Vai pra função-destino. É código real? Pode estender.
└─ Nada serve? Cria novo. Vai pro Railway (skill db-railway-routing).
```

## Anti-padrões

- "Vou criar `send-whatsapp-v2`" → NÃO. Estende `send-whatsapp` com parâmetro.
- "Webhook UazAPI paralelo" → NÃO. Adiciona branch em `railway/whatsapp-webhook.ts`.
- "Vou ler do `supabase/functions/X`" sem confirmar que é proxy → leia primeiro. A maioria proxy.
- "Hook `useLeadStuff` novo" → use `useLeads` com filtro.
- Função IA nova → confira família `suggest-*` antes.

## Pós-uso

Quando ler uma função e confirmar o que faz, **mova ela da seção "não verificadas" pra "VERIFICADA" com descrição real** na mesma sessão. Skill viva = skill útil.

## Relação com outras skills

- `db-tables-map` → tabelas/colunas
- `code-reusables-map` (esta) → funções/hooks/processadores
- `db-railway-routing` → onde nasce o código novo

Use as três em qualquer pedido que envolva criar coisa nova.

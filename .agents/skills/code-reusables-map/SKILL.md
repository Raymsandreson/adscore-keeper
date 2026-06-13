---
name: code-reusables-map
description: Antes de criar edge function nova, hook, RPC, webhook, processador, integração WhatsApp/ZapSign/Meta/IA, ou qualquer lógica que pareça "já vi isso em algum lugar". Anti-duplicação de CÓDIGO (irmã da db-tables-map, que cuida de tabelas).
---

# Mapa de Funções — Anti-Duplicação de Código

Metáfora: antes de contratar funcionário novo, olha se já tem alguém na firma que faz aquilo. Esta skill é o organograma.

## Regra dura

PROIBIDO propor edge function nova, hook novo, ou novo "processador/sincronizador/integrador" SEM antes:

1. Rodar `scripts/find-function.sh <palavra-chave>` para varrer Railway + Supabase + hooks
2. Procurar na hot-list abaixo se já existe equivalente
3. Citar no plano: "verifiquei X, Y, Z — não existe equivalente" OU "existe `<nome>`, vou reutilizar/estender"

Pulou esses passos = violou a skill.

## Onde mora cada coisa

```
railway-server/src/functions/   → webhooks pesados, processadores HTTP (PADRÃO de código novo)
supabase/functions/             → funções que PRECISAM rodar dentro do Postgres (trigger, cron, RLS helper)
src/hooks/use*.ts               → leitura/escrita de dados no front (sempre via `db`/`authClient`)
src/lib/                        → utilitários puros (formatters, normalizadores, validators)
```

Decisão: código novo vai pro Railway, salvo exceção justificada. (Ver skill `db-railway-routing`.)

## Hot-list — funções que JÁ resolvem problemas comumente reinventados

### WhatsApp (instâncias, mensagens, grupos)
- **Enviar mensagem WA** → `supabase/functions/send-whatsapp` (não crie sender novo).
- **Webhook UazAPI** → `railway-server/.../whatsapp-webhook.ts` (entrada única; adicione branch, não webhook paralelo).
- **Webhook Cloud API Meta** → `railway-server/.../whatsapp-cloud-webhook.ts`.
- **Buscar histórico de chat** → `supabase/functions/whatsapp-fetch-history` + `useAutoHistoryFetch` (hook).
- **Info de grupo (nome/admins/participantes)** → `railway/get-whatsapp-group-info.ts` + tabela `whatsapp_groups_index`. NÃO chame UazAPI direto.
- **Renomear grupo** → `supabase/functions/rename-whatsapp-group`.
- **Sair/expulsar de grupo** → `railway/whatsapp-group-exit.ts` + `manage-whatsapp-group-participants.ts`.
- **Sync diário de grupos** → `supabase/functions/sync-all-whatsapp-groups` (cron). Não criar varredor novo.
- **Etiquetas UazAPI** → `list-uazapi-labels`, `manage-uazapi-label`, `sync-agent-labels`, `sync-result-labels`.
- **Status/reconectar instância** → `check-whatsapp-status`, `reconnect-whatsapp`, `monitor-instance-connection`.
- **Comandos WA (texto do operador vira ação)** → `whatsapp-command-processor`.
- **Resposta da IA WhatsJUD** → `wjia-agent` + `wjia-followup-processor`.
- **Detecção/fila de chamada** → `railway/call-queue-processor.ts`, `meta-call-queue-processor.ts`, `whatsapp-call-queue-processor`.

### ZapSign / Assinatura
- **Webhook ZapSign** → `railway/zapsign-webhook.ts` (entrada única) + `supabase/zapsign-webhook` (legacy interno).
- **Pós-assinatura (criar grupo, enriquecer, agendar)** → `railway/zapsign-post-sign-extras.ts`. NÃO criar bloco paralelo no Cloud (ver memory `single-group-creation-owner`).
- **Enriquecer lead via doc assinado** → `zapsign-enrich-lead`, `zapsign-enrich-from-detail`.
- **Backfills históricos** → família `zapsign-backfill-*`.

### Leads / CRM
- **Criar lead em massa de campanha** → `bulk-create-leads-from-campaign`.
- **Webhook genérico de lead** → `receive-lead-webhook`.
- **Ingestão de planilha** → `railway/sheet-lead-ingest.ts`.
- **Regenerar nome do lead** → `railway/regenerate-lead-name.ts`.
- **Enriquecer lead automaticamente** → `auto-enrich-lead`.
- **Geocode/localização** → `backfill-lead-geocode`, `extract-location`, `enrich-transactions-location`.
- **Status do lead / fechamento** → `sync-lead-status`, `railway/lead-close-sequence-info.ts`.
- **Atribuir acolhedor pelo dono do grupo** → `backfill-acolhedor-from-group-owner`, `debug-acolhedor-merge`.

### Jurídico
- **Análise de viabilidade** → `analyze-legal-viability`.
- **Análise de petição (PDF)** → `analyze-petition` + `extract-pdf-process-tracking`.
- **Movimentações processuais** → `check-process-movements`.
- **Buscar advogado OAB** → `search-oab-lawyer`, `search-escavador`.

### Meta Ads / Marketing
- **Proxy Meta API** → `useMetaAPI` (hook) — toda chamada Meta passa por aqui.
- **Criar campanha** → `create-meta-campaign` + `campaign-ai-assistant`.
- **Monitorar status** → `monitor-campaign-status` (cron).
- **Alertas de conversão** → `useConversionAlerts`.
- **Sync Instagram** → `sync-instagram-metrics`, `search-instagram-posts`, `post-instagram-reply`.
- **Comentários como ponte** → `extract-news-comments`, `n8n-comment-webhook`.

### IA / LLM
- **Editor de texto IA** → `ai-text-editor`.
- **Sugestões (próximo passo, template, tipo de atividade, agente, rotina, plano de carreira, metas, organização de custos, palavras-chave, campos de produto)** → família `suggest-*`. SEMPRE procure `suggest-<tema>` antes de criar nova função IA.
- **Análise de chat de atividade** → `analyze-activity-chat`.
- **Extração de dados de conversa** → `railway/extract-conversation-data.ts`.
- **Voz (TTS/STS/clone)** → `elevenlabs-tts`, `elevenlabs-sts`, `elevenlabs-voice-clone`.
- **Classificar documento** → `classify-document` + `railway/submit-document-review.ts` + `get-pending-review.ts`.
- **Parse de documento de conhecimento** → `parse-knowledge-document`.
- **Ditado de atividade** → `parse-activity-dictation`.

### Equipe / Notificações
- **Convite de equipe** → `send-team-invitation`, `bulk-create-users`, `create-cloud-user`.
- **Reset de senha** → `send-password-reset`.
- **Notificar atividade/menção/compartilhamento** → `notify-activity-created`, `notify-team-mention`, `notify-conversation-share`.
- **Sync auth Cloud↔Externo** → `sync-auth-cloud-to-external`, `sync-user-to-external`, `sync-new-user-mapping`.

### Financeiro
- **Pluggy (open banking)** → `pluggy-integration`.
- **Form de despesa** → `expense-form` + `expense-form-reminders`.
- **Categorias** → hooks `useExpenseCategories`, `useCostAccounts`, `useCostCenters`, `useAccountCategoryLinks`.

### Infra / Migração / Debug
- **Rodar SQL no Externo** → `run-external-migration` (única via, ver skill `db-railway-routing`).
- **Deploy de função no Externo** → `deploy-to-external`.
- **Drift de schema** → `db-drift-monitor`.
- **Snapshots de monitor** → `compute-monitor-snapshots`.
- **Contar mensagens/tabelas externas** → `count-external-messages`, `count-external-tables`.
- **Sentry** → `sentry-issues`.
- **Railway status/redeploy** → `railway-status`, `railway-redeploy`.

## Hooks-chave (front)

Antes de criar `useXxx` novo, ver se um destes já cobre:

- Leads: `useLeads`, `useLeadActivities`, `useLeadContacts`, `useLeadCustomFields`, `useLeadFollowups`, `useLeadProcesses`, `useLeadStageHistory`, `useLeadFieldLayout`, `useLeadTabLayout`, `useLeadSources`.
- Contatos: `useContacts`, `useContactLeads`, `useContactBridges`, `useContactCustomFields`, `useContactFieldLayout`, `useContactTabLayout`, `useContactProfessions`, `useContactRelationships`, `useContactClassifications`.
- Atividades: `useActivityTypes`, `useActivityLogger`, `useActivityFieldSettings`, `useActivityMessageTemplates`, `useActivityStepContext`.
- WhatsApp/grupo: `useGroupExits`, `useAutoImportGroupDocs`, `useAutoLinkGroupByName`, `useInstancePermissionsWatcher`, `useIncomingCallDetector`.
- Kanban/Cards: `useKanbanBoards`, `useCardFieldsSettings`, `useCardPermissions`.
- Métricas/metas: `useAggregatedMetrics`, `useMetricDefinitions`, `useMetricAlerts`, `useGoalNotifications`, `useFocusDashboardData`.
- Permissões/auth: `useAuth`, `useExternalUserId`.
- Meta/Anúncios: `useMetaAPI`, `useMetaAdAccounts`, `useCampaignManager`, `useAdBriefings`, `useAdSetGeoRules`, `useConversionAlerts`.

Lista completa: `ls src/hooks/`. Sempre rode antes de criar `useNovaCoisa`.

## Decisão antes de criar

```
Preciso de lógica X?
│
├─ Existe edge function com nome parecido? (rode find-function.sh)
│   ├─ SIM → leia, vê se cabe um parâmetro novo / branch novo
│   └─ NÃO → próxima etapa
│
├─ Existe hook com mesmo domínio?
│   └─ SIM → estende; NÃO → próxima etapa
│
├─ É variação de algo da hot-list?
│   └─ SIM → reutiliza/estende
│
└─ Só agora: cria nova. Vai pro Railway (skill db-railway-routing).
```

## Anti-padrões

- "Vou criar `send-whatsapp-v2`" → NÃO. Estende `send-whatsapp` com parâmetro.
- "Webhook UazAPI paralelo pra meu caso específico" → NÃO. Adiciona branch em `whatsapp-webhook`.
- "Hook `useLeadStuff` novo pra ler leads filtrados" → NÃO. Usa `useLeads` com filtro/select.
- "Cron novo pra varrer grupos" → NÃO. Já tem `sync-all-whatsapp-groups`.
- "Função IA `suggest-novo-tema`" → talvez. Primeiro confira se algum `suggest-*` existente já faz com prompt diferente.

## Pós-uso

Quando descobrir/criar função reutilizável que não está aqui, **atualize esta hot-list na mesma sessão**. Skill viva = skill útil. Mesma regra da `db-tables-map`.

## Relação com outras skills

- `db-tables-map` cuida de **tabelas/colunas**.
- `code-reusables-map` (esta) cuida de **funções/hooks/processadores**.
- `db-railway-routing` decide **onde** o código novo nasce.

Use as três juntas em qualquer pedido que envolva criar coisa nova.

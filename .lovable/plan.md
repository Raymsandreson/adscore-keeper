
# Migração Total: Lovable Cloud → Supabase Externo

## Resumo em 1 minuto

Hoje você tem 2 backends rodando ao mesmo tempo: Lovable Cloud (`gliigkupoebmlbwyvijp`) e seu Supabase externo (`kmedldlepwiityjsdahz`). Vamos **eliminar o Cloud completamente**. Tudo (banco, login, funções, arquivos, secrets) passa pro seu Supabase.

**Premissas confirmadas:**
- Exportar dados de Cloud → importar em Externo
- Migrar usuários (login preservado)
- IA via `GOOGLE_AI_API_KEY` direto (sem `LOVABLE_API_KEY`)
- Deploy via **GitHub Actions** automático ao salvar
- Railway mantido (só ajusta URLs)

**Tempo estimado:** 6–10h de trabalho, divididas em 7 fases. Janela recomendada: noite/madrugada (login vai cair pra todo mundo durante a fase 5).

---

## Fix Global vs Função-por-função

### 🟢 FIX GLOBAL (4 arquivos arrumam quase tudo)

| Arquivo | O que muda |
|---|---|
| `src/integrations/supabase/client.ts` | Aponta pra URL/key do Externo. **Frontend inteiro segue.** |
| `src/lib/functionRouter.ts` | `CLOUD_URL`/`CLOUD_ANON_KEY` viram do Externo. **Todas as chamadas de função do navegador seguem.** |
| `supabase/functions/_shared/supabase-url-resolver.ts` | Remove fallback pro Cloud, usa só Externo. **Todas as ~100 edge functions param de gravar no Cloud.** |
| `supabase/functions/_shared/supabase-client.ts` | Mesma lógica do resolver. |

### 🟡 FUNÇÃO-POR-FUNÇÃO (não tem atalho)

1. **Deploy de cada edge function pro Externo** — feito automaticamente pelo GitHub Actions depois do setup.
2. **Trocar `ai.gateway.lovable.dev` → Google Gemini direto** em cada função de IA (~30 funções). Vamos criar um helper `_shared/ai-gemini.ts` pra reduzir trabalho.
3. **Trocar `lovable.dev` ElevenLabs → ElevenLabs direto** (~5 funções de voz).
4. **Deletar stubs proxy** que só repassavam Cloud→Externo: `fetch-facebook-leads`, `whatsapp-ai-agent-reply`, `trigger-whatsapp-notifications`, etc.
5. **Recriar cron jobs** no Externo (`pg_cron`) apontando pras URLs novas (ex: `wjia-followup-processor`, `cleanup_old_webhook_logs`).
6. **Recriar storage buckets** no Externo + copiar arquivos: `whatsapp-media`, `activity-attachments`, `activity-chat`, `team-chat-media`, `ad-creatives`, `invoices`, `agent-knowledge`.
7. **Re-cadastrar ~35 secrets** no painel do Externo.

---

## Fase 1 — Inventário e Backup (1h, sem risco)

**Objetivo:** garantir que você tem cópia de tudo antes de mexer.

1. Listar tabelas em Cloud vs Externo (algumas já existem em ambos).
2. Exportar todas as tabelas do Cloud que **não existem** no Externo (CSV).
3. Exportar `auth.users` do Cloud (via `pg_dump` da `auth` schema, ou tool de migração de usuários do Supabase).
4. Listar todos os arquivos de cada bucket no Cloud (pra saber o que copiar).
5. Snapshot de todas as secrets (nome + onde a chave original mora — não precisa do valor, só pra você saber o que re-cadastrar).
6. Snapshot de todos os cron jobs ativos no Cloud (`SELECT * FROM cron.job`).

**Entregável:** pasta `/mnt/documents/migration-backup/` com tudo.

---

## Fase 2 — Schema no Externo (1–2h)

1. Conferir quais migrations de `supabase/migrations/` ainda **não foram aplicadas** no Externo.
2. Aplicar as faltantes via Supabase CLI (`supabase db push --db-url <externo>`).
3. Recriar funções/triggers críticos no Externo (lista das 50+ funções já mapeadas em `<db-functions>`).
4. Recriar buckets de storage (1 SQL por bucket, com mesma config de público/privado).
5. Validar com `\d` em cada tabela crítica que estrutura bate.

**Risco:** baixo. Banco Externo já tem maioria das tabelas (você vem usando ele). Vamos só "completar".

---

## Fase 3 — Importar Dados (1–2h)

1. Importar CSVs da Fase 1 nas tabelas correspondentes no Externo (`COPY FROM`).
2. Copiar arquivos de storage Cloud → Externo via script (Supabase Storage API: download de A, upload em B).
3. **Mensagens dos últimos 7 dias** (incluindo as 943 de hoje que estavam erradamente em Cloud) — copiar `whatsapp_messages` Cloud → Externo, com deduplicação por `message_id`.

---

## Fase 4 — Secrets no Externo (30min)

Você cadastra manualmente no painel do Supabase Externo (Project Settings → Edge Functions → Secrets) as ~35 secrets:

**Críticas (sem isso nada funciona):**
`GOOGLE_AI_API_KEY`, `ELEVENLABS_API_KEY`, `ZAPSIGN_API_TOKEN`, `META_ACCESS_TOKEN`, `FACEBOOK_PAGE_TOKEN`, `FACEBOOK_PIXEL_ID`, `FACEBOOK_CAPI_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `ESCAVADOR_API_TOKEN`, `MANYCHAT_API_KEY`, `APIFY_API_KEY`, `RESEND_API_KEY`, `RAILWAY_API_KEY`, `CALLFACE_REGISTER_TOKEN`, `N8N_WHATSAPP_WEBHOOK_URL`.

**Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_CALLER_ID`.

**Google:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_KEY`.

**Pluggy:** `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`.

**Outras:** `FIRECRAWL_API_KEY`, `SENTRY_AUTH_TOKEN`.

**Removidas (não vão mais existir):** `LOVABLE_API_KEY`, `EXTERNAL_SUPABASE_URL`, `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (vira só `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` no Externo).

---

## Fase 5 — Migração de Auth (1h, JANELA DE DOWNTIME)

⚠️ **Aqui é o único momento que algo "para".** Avisar usuários antes.

1. Exportar `auth.users` + `auth.identities` do Cloud (Supabase tem ferramenta `supabase auth export`).
2. Importar no Externo (`supabase auth import`). Senhas hashadas são preservadas.
3. Atualizar `supabase/config.toml` se houver provider OAuth (Google) — recadastrar redirect URLs no console do Google apontando pro Externo.
4. Validar: logar com 1 usuário de teste no novo backend.

**Risco:** se algo der errado, sessões ficam quebradas até reverter. Rollback = reverter Fase 6 (apontar `client.ts` de volta pro Cloud).

---

## Fase 6 — Os 4 Fixes Globais (30min)

Editar literalmente 4 arquivos:

**6.1** `src/integrations/supabase/client.ts` — `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` passam a ser do Externo. Como o `.env` do Lovable não pode ser editado, vou colocar **fallback hardcoded** no client apontando pro Externo (URL pública + anon key são públicas, sem risco).

**6.2** `src/lib/functionRouter.ts` — `CLOUD_URL` e `CLOUD_ANON_KEY` viram do Externo.

**6.3** `supabase/functions/_shared/supabase-url-resolver.ts` — inverte prioridade: usa `EXTERNAL_SUPABASE_URL` primeiro (na verdade já vai virar `SUPABASE_URL` no novo ambiente).

**6.4** `supabase/functions/_shared/supabase-client.ts` — idem.

**Rollback:** reverter os 4 arquivos via git restore. Volta tudo pra Cloud em 1 minuto.

---

## Fase 7 — GitHub Actions + Deploy de todas as funções (2–3h)

### 7.1 Setup do GitHub Actions

1. Conectar projeto Lovable ao GitHub (Connectors → GitHub → Create Repository) — se ainda não estiver.
2. Criar `SUPABASE_ACCESS_TOKEN` no painel do Supabase Externo (Account → Access Tokens). Adicionar como **GitHub Secret** no repo.
3. Criar `.github/workflows/deploy-functions.yml` que, a cada push em `main`, roda:
   ```yaml
   - supabase functions deploy --project-ref kmedldlepwiityjsdahz
   ```
   (Deploya **só as funções alteradas** pra ser rápido.)

### 7.2 Refactor de IA (helper compartilhado)

Criar `supabase/functions/_shared/ai-gemini.ts` que abstrai chamada ao Gemini. Substituir em ~30 funções:
- De: `fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { headers: { Authorization: 'Bearer ' + LOVABLE_API_KEY }})`
- Para: `callGemini({ model: 'gemini-2.5-flash', prompt, ... })` usando `GOOGLE_AI_API_KEY`.

### 7.3 Refactor de voz

`_shared/elevenlabs.ts` → API direta da ElevenLabs com `ELEVENLABS_API_KEY`.

### 7.4 Deletar funções obsoletas

- Stubs proxy: `fetch-facebook-leads`, `whatsapp-ai-agent-reply`, `trigger-whatsapp-notifications`, `whatsapp-call-queue-processor` (este já é stub legacy).
- Funções `sync-user-to-external` e similares (não fazem mais sentido — não tem 2 bancos).

### 7.5 Recriar cron jobs no Externo

Migration nova com:
```sql
SELECT cron.schedule('wjia-followup', '*/1 * * * *', $$
  SELECT net.http_post(
    url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/wjia-followup-processor',
    headers := '{"Authorization": "Bearer <ANON>"}',
    body := '{}'
  )
$$);
-- + outros: cleanup_old_webhook_logs, cleanup_old_whatsapp_messages, etc.
```

### 7.6 Atualizar Railway

Em `railway-server/.env`, trocar `EXTERNAL_SUPABASE_URL` para o do Externo (provavelmente já está). Confirmar que webhooks da UazAPI/Meta apontam pra Railway, e Railway proxya pro Externo. Sem mudança grande.

---

## Fase 8 — Limpeza e Validação (1h)

1. Confirmar que **nenhuma escrita** chega mais em Cloud (`SELECT count(*) FROM whatsapp_messages WHERE created_at > now() - interval '10 min'` → 0).
2. Smoke test: enviar 1 mensagem WhatsApp, criar 1 lead, fechar 1 caso, gerar 1 ZapSign, fazer 1 chamada de IA.
3. Atualizar memórias do projeto: remover toda menção a "Lovable Cloud", "dual client", "hybrid persistence". Substituir por "Supabase único".
4. Em **Lovable → Connectors → Lovable Cloud → Disable Cloud** (irreversível, faz por último).
5. Apagar pasta `mem://infrastructure/supabase/hybrid-routing-persistence-policy.md` e similares.

---

## O que pode dar errado e como reverter

| Risco | Probabilidade | Rollback |
|---|---|---|
| Login quebra após Fase 5 | Média | `client.ts` volta pra Cloud (5min) |
| Edge function não deploya | Baixa | GitHub Actions mostra log; corrige e re-pusha |
| Cron job não roda | Média | Reagendar manualmente; cron jobs são fáceis de testar |
| IA Gemini com formato diferente do gateway Lovable | Alta | Helper compartilhado isola; ajusta uma vez, vale pra todas |
| Arquivos de storage faltando | Média | Re-rodar script de cópia (idempotente) |
| `LOVABLE_API_KEY` ainda usado em algum canto não mapeado | Baixa | Grep global antes de desligar Cloud |

---

## Pré-requisitos antes de eu começar

1. **Você confirma:** projeto Lovable está conectado ao GitHub? (Senão, fazer agora.)
2. **Você gera:** `SUPABASE_ACCESS_TOKEN` no painel do Supabase Externo e me passa pra adicionar nos GitHub Secrets (ou adiciona você mesmo).
3. **Você confirma:** posso fazer a Fase 5 (migração de auth) numa janela específica? Sugiro **avisar com 24h de antecedência** porque login cai por ~30min.
4. **Janela total:** prefere fazer tudo de uma vez (1 dia) ou em 3 sessões (Fase 1–4 num dia, Fase 5–6 em outro, Fase 7–8 em outro)?

---

## Aprovação

Se aprovar, começo pela **Fase 1 (Inventário e Backup)** — totalmente sem risco, só leitura. Aí você decide quando seguir pra Fase 2.


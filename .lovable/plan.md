

# Diagnóstico do erro e plano para verificar deploys sem abrir a UI

## O erro que você viu

```
/orchestrator.BuildService/StartSnapshotAndBuild UNKNOWN:
failed to get temporal client: dial tcp 10.10.10.50:7233: cannot assign requested address
```

Isso é falha **interna da infra de build da Lovable** (serviço Temporal não acessível durante o snapshot do build). **Não é** problema do seu código, nem do Railway, nem do GitHub. Ação correta: clicar **Publish** de novo após alguns minutos. Se persistir por >30min, é incidente da Lovable.

## Sua pergunta real: como confirmar deploy sem abrir a UI toda vez

Hoje você tem **3 alvos de deploy diferentes**, cada um com forma própria de verificar:

| Alvo | Onde mora | Como o deploy acontece hoje |
|---|---|---|
| **Frontend (Lovable)** | `.lovable.app` | Botão Publish na UI da Lovable |
| **Edge Functions (Lovable Cloud)** | `gliigkupoebmlbwyvijp.supabase.co/functions/v1/*` | Auto-deploy a cada edição |
| **Railway server** (`whatsapp-webhook`, `call-queue-processor`) | `*.up.railway.app` | Push no GitHub → Railway auto-builda |

GitHub não te diz se o Railway buildou — só diz que o commit chegou no repo. E a Lovable UI é o único lugar oficial pra ver o status do Publish do frontend.

## Plano: criar 3 verificadores HTTP (zero UI)

Tudo via `curl` no terminal ou um script único. Sem mexer em código de produção.

### 1) Frontend Lovable — verificar versão publicada

Adicionar no `index.html` uma `<meta name="build-sha" content="...">` populada no build pelo Vite a partir de `import.meta.env.VITE_BUILD_SHA` (ou timestamp). Aí:

```bash
curl -s https://adscore-keeper.lovable.app/ | grep build-sha
```

Compara com o commit local: se o SHA bate, o Publish foi pra produção. Se não bate, ainda não rodou ou falhou.

**Arquivos**: `index.html` (1 linha de meta), `vite.config.ts` (injetar `VITE_BUILD_SHA` via `define` lendo `process.env.VERCEL_GIT_COMMIT_SHA || git rev-parse HEAD`).

### 2) Railway server — endpoint `/version`

Já existe `/health` no `railway-server/src/index.ts`. Estender pra retornar:

```json
{
  "status": "ok",
  "commit": "abc1234",
  "deployed_at": "2026-04-23T14:00:00Z",
  "functions": [...]
}
```

Railway expõe `RAILWAY_GIT_COMMIT_SHA` e `RAILWAY_DEPLOYMENT_ID` como env vars automaticamente. Basta lê-las no handler.

```bash
curl -s https://SEU-APP.up.railway.app/health | jq .commit
```

**Arquivos**: `railway-server/src/index.ts` (estender o handler `/health` existente, ~5 linhas).

### 3) Edge Functions Lovable — ping com versão

Criar **uma** edge function read-only `_status` que retorna `{ deployed_at, functions: [...] }`. Como edge functions auto-deployam, não tem SHA do git, mas dá pra pôr `Date.now()` no build (a Lovable rebuilda a função a cada edit). Útil pra confirmar "a última edição da função X chegou".

**Opcional** — só vale a pena se você frequentemente duvida se uma edge subiu.

### 4) Script único `scripts/check-deploys.sh`

Um shell que roda os 3 curls em paralelo e printa uma tabela:

```
Frontend  ✅  abc1234 (igual ao HEAD local)
Railway   ✅  abc1234 (igual ao HEAD local)
Edge Fns  ✅  deployed 2min atrás
```

Você roda `bash scripts/check-deploys.sh` depois de cada Publish. 5 segundos.

## O que NÃO vou mexer

- Nada em `src/integrations/supabase/*`
- Nada em migrations
- Nada nos handlers de webhook, IA, follow-up
- Nada na lógica de negócio
- Nada que mude comportamento do app — só **observabilidade de deploy**

## Rollback

Tudo é aditivo (meta tag, endpoint `/health` estendido, script novo). Reverter = deletar os arquivos. Zero risco em prod.

## O que preciso decidir com você

1. **Quais dos 3 verificadores quer?** Recomendo **1 + 2** (frontend + Railway). O #3 (edge functions) só se você sente que elas falham silenciosamente.
2. **GitHub Actions opcional**: posso adicionar um workflow `.github/workflows/post-deploy-check.yml` que roda o script automaticamente após cada push e te avisa por email/Discord se algo não bateu em 5min. Quer? (Requer só o script do passo 4.)

Responde **"vai com 1+2"**, **"vai com 1+2+3"**, ou **"adiciona o GitHub Action também"** que eu executo na próxima rodada.


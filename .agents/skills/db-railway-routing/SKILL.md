---
name: db-railway-routing
description: Use SEMPRE que a tarefa envolver criar/alterar tabela, coluna, RLS, trigger, função SQL, edge function, webhook, cron, ou qualquer código que persista/leia dados de negócio. Garante que tudo novo vá para o Supabase Externo (dados) e Railway (funções/webhooks), e nunca para o Lovable Cloud (que está congelado para dados de negócio). Acione ao ouvir "criar tabela", "nova função", "edge function", "webhook", "migration", "salvar no banco", "trigger", "cron", "RPC", "Supabase".
---

# Roteamento — Externo + Railway, nunca Cloud

Metáfora: o Cloud é o **arquivo morto da empresa** (só guarda crachá e identidade). O Externo é o **almoxarifado** (onde vivem os dados de verdade). O Railway é a **equipe de atendimento** (quem responde os pedidos pesados). Pôr dado novo no Cloud é como guardar mercadoria no arquivo morto — some.

## Regra dura (sem exceção)

| O quê | Onde vai | Onde NÃO vai |
|---|---|---|
| Tabela nova de negócio (lead, contato, mensagem, processo, financeiro, métrica, agente, grupo, etc.) | **Externo** via `run-external-migration` | Cloud |
| Coluna nova em tabela de negócio | **Externo** | Cloud |
| Trigger / função SQL / pg_cron | **Externo** (precisa rodar no Postgres) | Cloud |
| Edge function nova (webhook, processador, API) | **Railway** (`railway-server/src/functions/<name>.ts` + registrar em `index.ts` + `functionRouter.ts`) | Cloud, Externo |
| Migração só se exigir trigger/cron | Externo | Railway |
| Auth, profiles, user_roles, access_profiles, member_module_permissions, whatsapp_instance_users | **Cloud** (única exceção) | Externo |

## Antes de executar — checklist obrigatório

1. **É dado de negócio?** Se sim → Externo. Sem discussão.
2. **Já existe tabela equivalente?** Rode a skill `db-tables-map` primeiro. Não duplique.
3. **É código rodando em request HTTP?** Railway.
   - Cria arquivo em `railway-server/src/functions/<name>.ts`
   - Importa e adiciona rota em `railway-server/src/index.ts`
   - Adiciona `'<name>': 'railway'` em `src/lib/functionRouter.ts`
4. **Precisa rodar DENTRO do Postgres** (trigger, pg_cron, função usada em RLS)? Aí sim, edge function no Externo via Management API (eu mesmo deploy, nunca peço pro usuário colar código).
5. **Em código novo no front**, sempre `import { db, authClient } from '@/integrations/supabase'`. Nunca `supabase` direto.

## Como rodar SQL no Externo

NUNCA pedir pro usuário rodar manual. Usar:

```ts
await cloudFunctions.invoke('run-external-migration', { body: { sql: '...' } })
```

Ou via curl com `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` para o endpoint da função.

## Como deployar edge function no Externo

Quando MESMO precisar (trigger/cron):
1. Baixar via Management API: `GET /functions/{slug}/body` (ESZIP) com `EXTERNAL_SUPABASE_ACCESS_TOKEN`
2. Editar local
3. `POST /functions/deploy?slug=<name>`

Nunca direcionar o usuário ao painel.

## Padrão de edge function Railway

```ts
// railway-server/src/functions/<name>.ts
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase'; // já aponta pro Externo

export const handler: RequestHandler = async (req, res) => {
  try {
    const { foo } = req.body || {};
    if (!foo) return res.json({ success: false, error: 'foo obrigatório' });
    // ... lógica ...
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.json({ success: false, error: err?.message || 'unknown' });
  }
};
```

Sempre HTTP 200 com `{ success, error? }` — nunca 4xx/5xx para regra de negócio.

## Como CHAMAR uma função do Railway (12/08/2026)

`/functions/*` tem middleware de autenticação (`railway-server/src/lib/functionAuth.ts`).
Hoje ele roda em **modo observação** — loga e deixa passar, com o placar em
`/health.auth.observado`. Quando `RAILWAY_AUTH_ENFORCE=1` for ligado, quem
chegar sem credencial toma 401. Só há duas formas certas de chamar:

**Do front** — sempre `cloudFunctions.invoke`, nunca `fetch` cru:

```ts
import { cloudFunctions } from '@/lib/functionRouter';
const { data, error } = await cloudFunctions.invoke<any>('minha-funcao', { body: { ... } });
if (error) throw error;
```

Ele injeta o JWT da sessão do Cloud sozinho. E **registre a rota** em
`FUNCTION_ROUTES` (`'minha-funcao': 'railway'`) — o default é `'cloud'`, onde
não existe handler, então função ausente do mapa falha calada.

Nunca montar `fetch(\`${RAILWAY_BASE}/functions/...\`)` com
`x-api-key: VITE_RAILWAY_API_KEY`: essa env **nunca teve valor**. Eram 12
chamadas anônimas em 3 componentes até 12/08/2026.

**De dentro do próprio Railway** (uma função chamando outra) — `lib/selfCall`:

```ts
import { selfPost, selfUrl, selfHeaders } from '../lib/selfCall';
selfPost('notify-inss-update', { process_id: id }).catch(() => {});
```

Vai por loopback `127.0.0.1` e autentica com o `LOOPBACK_TOKEN` — um
`randomUUID()` gerado no boot, checado **antes** de tudo em
`authorizeFunctionRequest`. Não depende de nenhum segredo configurado.
O padrão antigo (`RAILWAY_PUBLIC_URL` + `x-api-key` vazio) dava uma volta pela
internet pública e, com enforce ligado, morreria em 401 — calado, porque todos
os seis eram fire-and-forget com `.catch(() => {})`.

Onde o handler já tem autorização própria (ex.: o nonce de
`onboarding-checkpoint-execute`), ela **continua**: nonce é a camada do handler,
`x-internal-key` é a do middleware. São distintas, ambas necessárias.

**Lição de método:** o placar de `/health` só enxerga quem dispara na janela
observada. Ele mostrava 2 chamadores anônimos; a varredura da árvore achou 18.
Botão de admin e cron diário não aparecem no contador — enumere, não espere.

## Armadilha de tipo no `railway-server` (`res.json()` é `unknown`)

O `railway-server/tsconfig.json` compila com `"lib": ["ES2020"]` — **sem DOM**.
O `fetch` vem do `@types/node`, e lá `res.json()` devolve `unknown`, não `any`.
Qualquer `(await res.json()).campo` vira `error TS2339: Property 'campo' does
not exist on type 'unknown'` e **quebra o build** — ou seja, quebra o deploy.

Sempre anote o retorno:

```ts
const data: any = await res.json().catch(() => null);            // em variável
async function fetchX(...): Promise<any> { return res.json(); }  // em função
```

Cuidado ao validar: compilar o arquivo avulso com `--lib ES2020,DOM` **esconde
esse erro**, porque no DOM `json()` retorna `any`. Se não der para rodar
`npm run build` dentro de `railway-server/`, reproduza as condições reais —
`--lib ES2020` e um stub de `fetch` cujo `json()` devolva `unknown` — e confirme
que o harness acusa o erro antes de confiar que ele passa.

## Como o Railway sobe (deploy automático a partir de `main`)

Não existe passo manual de deploy do Railway. O projeto `WhatsJud` / ambiente
`production` está ligado ao GitHub e **deploya sozinho a cada commit que chega
em `main`** — o painel mostra cada deploy como "via GitHub", um por commit de
`main`, e o anterior vira `REMOVED`.

Consequência prática, e é o erro fácil de cometer:

- Push em branch de feature **não** deploya. O código só entra no ar quando a
  branch é mergeada em `main`.
- Portanto, quando terminar uma função no `railway-server/`, o trabalho não
  acaba no push: ou o merge em `main` acontece, ou nada mudou em produção.
- Não peça ao usuário para "rodar o deploy", nem invoque `railway-redeploy`
  para publicar código novo — basta o merge. (`railway-redeploy` serve para
  reiniciar o serviço com o mesmo código, não para publicar commit novo.)

Verificar de qual commit é o deploy ativo: o título do deploy ACTIVE no painel
é a primeira linha do commit no topo de `origin/main`.

## Anti-padrões — recusar e corrigir

- "Vou criar tabela no Cloud" → NÃO. Externo.
- "Faz uma edge function no `supabase/functions/`" → NÃO (a menos que precise de trigger/cron). Railway.
- "Roda esse SQL no painel do Supabase" → NÃO. `run-external-migration`.
- `import { supabase } from '@/integrations/supabase/client'` em arquivo novo → NÃO. Use o barrel `db`/`authClient`.
- Dashboard lendo do Cloud → NÃO. Métricas leem do Externo (`db`).

## Pós-uso

Se criar tabela/função nova, atualize a skill `db-tables-map` (`references/known-reusables.md`) na mesma sessão. Skill viva = skill útil.

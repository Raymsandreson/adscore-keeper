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

## Anti-padrões — recusar e corrigir

- "Vou criar tabela no Cloud" → NÃO. Externo.
- "Faz uma edge function no `supabase/functions/`" → NÃO (a menos que precise de trigger/cron). Railway.
- "Roda esse SQL no painel do Supabase" → NÃO. `run-external-migration`.
- `import { supabase } from '@/integrations/supabase/client'` em arquivo novo → NÃO. Use o barrel `db`/`authClient`.
- Dashboard lendo do Cloud → NÃO. Métricas leem do Externo (`db`).

## Pós-uso

Se criar tabela/função nova, atualize a skill `db-tables-map` (`references/known-reusables.md`) na mesma sessão. Skill viva = skill útil.

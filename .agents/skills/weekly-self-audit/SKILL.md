---
name: weekly-self-audit
description: Ritual de manutenção semanal do AdScore Keeper / WhatsJUD. Dispara quando o usuário pedir "roda manutenção", "auditoria semanal", "self-audit", "checa o sistema", "varredura geral" ou frases equivalentes. Spawn 5 sub-agentes paralelos (dados, código, segurança, performance, erros) e consolida em um relatório único com prioridades.
---

# Weekly Self-Audit — AdScore Keeper

Quando disparar este ritual:
- "roda manutenção", "manutenção semanal", "auditoria", "self-audit"
- "como tá o sistema", "varredura geral", "check-up"
- "o que precisa arrumar essa semana"

## Como executar

**SEMPRE em paralelo.** Spawn os 5 sub-agentes na MESMA chamada (um único bloco `<function_calls>` com 5 `spawn_agent`). Nunca sequencial.

### Sub-agente 1 — Auditoria de dados (capable)
**Task:** Auditar integridade de dados de negócio no Supabase Externo (`kmedldlepwiityjsdahz`).
Investigar:
- Leads sem instance_name ou phone normalizado
- Casos sem grupo WA vinculado (após 24h do fechamento)
- Grupos WA com nome divergente do nome do caso
- Processos sem POP atribuído
- Soft-deletes recentes (últimos 7d) sem snapshot
- Duplicatas de contato por phone+instance
Retornar: lista de anomalias com count + 3 IDs de exemplo por categoria.

### Sub-agente 2 — Saúde do código (fast)
**Task:** Varrer `src/` e `supabase/functions/` em busca de:
- Imports de `supabase` direto (deveria ser barrel `db`/`authClient`)
- Edge functions retornando status 4xx/5xx para erro de negócio (deveria ser 200 com `{success:false}`)
- Hooks com `useEffect` sem array de deps
- Componentes >500 linhas (candidatos a quebrar)
- TODOs/FIXMEs com mais de 30 dias (via git blame se possível)
Retornar: arquivo:linha + descrição curta. Máx 20 itens, ordenados por gravidade.

### Sub-agente 3 — Segurança & RLS (capable)
**Task:** Verificar no Supabase Externo e Cloud:
- Tabelas em `public` sem RLS habilitado
- Tabelas sem GRANT explícito após CREATE
- Policies que usam `true` ou expõem dados a `anon` indevidamente
- Edge functions com `verify_jwt = false` sem validação manual de auth
- Secrets vazando em logs recentes (buscar padrões CPF, token, key)
Retornar: severidade (CRÍTICO/ALTO/MÉDIO) + tabela/função + correção sugerida.

### Sub-agente 4 — Performance (fast)
**Task:** Usar `supabase--slow_queries` e analisar:
- Top 10 queries lentas (mean_time > 200ms)
- Tabelas grandes (>100k linhas) sem índice em colunas de filtro frequente
- Edge functions com p95 > 3s (via analytics_query)
- Componentes React renderizando lista >100 itens sem useMemo
Retornar: query/função + tempo + índice ou fix sugerido.

### Sub-agente 5 — Erros & Sentry (fast)
**Task:** Buscar últimos 7 dias:
- Edge function logs com `error`/`exception` (via `supabase--analytics_query`)
- Top 5 erros recorrentes no Sentry (se acessível)
- Webhooks com retry/falha repetida (Railway logs se possível)
Retornar: erro + contagem + função/arquivo + hipótese de causa.

## Consolidação (depois que TODOS voltarem)

Montar relatório único com este formato:

```markdown
# 🔧 Manutenção Semanal — <data>

## 🔥 Crítico (ação imediata)
- [Categoria] descrição + arquivo/ID + fix sugerido

## ⚠️ Alto (essa semana)
...

## 📋 Médio (backlog)
...

## ✅ Saúde geral
- Dados: <N anomalias>
- Código: <N issues>
- Segurança: <N findings>
- Performance: <N queries lentas>
- Erros: <N recorrentes>
```

Ao final, perguntar ao usuário: **"Quer que eu já comece pelos itens 🔥 críticos?"** — nunca corrigir sem aprovação.

## Regras
- Sub-agentes são READ-ONLY. Nenhum aplica fix.
- Se algum sub-agente falhar, reportar no relatório com "⚠️ auditoria X não completou" e seguir com os outros.
- Não inventar números. Se uma categoria não puder ser auditada (falta de acesso), dizer explicitamente.
- Respeitar Regra 1 do projeto: evidência antes de diagnóstico. Cada item do relatório deve citar a fonte (query, arquivo:linha, log).

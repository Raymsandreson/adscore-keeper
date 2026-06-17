---
name: Weekly Self-Audit Ritual
description: Ritual semanal de manutenção via 5 sub-agentes paralelos (dados, código, segurança, performance, erros), consolidado em relatório único. Trigger por "roda manutenção" ou equivalente.
type: feature
---

Skill `weekly-self-audit` formaliza o ritual de manutenção do AdScore Keeper.

Quando o usuário pedir manutenção/auditoria/check-up, disparar 5 `spawn_agent` em paralelo:
1. Dados (Externo) — capable
2. Código (src/ + edge functions) — fast
3. Segurança (RLS, grants, secrets) — capable
4. Performance (slow_queries, índices) — fast
5. Erros (logs últimos 7d) — fast

Consolidar em relatório com prioridades 🔥/⚠️/📋 e perguntar antes de corrigir. Sub-agentes são read-only; nenhum fix automático.

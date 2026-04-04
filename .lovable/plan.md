
# Plano de Refatoração: Sistema de Agentes WhatsApp

## Diagnóstico Atual

| Arquivo | Linhas | Problema |
|---------|--------|----------|
| `wjia-agent/index.ts` | **2.702** | Monolítico — mistura comandos, coleta, geração ZapSign, follow-up, visão, extração |
| `whatsapp-ai-agent-reply/index.ts` | **1.422** | Grande, mas mais focado |
| `_shared/wjia-utils.ts` | **1.313** | Utilidades misturadas — normalização, ZapSign, CEP, sync, proteção de nome |
| `whatsapp-webhook/index.ts` | **2.612** | Webhook monolítico |

**Total do sistema de agentes: ~11.000 linhas** em poucos arquivos sem separação de responsabilidades.

---

## Plano de Refatoração (em fases)

### Fase 1: Decompor `_shared/wjia-utils.ts` em módulos

Criar arquivos especializados no `_shared/`:

| Novo Arquivo | Responsabilidade |
|---|---|
| `_shared/field-utils.ts` | `normalizeFieldKey`, `normalizeIncomingField`, `resolveTemplateVariable`, `upsertCollectedField`, `computeMissingFields`, `getFieldLabel`, `shouldProtectName`, `syncNameFields` |
| `_shared/zapsign-utils.ts` | `generateZapSignDocument`, `updateSignerSettings`, `applyZapSignSettings`, `filterOnlyAutoFilledData`, constantes ZapSign |
| `_shared/autofill-utils.ts` | `applyDefaults`, `autoFillDates`, `autoSyncCityState`, `autoFillFromCEP`, `applyConfiguredPredefinedFields`, `lookupCEP` |
| `_shared/whatsapp-utils.ts` | `sendWhatsApp`, `getEvolutionInstance`, constantes de envio |
| `_shared/wjia-utils.ts` | Re-export tudo (manter compatibilidade) |

### Fase 2: Decompor `wjia-agent/index.ts` em handlers

| Novo Arquivo | Responsabilidade |
|---|---|
| `wjia-agent/handlers/new-command.ts` | `handleNewCommand` — processar #comando novo |
| `wjia-agent/handlers/follow-up.ts` | `handleFollowUp` — processar mensagem de follow-up em sessão ativa |
| `wjia-agent/handlers/regenerate.ts` | Handler de regeneração de documento |
| `wjia-agent/handlers/collection-ai.ts` | Lógica de IA para coleta de dados (prompt, tools, processamento) |
| `wjia-agent/index.ts` | Apenas roteamento — receber request, detectar tipo, delegar |

### Fase 3: Organizar `whatsapp-webhook/index.ts`

Separar handlers por tipo de evento em sub-módulos.

### Fase 4: Limpeza geral

- Remover código morto e funções duplicadas
- Adicionar tipos TypeScript fortes (interfaces para Session, Field, etc.)
- Documentar cada módulo com JSDoc
- Padronizar nomes de variáveis e funções

---

## Princípios

1. **Sem mudança de comportamento** — cada fase é refatoração pura, testável
2. **Compatibilidade** — `wjia-utils.ts` re-exporta tudo para não quebrar imports existentes
3. **Incremental** — uma fase por vez, testando após cada uma
4. **Fases 1 e 2 são prioridade** — maior impacto na manutenibilidade

Deseja aprovar este plano para eu iniciar pela Fase 1?

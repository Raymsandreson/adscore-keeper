
# Plano de Refatoração: Sistema de Agentes WhatsApp

## Status

### ✅ Fase 1: Decompor `_shared/wjia-utils.ts` em módulos — CONCLUÍDA
- `field-utils.ts`, `autofill-utils.ts`, `zapsign-utils.ts`, `whatsapp-utils.ts`, `document-processing.ts`
- `wjia-utils.ts` agora é hub de re-exportação

### ✅ Fase 2: Decompor `wjia-agent/index.ts` em handlers — CONCLUÍDA
- `index.ts` (88 linhas) → router slim que delega para handlers
- `handlers/shared.ts` → corsHeaders, errorResponse, jsonResponse, createSupabaseClient
- `handlers/regenerate.ts` → MODE 0: regenerar/forçar geração de sessão
- `handlers/new-command.ts` → MODE 1: processar #comando novo
- `handlers/follow-up.ts` → MODE 2: mensagens de follow-up durante sessão ativa
- `handlers/document-upload.ts` → Upload e extração OCR de documentos

**Antes:** 1 arquivo com 2.702 linhas
**Depois:** 6 arquivos especializados, cada um com responsabilidade clara

### 🔲 Fase 3: Organizar `whatsapp-webhook/index.ts`
Separar handlers por tipo de evento em sub-módulos.

### 🔲 Fase 4: Limpeza geral
- Tipos TypeScript fortes
- Remover código morto
- Documentação JSDoc

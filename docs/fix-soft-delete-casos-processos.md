# Fix: casos e processos somem (soft-delete + FKs não-destrutivas)

**Data:** 15/07/2026 · **Banco:** Supabase externo `kmedldlepwiityjsdahz`

## Problema (com evidência)

- `legal_cases` e `lead_processes` **não tinham `deleted_at`** em produção → todo "Excluir" era **DELETE físico**.
- FKs destrutivas: excluir um caso apagava, via `ON DELETE CASCADE`, **todos os `lead_processes` e `process_movements`** dele; hard-delete de lead destruía os processos (CASCADE) e orfanava o caso (`legal_cases.lead_id` → NULL via SET NULL).
- Resultado em 15/07: **41 casos órfãos** (incl. CASO 398 — Charles x Porto Rico, ativo). Sem tabela de auditoria → o que foi apagado de vez só volta por PITR.

## O que este fix muda

Depois dele, **nenhum caso/processo é perdido por clique ou por delete de lead** — vira soft-delete (recuperável) e o delete de lead apenas **desvincula** o processo.

### 1. Migration (aplicar PRIMEIRO)
`supabase/migrations-external/20260715000000_soft_delete_cases_processes.sql`
- `+ deleted_at` em `legal_cases` e `lead_processes`
- `lead_processes.case_id` FK: CASCADE → **SET NULL**
- `lead_processes.lead_id` FK: CASCADE → **SET NULL** (relaxa `NOT NULL`)
- 3 índices parciais `WHERE deleted_at IS NULL`

### 2. Código (deployar DEPOIS da migration)
Escritas viram soft-delete (`update({ deleted_at })`):
- `src/hooks/useLegalCases.ts` `deleteCase`
- `src/hooks/useLeadProcesses.ts` `deleteProcess`
- `src/pages/CasesPage.tsx` `handleDelete` (caso) + delete inline de processo
- `src/pages/ProcessesPage.tsx` `handleDelete`

Leituras (listagens) passam a filtrar `.is('deleted_at', null)`:
- `useLegalCases.fetchCases`, `useLeadProcesses.fetchProcesses`
- `CasesPage` (listagem principal + busca por nome + processos do caso)
- `ProcessesPage.loadProcesses`

Tipos: `+ deleted_at` em `legal_cases` e `lead_processes` (Row/Insert/Update) em `src/integrations/supabase/types.ts`.

## ⚠️ Ordem de rollout (obrigatória)
1. **Aplicar a migration** no externo (`kmedldlepwiityjsdahz`).
2. Só então **publicar o frontend**. Se o front subir antes, as queries com `.is('deleted_at', null)` retornam **400 (coluna inexistente)** e as telas de casos/processos quebram.
3. Rollback: reverter frontend → rodar o bloco ROLLBACK do .sql. (Colunas são aditivas; a única mudança semântica é `lead_id` nullable.)

## Verificação pós-deploy
- Excluir um caso de teste → some da lista, mas `SELECT ... WHERE id=... ` mostra `deleted_at` preenchido e os `lead_processes`/`process_movements` **continuam existindo**.
- Restaurar: `UPDATE legal_cases SET deleted_at = NULL WHERE id = ...`.

## Fase 3 — leituras ainda NÃO filtradas (follow-up, não causa perda, só consistência visual)
Estas ainda mostram/exportam casos/processos soft-deletados; filtrar `deleted_at` quando houver tempo:
- `src/pages/ActivitiesPage.tsx:564` (lista todos os casos)
- `src/lib/processualDashboardLive.ts:137,143` (dashboard processual)
- `src/components/cases/CaseWorkflowBoard.tsx:69,93,103`
- `src/pages/BpcAutistaPage.tsx:135`
- Detalhes por id (ActivityFullSheet, WhatsAppActivitySheet, etc.) — baixa prioridade
- Edge functions: `export-cases-to-sheets`, `compute-monitor-snapshots`, `lead-drive`, `generate-case-activities` — filtrar p/ não exportar/agir sobre deletados

## Pendências relacionadas (fora deste fix)
- **38 casos órfãos restantes** (após religar 3 seguros): precisam de tela de vínculo manual ou resgate via PITR.
- **Guard**: confirmar antes de arquivar/excluir lead que tem `legal_cases` vinculados.
- **Limpeza em massa de leads** (08/07: 708 leads soft-deletados via SQL): decidir política — hoje qualquer UPDATE em massa no banco não passa pelos guard-rails do app.

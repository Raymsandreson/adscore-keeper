# Financeiro no Processo e na Atividade

Onde se registra dinheiro (despesa/receita) ligado a um cliente. Rótulos entre aspas são o texto exato exibido na interface.

---

## O que existia antes

Só a aba **"$ Financeiro"** da ficha do lead (`Editar Lead`). Para lançar uma custa de um processo, ou uma despesa gerada por uma atividade (deslocamento, cópia, perícia), era preciso sair do lugar onde o trabalho estava sendo feito, abrir a ficha do lead e lançar lá — sem nenhum vínculo com o processo ou com a atividade que originou o gasto.

## O que existe agora

Três pontos de entrada, **a mesma tabela** (`lead_financials`) e o mesmo formulário:

| Onde | Como abrir | O que grava |
|---|---|---|
| Ficha do lead | aba "$ Financeiro" | `lead_id` (+ `case_id` do caso vinculado) |
| Processo | `ProcessDetailSheet` → aba "Financeiro" | `process_id`, `case_id`, `lead_id` |
| Atividade | `ActivityFullSheet` → botão "Financeiro" no cabeçalho | `activity_id` + `process_id`/`case_id`/`lead_id` **herdados do vínculo da própria atividade** |

### A regra que faz tudo se encaixar

O lançamento grava **todos os vínculos que a origem conhece**, não só o da tela onde foi criado. Consequência prática:

- Despesa lançada dentro de uma atividade vinculada ao processo X **aparece sozinha** na aba Financeiro do processo X, na do caso e na do lead. Não há rollup por consulta extra nem job de sincronização — é o mesmo registro, encontrado por filtros diferentes.
- Na lista do processo (ou do lead), o lançamento vindo de atividade é marcado com "• via atividade".

### O que cada aba lista

- **Lead**: `lead_id` (ou `case_id`, quando há caso vinculado) — comportamento histórico, inalterado.
- **Processo**: `process_id` — inclui o que foi lançado nas atividades daquele processo.
- **Atividade**: `activity_id` — só o daquela atividade.

O botão "Financeiro" da atividade só aparece em atividade **já criada** (em modo criação ainda não existe `activity_id` para vincular).

---

## Implementação

- `src/components/finance/EntityFinancialsPanel.tsx` — implementação única, parametrizada por `scope` (`lead` | `case` | `process` | `activity`).
- `src/components/leads/LeadFinancialsTab.tsx` — wrapper fino, `scope="lead"`.
- `src/components/cases/ProcessDetailSheet.tsx` — aba `financeiro`.
- `src/components/activities/ActivityFullSheet.tsx` — botão "Financeiro" + dialog.
- Todo lançamento gravado continua disparando `trackFinanceEntry()` (cronômetro / bloco "Controle Financeiro" do dia), igual à aba do lead.

### Banco

Migration `20260805160000_lead_financials_processo_e_atividade.sql`:

```sql
ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS process_id  uuid,
  ADD COLUMN IF NOT EXISTS activity_id uuid;
```
mais índices parciais em `process_id` e `activity_id` (são os filtros novos das abas).

**As colunas não têm FK, de propósito.** `lead_processes` e `lead_activities` são tabelas de negócio e vivem no Supabase **Externo**; `lead_financials` é consultada pelo client **Cloud**. Uma FK apontando para a cópia-fantasma dessas tabelas no Cloud faria todo INSERT falhar por violação de FK — o sintoma que `src/integrations/supabase/db-routing.ts` documenta. A integridade do vínculo fica no app.

**Sem a migration aplicada, as abas de processo e atividade não funcionam** (o filtro por `process_id`/`activity_id` retorna erro). O painel agora mostra o erro do banco em toast em vez de engolir e exibir lista vazia — era assim que a aba do lead se comportava antes, e escondia falha de consulta.

Rollback (reversível em <1min, sem perda de dado pré-existente):

```sql
DROP INDEX IF EXISTS public.idx_lead_financials_process_id;
DROP INDEX IF EXISTS public.idx_lead_financials_activity_id;
ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS process_id;
ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS activity_id;
```

### Não faz parte deste módulo

`financial_entries` / `FinancePage` / `FinancialEntryForm` — é o financeiro **da empresa** (centro de custo, regime de competência, NF, núcleo). Nada aqui mexe nele.

# Financeiro no Processo e na Atividade

Onde se registra dinheiro (despesa/receita) ligado a um cliente. Rótulos entre aspas são o texto exato exibido na interface.

---

## O que existia antes

Só a aba **"$ Financeiro"** da ficha do lead (`Editar Lead`). Para lançar uma custa de um processo, ou uma despesa gerada por uma atividade (deslocamento, cópia, perícia), era preciso sair do lugar onde o trabalho estava sendo feito, abrir a ficha do lead e lançar lá — sem nenhum vínculo com o processo ou com a atividade que originou o gasto.

E ela consultava o banco errado (Cloud em vez do Externo), então aparecia zerada mesmo quando havia lançamento. Ver "Banco — e uma correção de roteamento", abaixo.

## O que existe agora

Três pontos de entrada, **a mesma tabela** (`lead_financials`) e o mesmo formulário:

| Onde | Como abrir | O que grava |
|---|---|---|
| Ficha do lead | aba "$ Financeiro" | `lead_id` (+ `case_id` do caso vinculado) |
| Processo | `ProcessDetailSheet` → aba "Financeiro" (entre "Marcos" e "Status") | `process_id`, `case_id`, `lead_id` |
| Atividade | botão "Financeiro" no cabeçalho — na tela cheia (`ActivitiesPage`) e no sheet (`ActivityFullSheet`) | `activity_id` + os vínculos do **destino escolhido** |

São duas telas diferentes para a mesma atividade e o botão existe nas duas, com o mesmo comportamento.

### O destino é escolhido, não assumido

Uma atividade pode estar vinculada a processo, caso e lead ao mesmo tempo — e nem toda despesa é do processo (deslocamento para conversar com o cliente é do lead). Por isso o formulário abre perguntando **"Registrar em"**, listando só os vínculos que aquela atividade tem, do mais específico ao menos:

- **Processo — `<nº>`** → grava `process_id` + `case_id` + `lead_id`
- **Caso — `<título>`** → grava `case_id` + `lead_id` (não entra no financeiro do processo)
- **Lead — `<nome>`** → grava só `lead_id`

Com um vínculo só, não pergunta: mostra "Registrando em: X" e segue. O botão nem aparece se a atividade não tiver nenhum vínculo.

`activity_id` é gravado sempre, qualquer que seja o destino — é o que a aba Financeiro da própria atividade lista.

### A regra que faz tudo se encaixar

O lançamento grava os vínculos do destino escolhido, não só o id da tela onde foi criado. Consequência prática:

- Despesa lançada numa atividade com destino "Processo X" **aparece sozinha** na aba Financeiro do processo X, na do caso e na do lead. Não há rollup por consulta extra nem job de sincronização — é o mesmo registro, encontrado por filtros diferentes.
- Na lista do processo (ou do lead), o lançamento vindo de atividade é marcado com "• via atividade".

### O que cada aba lista

- **Lead**: `lead_id` (ou `case_id`, quando há caso vinculado) — comportamento histórico, inalterado.
- **Processo**: `process_id` — inclui o que foi lançado nas atividades daquele processo.
- **Atividade**: `activity_id` — só o daquela atividade.

O botão "Financeiro" da atividade só aparece em atividade **já criada** (em modo criação ainda não existe `activity_id` para vincular).

---

## Implementação

- `src/components/finance/EntityFinancialsPanel.tsx` — implementação única, parametrizada por `scope` (`lead` | `case` | `process` | `activity`). Exporta `buildFinancialLinkOptions()`, que monta os destinos da atividade.
- `src/components/leads/LeadFinancialsTab.tsx` — wrapper fino, `scope="lead"`.
- `src/components/cases/ProcessDetailSheet.tsx` — aba `financeiro`.
- `src/pages/ActivitiesPage.tsx` e `src/components/activities/ActivityFullSheet.tsx` — botão "Financeiro" + dialog, ambos usando `buildFinancialLinkOptions()` para oferecer os mesmos destinos.
- Todo lançamento gravado continua disparando `trackFinanceEntry()` (cronômetro / bloco "Controle Financeiro" do dia), igual à aba do lead.

### Banco — e uma correção de roteamento

`lead_financials` vive no Supabase **Externo** (`kmedldlepwiityjsdahz`), com FK para `leads` e `legal_cases` de lá. A aba Financeiro do lead consultava a tabela pelo client **Cloud** — banco errado. Por isso ela aparecia sempre zerada. Corrigido: o painel usa `db` (Externo), com `ensureExternalSession()` e `created_by` passado por `remapToExternal()` (o usuário autentica no Cloud, a FK aponta para o auth do Externo). `lead_financials` entrou em `BUSINESS_TABLES` (`src/integrations/supabase/db-routing.ts`) para o guarda pegar qualquer reincidência.

Migration `20260805160000_lead_financials_processo_e_atividade.sql`:

```sql
ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS process_id  uuid,
  ADD COLUMN IF NOT EXISTS activity_id uuid;
-- + FK para lead_processes(id) e lead_activities(id), ambas ON DELETE SET NULL
-- + índices parciais em process_id e activity_id (os filtros novos das abas)
```

`ON DELETE SET NULL` segue o que `case_id` já fazia: apagar processo ou atividade não pode apagar dinheiro já lançado — o valor foi gasto de qualquer jeito e continua valendo para o caso e para o lead.

**Aplicada em 05/08/2026** no `kmedldlepwiityjsdahz`, com 0 linhas na tabela. Colunas, as duas FKs e os dois índices parciais conferidos no banco depois de rodar.

O painel mostra erro do banco em toast em vez de engolir a falha e exibir lista vazia — era assim que a aba do lead se comportava antes, e foi o que escondeu o roteamento errado.

Rollback (reversível em <1min, sem perda de dado pré-existente):

```sql
DROP INDEX IF EXISTS public.idx_lead_financials_process_id;
DROP INDEX IF EXISTS public.idx_lead_financials_activity_id;
ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS process_id;
ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS activity_id;
```

### Não faz parte deste módulo

`financial_entries` / `FinancePage` / `FinancialEntryForm` — é o financeiro **da empresa** (centro de custo, regime de competência, NF, núcleo). Nada aqui mexe nele.

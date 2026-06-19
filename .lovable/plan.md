## Plano: Módulo de Audiências (dentro de Processual)

### Onde encaixa
Nova aba **"Audiências"** dentro de `src/pages/ProcessesPage.tsx`, ao lado de Judicial/INSS/Processual (segue regra de navegação: funcionalidade nova entra dentro do módulo pai, não solta no sidebar).

### Banco (Supabase Externo, via `run-external-migration`)

Tabela `hearings`:
- `id` uuid pk
- `process_number` text — ex: `0801799-23.2025.8.14.0125`
- `case_ref` text — ex: `CASO 295` (identificador interno livre)
- `lead_id` uuid null — vínculo opcional ao lead/caso existente
- `legal_case_id` uuid null — vínculo opcional a `legal_cases`
- `hearing_type` text — UNA Virtual, UNA Presencial, Instrução, Conciliação, Encerramento de Instrução, Inicial Virtual, Perícia Médica, Outro
- `category` text — `previdenciario` | `civel` | `trabalhista` | `criminal` | `outro` (drive da cor)
- `hearing_date` date
- `hearing_time` time
- `timezone_label` text — "Horário de Manaus", "Horário de Cuiabá", "Padrão Brasília" (livre)
- `status` text — `ativa` | `adiada` | `cancelada` | `concluida` (default `ativa`)
- `location` text null — sala virtual / endereço
- `notes` text null — observações; presença não-vazia → ícone de alerta no card
- `created_by` uuid, `created_at`, `updated_at`, `deleted_at` (soft-delete padrão)

Índices: `(hearing_date)`, `(status)`, `(category)`, `(process_number)`, `(case_ref)`.

RLS: leitura/escrita para `authenticated`. GRANTs para `authenticated` e `service_role`.

### Frontend

Novos arquivos:
- `src/hooks/useHearings.ts` — CRUD via `db` (Externo). React Query, `staleTime 30s`.
- `src/components/hearings/HearingsModule.tsx` — container com header (busca global, filtros, "Nova Audiência"), tabs de visualização (Mês | Semana | Dia | Lista).
- `src/components/hearings/HearingWeekView.tsx` — agrupado por "Semana N do mês", grid seg-sex com cards.
- `src/components/hearings/HearingMonthView.tsx` — calendário mensal (grid 7 colunas).
- `src/components/hearings/HearingDayView.tsx` — lista vertical do dia selecionado.
- `src/components/hearings/HearingListView.tsx` — tabela ordenável.
- `src/components/hearings/HearingCard.tsx` — card colorido por `category`, status `cancelada`/`adiada` aplica `line-through opacity-60`, ícone `AlertTriangle` quando `notes` não vazio.
- `src/components/hearings/HearingFormDialog.tsx` — modal único de criar/editar (regra de form unificado).
- `src/components/hearings/HearingFiltersBar.tsx` — filtros: semana, tipo, status, busca por `process_number` ou `case_ref`.

Integração:
- `src/pages/ProcessesPage.tsx` ganha tab `"Audiências"` renderizando `<HearingsModule />`.

### Sistema de cores (tokens semânticos em `src/index.css`)

Adicionar HSL tokens (não hardcodar):
- `--hearing-prev` (rosa/magenta) — Previdenciário/Perícia Médica
- `--hearing-civel` (azul claro)
- `--hearing-trabalhista` (âmbar claro)
- `--hearing-criminal` (vermelho suave)
- `--hearing-outro` (cinza)
- `--hearing-status-cancelada`, `--hearing-status-adiada`, `--hearing-status-concluida`

Mapear em `tailwind.config.ts` (`hearing.prev`, `hearing.civel`, etc.).

### Funcionalidades

- **Visão semanal**: agrupa por número da semana do mês ("Semana 1"... "Semana 5"), 5 colunas seg-sex, cards empilhados por horário.
- **Filtros**: por semana (dropdown), tipo (multi), status (chips), busca textual (debounced 300ms em `process_number` + `case_ref` + `notes`).
- **Nova/Editar**: mesmo `HearingFormDialog`, props `mode: 'create' | 'edit'` + `hearing?`.
- **Alertas**: card com `notes` mostra `AlertTriangle` amber no canto superior direito + tooltip com preview.
- **Cancelada/Adiada**: `line-through` no título + `opacity-60`.
- **Soft delete**: ação "Excluir" seta `deleted_at` com snapshot em `notes` (segue policy).

### Dados fictícios
Inserir ~8 registros via `supabase--insert` após a migração: misto de PREV (perícias) e CASOs cíveis, datas na semana atual e próxima, alguns com `notes` e 1 cancelada para demonstrar visual.

### Fora de escopo
- Notificações/lembretes automáticos
- Integração com Google Calendar
- Vínculo automático com `lead_processes` (pode ser feito depois via `process_number`)
- Mobile view dedicada (responsivo padrão Tailwind apenas)

### Detalhes técnicos
- Imports: `db` do barrel `@/integrations/supabase` para tudo de Externo.
- Migration via edge function `run-external-migration` (não pedir SQL manual).
- Componentes shadcn: Tabs, Dialog, Select, Input, Calendar, Badge, Card, Popover.
- `date-fns` (já no projeto) para semana/mês.

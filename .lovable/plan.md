## Objetivo

Substituir o dataset mockado em `src/lib/processualDashboardData.ts` por dados reais lidos do Supabase Externo, mantendo a UI atual de `/processual/acompanhamento` e respeitando a regra "dashboards leem do Externo via `db`".

## Fontes que vou combinar

| Bloco do dashboard | Tabela(s) reais usadas |
|---|---|
| Resumo (processos ativos, atualizações, sentenças, trânsitos) | `lead_processes` (status, `movimentacoes`), `legal_cases` (status/outcome_date) |
| SLA por fase (Sentença, Acórdão, TST, Trânsito) | `lead_processes.movimentacoes[]` — detecto evento por keyword em `tipo_publicacao`/`conteudo`, calculo dias desde `started_at`/`data_distribuicao` |
| Latência entre atualizações | Diferenças entre `data` consecutivas em `movimentacoes` por processo (somente movimentações processuais — conforme escolha do usuário) |
| Transições de status | `lead_stage_history` agrupado por par `(from_stage→to_stage)`, média de dias entre eventos consecutivos |
| Categorias (Onboarding, Relatório de Acidente, INSS, Indenização, Inquérito Policial) | Cruzo `kanban_boards.name`/`lead_activities.title` (regex de classificação) com `lead_activities` (criadas, concluídas) e `lead_processes` (protocolados) |

## Filtro de período

"Hoje / Esta semana / Este mês" filtram pelo **marco final** do dado (movimentação, conclusão de atividade, mudança de etapa, sentença) caindo dentro da janela — conforme escolha do usuário.

## Implementação

1. **Novo módulo `src/lib/processualDashboardLive.ts`**
   - Tipos reaproveitados de `processualDashboardData.ts` (`DashboardProcessualData`, `SlaFase`, etc.) — exporto/reuso.
   - Função `fetchProcessualDashboard(periodo, filtros)` que dispara queries paralelas via `db` (externalSupabase):
     - `lead_processes` (id, status, started_at, data_distribuicao, movimentacoes, workflow_name)
     - `legal_cases` (id, status, outcome, outcome_date, closed_at, created_at, workflow_board_id)
     - `lead_stage_history` (lead_id, from_stage, to_stage, changed_at) limitado à janela
     - `lead_activities` (title, activity_type, status, created_at, completed_at, case_id) com `deleted_at is null`
     - `kanban_boards` (id, name) para mapear categorias
   - Reduções client-side:
     - **Classificador de categoria**: regex sobre título da atividade / nome do board (já mapeado: ONBOARDING, ACIDENTE, INSS/BENEFÍCIO, INDENIZAÇÃO, INQUÉRITO).
     - **Classificador de evento processual**: keywords em `tipo_publicacao` (`SENTEN`, `ACÓRDÃO`, `TST`, `TRÂNSITO`).
     - **Latência**: para cada processo com ≥2 movimentações, calcular gaps em horas, agregar por dia (média) — 30/7/1 pontos.
     - **Transições**: agrupar `lead_stage_history` ordenado por `lead_id, changed_at`, calcular intervalo entre pares consecutivos, devolver top 7 mais frequentes.
   - Cache em memória (TTL 60s) por `(periodo, filtros)` para evitar refazer queries pesadas em troca de aba.

2. **Novo hook `src/hooks/useProcessualDashboard.ts`**
   - `useProcessualDashboard(periodo, filtros)` → `{ data, loading, error, refresh }`
   - Internamente chama `fetchProcessualDashboard`, com `useEffect` que reage a `periodo`/`filtros`.
   - Fallback: se a query falhar (sessão anônima sem RLS), retorna o dataset mock com flag `isMock: true` para o painel sinalizar.

3. **`src/pages/AcompanhamentoProcessualPage.tsx`**
   - Trocar leitura direta de `DATASET_PROC[periodo]` por `useProcessualDashboard(periodo, filtros)`.
   - Mostrar estado de loading (skeleton) e badge "Dados reais" / "Sem permissão — exibindo amostra" quando cair no fallback.
   - Filtros `responsavel`/`etiqueta` são aplicados client-side sobre os arrays retornados (já existe a estrutura na page).

4. **Sem alterações de schema** — só leitura.

## O que NÃO vou mexer

- `src/lib/processualDashboardData.ts` permanece como fonte do fallback/tipos.
- Rota, sidebar, layout visual, paleta e tipografia do dashboard.
- Nenhuma migration / nenhuma policy de banco.
- Outras páginas/dashboards.

## Validação

- Build + tsgo da página.
- `db.from('lead_processes').select('id', { count: 'exact', head: true })` para confirmar que a sessão anônima do Externo retorna linhas. Se voltar 0 com count > 0 no Cloud, ajusto o hook para usar fallback e aviso o usuário que precisamos abrir uma policy no Externo para tornar o painel realmente "live".

## Riscos conhecidos

- **`movimentacoes` é JSONB livre** — a classificação por keyword pode subestimar sentenças/acórdãos. Vou logar no console o total classificado vs. total de movimentações pra calibrarmos depois.
- **`lead_stage_history` no Externo** pode estar mais pobre do que no Cloud (bridge assíncrona). Se eu detectar < 100 linhas no período, sinalizo na UI.
- **Performance**: `movimentacoes` pode ser grande — limito o select às colunas necessárias e processo em streaming (sem `select('*')`).

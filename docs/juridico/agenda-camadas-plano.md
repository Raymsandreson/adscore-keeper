# Plano de Arquitetura — Agenda em Camadas

> Plano para unificar **rotina (molde), atividades e audiências** numa agenda datada onde
> os eventos fixos (compromisso/prazo) pousam sobre o molde recorrente. É PLANO — nada
> aqui foi construído. Aprovar antes de codar. Conceito-base: `naturezas-atividade.md`.

Data: 2026-07-27. Status: **aguardando aprovação.**

---

## Ponto de partida (o que já existe no código)

| Peça | Onde | Estado |
|---|---|---|
| Molde da rotina | `user_timeblock_settings` (Externo) + `useTimeBlockSettings` + `RoutineCalendarGrid` | Template por dia da semana, **sem data real, sem projeção** |
| Atividades | `lead_activities` + `useLeadActivities` | Agora com `natureza` (via `activity_types`) e `meeting_at` p/ compromisso |
| Audiências | `hearings` + `useHearings` + `HearingsModule` | **Ilha** — calendário próprio, não fala com atividades/rotina |

O gap: o molde nunca é projetado num dia; audiência/prazo nunca sobrepõem a rotina;
audiências vivem separadas.

---

## Modelo alvo — 4 camadas (função pura, sem tabela nova no MVP)

1. **Molde (template):** `user_timeblock_settings` como está. Reserva de capacidade, recorrente.
2. **Projeção:** função pura `projetarRotina(blocos, intervaloDeDatas)` → gera os blocos do
   molde nas datas reais. **Client-side, sem materializar em tabela** (barato e reversível).
3. **Sobreposição:** os eventos datados pousam por cima —
   - compromisso → `lead_activities.meeting_at` (data+hora) **+** `hearings`;
   - prazo → data-limite da atividade (campo de prazo);
   - tarefa/diligência → data prevista.
   Evento fixo **sempre tem prioridade** e **corta/comprime** o bloco do molde no horário.
4. **Realocação:** tarefas do bloco furado **escorrem** pro próximo bloco livre
   (reagendáveis). Prazo não escorre — dispara alerta se o dia ficou sem espaço.

### Forma comum: `AgendaEvent`
Um adaptador normaliza as 3 fontes num shape único para a view:
`{ id, origem: 'rotina'|'atividade'|'audiencia', natureza, titulo, inicio, fim|null, fixo: boolean, refId }`.
Assim a agenda não precisa saber de onde veio cada item.

---

## Decisões a travar (antes de codar)

1. **Audiências: unificar ou adaptar?**
   - **Recomendado (MVP):** *adaptar* — um `useAgendaEvents` lê `lead_activities` + `hearings`
     e projeta a rotina, tudo em memória. Não-destrutivo, reversível.
   - *Depois (opcional):* migrar `hearings` para `lead_activities` (natureza=compromisso) e
     aposentar a ilha. Decisão separada, com plano de migração próprio.
2. **Projeção materializada?** Não no MVP — função pura. Só materializa se performance exigir.
3. **Realocação automática?** MVP mostra o conflito e deixa arrastar; a sugestão por IA
   (reusar `suggest-routine`) entra numa fase seguinte.

---

## Fases (cada uma entrega valor e é reversível)

- **P1 — Agenda unificada read-only.** Nova aba/rota "Dia/Semana" que projeta o molde +
  sobrepõe atividades e audiências (via `useAgendaEvents`). Sem realocação, sem escrita.
  Puramente aditivo — rollback = remover a aba.
- **P2 — Colisão visível.** Evento fixo corta/comprime o bloco do molde no render.
- **P3 — Realocação de tarefa.** Arrastar tarefa deslocada + sugestão por IA. Aqui entra escrita.
- **P4 — (opcional) Migrar hearings** para `lead_activities`. Destrutivo → plano próprio.

## Reuso obrigatório (não reinventar — `code-reusables-map`/`db-tables-map`)

- Render de grade/arrasto: primitivas de `RoutineCalendarGrid`.
- Dados: `useTimeBlockSettings`, `useLeadActivities`, `useHearings`, `naturezaOf`.
- IA de rotina: `suggest-routine` (já existe) para o replanejamento da P3.
- **Nada de tabela nova no MVP.** `user_timeblock_settings` + `lead_activities` + `hearings` bastam.

## Custos e riscos

- P1/P2 são client-side (projeção + render) — custo ~zero, sem invocations novas.
- P3 usa IA só sob demanda (replanejar) — custo por clique, reusa função existente.
- Risco baixo até P3 (só leitura). P4 é o único destrutivo — fica por último, com rollback.

## Rollback

- P1–P2: remover a aba/rota (sem schema). <5 min.
- P3: feature-flag na escrita de reagendamento.
- P4: plano de migração reversível dedicado (não faz parte deste MVP).

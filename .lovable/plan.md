# Reestruturação do Funil BPC-Autismo

## Estado atual (verificado no banco)

Board `BPC - Autismo` (`c8e8c466-...`), tipo `funnel`, hoje só tem 2 fases:

| stage_id      | nome          |
|---------------|---------------|
| `new`         | Novo          |
| `in_progress` | Em Andamento  |

Existe um terceiro vínculo de checklist apontando pra `done` (órfão — fase já foi removida do board).

Cada fase tem 1 objetivo vazio (sem itens) ligado via `checklist_stage_links` → `checklist_templates`.

## Estado proposto (modelo B+C)

```text
Novo  →  Em Qualificação  →  Viável  →  Em Andamento  →  Fechado
                          ↘
                            Inviável (terminal)
```

| stage_id        | nome             | cor      | papel no Kanban           |
|-----------------|------------------|----------|---------------------------|
| `new`           | Novo             | #3b82f6  | Inbox (1ª coluna)         |
| `qualificacao`  | Em Qualificação  | #eab308  | Operador rodando checklist|
| `viavel`        | Viável           | #22c55e  | Aprovado — pronto pra ação|
| `in_progress`   | Em Andamento     | #f97316  | Caso em execução          |
| `closed`        | Fechado          | #16a34a  | Ganho (won)               |
| `inviavel`      | Inviável         | #ef4444  | Terminal (lost/refused)   |

`closed` e `inviavel` já casam com `kanbanStageTypes.ts` (won/lost reconhecidos automaticamente).

## Critérios de qualificação (checklist da fase "Em Qualificação")

Vou criar 1 objetivo `Avaliar viabilidade BPC` com 1 passo `Conferir critérios` cujo `docChecklist` traz:

- Laudo médico com CID F84 (TEA) anexado
- Renda familiar per capita ≤ 1/4 do salário mínimo
- Idade do beneficiário confirmada
- CPF do beneficiário válido
- Responsável legal identificado (procuração possível)
- Comprovante de residência atualizado

## Movimento automático no Kanban

No WorkflowBuilder cada passo tem `nextStageId` (já existe). Vou configurar:

1. Passo `Conferir critérios` (em `qualificacao`) ganha 2 ações de conclusão:
   - **Aprovar** → move card pra `viavel`
   - **Reprovar** → move card pra `inviavel`

2. Passo `Iniciar atendimento` em `viavel` → move pra `in_progress` ao concluir.
3. Passo `Encerrar caso` em `in_progress` → move pra `closed` ao concluir.

O motor de movimento automático ao concluir passo já existe (`nextStageId` é lido pelo runtime de atividades). Não preciso criar código novo — só configurar dados.

## Execução (na ordem, com rollback)

1. **Snapshot**: salvar `stages` atual + linhas de `checklist_stage_links`/`checklist_templates` do board num JSON local antes de qualquer escrita (rollback = re-inserir).
2. **UPDATE** `kanban_boards.stages` do board com o array novo de 6 fases.
3. **DELETE** o link órfão de `stage_id='done'`.
4. **INSERT** novos `checklist_templates` (Avaliar viabilidade, Iniciar atendimento, Encerrar caso) com items+steps no formato que o WorkflowBuilder lê (incluindo `nextStageId` nos passos).
5. **INSERT** novos `checklist_stage_links` ligando cada template à sua fase.
6. Manter os templates antigos vazios (`Objetivo`/`Novo objetivo`) por 24h marcados pra remoção depois — não vou deletar agora pra não quebrar leads que estejam apontando neles via `lead_checklist_instances`.

## O que NÃO vou mexer

- `lead_checklist_instances` existentes (cards em andamento mantêm progresso).
- Outros boards.
- Código frontend — toda mudança é em dados.
- Roteamento, edge functions, RLS.

## Riscos

- Cards hoje na coluna `in_progress` continuam lá (stage_id preservado).
- Cards que estiverem teoricamente em `done` (não deveria ter nenhum porque a fase já sumiu) ficariam órfãos — vou rodar `SELECT count(*) FROM leads WHERE board_id=... AND stage_id='done'` antes e te aviso se aparecer algo.

## Verificação pós-execução

- Query confirmando 6 stages em ordem.
- Query listando templates+links por stage.
- Você abre o board no preview e confirma que as 6 colunas aparecem e o checklist da fase "Em Qualificação" mostra os 6 critérios.

Confirma que sigo?

---
name: whatsjud-natureza-atividades
description: Use SEMPRE que a tarefa envolver atividade, agenda, "próximos passos", controle de prazos, kanban de tarefas, audiência/perícia/avaliação social, ou diligência externa. Define as 4 NATUREZAS de atividade (compromisso, prazo, tarefa, diligência) e impede achatá-las numa lista de "tipo" só. Acione ao ouvir "tipo de atividade", "novo compromisso", "cadastrar prazo", "audiência", "perícia", "avaliação social", "diligência", "correspondente", "reagendar", "dropdown TIPO", ou ao criar tabela/campo/form/hook que classifique atividade.
---

# Naturezas de Atividade — 4, nunca achatar

Fonte da verdade completa: `docs/juridico/naturezas-atividade.md`. Leia-a antes de
modelar tabela, campo ou form de atividade.

## Regra dura

PROIBIDO tratar atividade como lista plana de "tipo". Existem **4 naturezas** com
comportamento diferente. Antes de propor tabela/campo/form/dropdown de atividade, cite
qual(is) natureza(s) a mudança toca e por quê.

- **`natureza`** = enum **fixo de 4** (`compromisso`, `prazo`, `tarefa`, `diligencia`).
  Não é configurável.
- **`tipo`** = catálogo configurável **pendurado embaixo** de cada natureza.

## Os 2 eixos (é daqui que saem as 4)

- **TEMPO** (rígido) → separa **Compromisso** e **Prazo**.
- **EXECUÇÃO** (flexível) → separa **Tarefa** (mesa) e **Diligência** (campo).

## Decisão rápida

| | Compromisso | Prazo | Tarefa | Diligência |
|---|---|---|---|---|
| Hora marcada? | ✅ | ❌ | ❌ | ❌ |
| Data definida por | terceiro | lei/juízo | equipe | equipe |
| Pode antes / depois | não / não | sim / **nunca** | sim / sim | sim / sim |
| Reagenda a equipe? | ❌ só órgão | ❌ | ✅ | ✅ |
| Externa/campo? | às vezes | ❌ | ❌ | ✅ |
| Terceirizável (custo)? | ❌ | ❌ | ❌ | ✅ |
| Se perde | revelia | **preclusão** | custo interno | custo interno |
| "Repetir"? | ❌ | ❌ | ✅ | ✅ |

## O que cada natureza exige de diferente

- **Compromisso** — data **+ hora**, local/link, "cliente presente?". Só o órgão remarca
  (com histórico). Ex.: audiência, perícia médica, avaliação social, reunião.
- **Prazo** — `data_limite` sem hora, `data_intimacao`, contagem em **dias úteis**, flag
  `fatal`, suspensão/prorrogação como **evento jurídico** (não reagendamento). Alerta
  escalonado D-5/D-3/D-1. Sem "Repetir". Ex.: contestação, recurso, réplica.
- **Tarefa** — `data_prevista`, reagenda livre, "Repetir" ok. Ex.: ligação, minuta,
  acompanhamento.
- **Diligência** — local, **executor** (interno ou correspondente/parceiro),
  **custo/repasse**, **comprovante**; ciclo aberta→atribuída→campo→concluída c/ comprovante.
  Ex.: INSS, cartório, delegacia, hospital, visita a cliente/prospecto.

## Armadilhas

- Perícia médica e avaliação social são **compromisso** (têm hora), não tarefa.
- Prazo **não** tem "Repetir" nem reagendamento livre. Perder prazo = preclusão (grave).
- Diligência **não** é tipo dentro de tarefa — é natureza própria (campo + custo + terceiro).
- "Reunião" só é compromisso **se tiver hora**; sem hora é tarefa.

# Naturezas de Atividade — WhatsJUD

> Fonte da verdade sobre como o sistema separa **compromisso, prazo, tarefa e diligência**.
> Toda feature de agenda, atividade, "próximos passos", controle de prazos, kanban de
> tarefas ou diligência externa deve respeitar esta taxonomia. Não achatar naturezas
> diferentes numa lista só (era o bug do dropdown TIPO em "Nova atividade").

Data: 2026-07-26 · Decisão do usuário (Raym), validada nesta sessão.

---

## O problema que isto resolve

O form "Nova atividade" tinha um único campo **TIPO** que misturava seis coisas de
naturezas diferentes numa lista plana:

```
Tarefa · Audiência · Prazo · Acompanhamento · Reunião · Diligência
```

Isso é um erro de modelagem: cada uma dessas coisas tem **relação diferente com o tempo,
com quem manda na data, e com quem executa**. Tratar todas com os mesmos campos e as
mesmas regras faz o form não servir direito para nenhuma (ex.: audiência precisa de
**hora** e o form não tem; prazo não pode ter "Repetir"; diligência precisa de
**executor externo e custo** e não tem onde).

---

## Os dois eixos

A taxonomia sai do cruzamento de **dois eixos**, não de um só:

- **Eixo TEMPO** — tem hora marcada? quem define a data? dá pra adiar? perder gera preclusão?
- **Eixo EXECUÇÃO** — é trabalho de mesa (interno) ou de campo (externo)? quem executa? tem custo?

| Natureza | Definida pelo eixo… | Marca registrada |
|---|---|---|
| **Compromisso** | TEMPO (rígido) | Hora travada, terceiro marca, presença obrigatória |
| **Prazo** | TEMPO (rígido) | Data-limite não-adiável, preclusão se perde |
| **Tarefa** | EXECUÇÃO (flexível) | Interna/mesa, equipe controla, reagenda livre |
| **Diligência** | EXECUÇÃO (flexível) | Externa/campo, terceirizável, tem custo e comprovante |

**Leitura:** Compromisso e Prazo são travados no **tempo**. Tarefa e Diligência são
flexíveis no tempo e se separam pela **execução** — tarefa é mesa, diligência é campo.

---

## As 4 naturezas em detalhe

### 1. COMPROMISSO
Evento com **data + hora fixas**, marcado por terceiro (juízo, perito, INSS).

- **Exemplos:** audiência (UNA, instrução, conciliação, inicial), perícia médica,
  avaliação social, reunião, sessão de julgamento, sustentação oral.
- **Tempo:** tem **hora** obrigatória. Não pode ser antecipado nem adiado pela equipe —
  só o órgão remarca (e a remarcação é registrada no histórico, não é arrastar no calendário).
- **Se perde:** revelia, perda da pauta, preclusão do ato praticável na sessão.
- **Campos próprios:** data + **hora**, local/link, flag "cliente presente?", timezone.
- **"Repetir":** não faz sentido.

### 2. PRAZO
**Data-limite legal** que não se adia por vontade da equipe.

- **Exemplos:** contestação, recurso, réplica, cumprimento de despacho, embargos, contrarrazões.
- **Tempo:** tem data-limite, **sem hora marcada pela equipe** (existe teto legal —
  protocolo eletrônico até 23:59:59 do último dia, art. 213 CPC — mas a equipe não escolhe
  a hora). Corre em **dias úteis**, com termo inicial (data da intimação/ciência).
- **Pode antes / pode depois:** pode protocolar **antes**; **nunca depois**.
- **Não-adiável discricionariamente:** existe prorrogação/suspensão legal (rara, com
  fundamento — art. 139, VI, CPC; recesso forense), tratada como **evento jurídico
  registrado**, não como reagendamento livre.
- **Se perde:** **preclusão** — perde o direito de praticar o ato. É a consequência mais
  grave e irreversível das quatro naturezas.
- **Campos próprios:** `data_limite` (sem hora), `data_intimacao` (termo inicial),
  contagem em dias úteis, flag `fatal` (quase sempre true), evento de suspensão/prorrogação.
- **Alerta:** o mais agressivo — escalonado D-5 / D-3 / D-1 / no dia.
- **"Repetir":** não faz sentido.

### 3. TAREFA
Trabalho **interno de mesa**, com data prevista escolhida pela equipe.

- **Exemplos:** ligar pro cliente, juntar documento, elaborar minuta, acompanhar
  andamento processual, conferir publicação.
- **Tempo:** **data prevista** (alvo), sem hora obrigatória. Pode ser feita **antes ou
  depois**; **reagenda livremente** sem consequência jurídica externa.
- **Se atrasa:** custo interno (produtividade), não preclusão.
- **Campos próprios:** `data_prevista`, responsável, "Repetir" liberado (recorrente).
- É a **única** natureza que a equipe controla de ponta a ponta.

### 4. DILIGÊNCIA
Trabalho **externo / de campo**, muitas vezes **terceirizado**.

- **Exemplos:** visita a cliente ou prospecto, ir ao INSS (cobrança, pegar senhas),
  cartório/delegacia (cópia de inquérito), hospital (prontuário).
- **Tempo:** flexível como a tarefa (reagendável, sem preclusão, sem hora fixa em regra).
- **O que a torna natureza própria (eixo EXECUÇÃO):**
  - **Externa/campo** — não é trabalho de mesa.
  - **Executor pode ser terceiro** — correspondente, parceiro → puxa **contratação e
    custo/repasse**.
  - **Entregável físico** que volta pro processo — cópia de inquérito, prontuário, senha.
  - **SLA maior** — depende de deslocamento e de agenda de terceiros.
- **Campos próprios:** local/endereço, **executor** (interno ou correspondente/parceiro),
  **custo/repasse**, prazo-alvo (não fatal), **comprovante/entregável**.
- **Ciclo de vida:** aberta → atribuída (a quem) → em execução (campo) → concluída **com
  comprovante** → anexa ao processo.
- **Custo visível:** é a única natureza com **custo externo real** (deslocamento +
  honorário do correspondente). Isso é dado, não observação solta.

---

## Modelagem (consequência para o banco)

- **`natureza`** = enum **fixo de 4 valores** (`compromisso`, `prazo`, `tarefa`,
  `diligencia`). Define comportamento — **não é configurável** pelo usuário.
- **`tipo`** = **catálogo configurável** pendurado embaixo de cada natureza. Ex.:
  - natureza=`compromisso` → tipos {Audiência UNA, Perícia Médica, Avaliação Social, Reunião…}
  - natureza=`prazo` → tipos {Contestação, Recurso, Réplica…}
  - natureza=`tarefa` → tipos {Ligação, Acompanhamento, Minuta…}
  - natureza=`diligencia` → tipos {Visita INSS, Cartório, Hospital, Correspondente…}

Os **campos do form e as regras** (hora obrigatória, "Repetir", alerta escalonado, custo,
comprovante) mudam conforme a **natureza**, não conforme o tipo.

## Tabela de decisão rápida

| Pergunta | Compromisso | Prazo | Tarefa | Diligência |
|---|---|---|---|---|
| Tem hora marcada? | ✅ | ❌ | ❌ | ❌ |
| Quem define a data? | terceiro | lei/juízo | equipe | equipe |
| Pode fazer antes? | ❌ | ✅ | ✅ | ✅ |
| Pode fazer depois? | ❌ | ❌ | ✅ | ✅ |
| Reagenda a equipe? | ❌ (só órgão) | ❌ | ✅ | ✅ |
| É externa/campo? | às vezes | ❌ | ❌ | ✅ |
| Executor terceirizável? | ❌ | ❌ | ❌ | ✅ |
| Tem custo externo? | ❌ | ❌ | ❌ | ✅ |
| Se perde | revelia | **preclusão** | custo interno | custo interno |
| "Repetir" faz sentido? | ❌ | ❌ | ✅ | ✅ |

## Casos de borda

- **Reunião com hora** → compromisso. **Sem hora** ("falar com o cliente essa semana") → tarefa.
- **Diligência com hora marcada** (ex.: perícia que o correspondente acompanha) → continua
  diligência pela execução; a hora vira atributo, não muda a natureza.
- **Acompanhamento processual** → tarefa (monitorar andamento, trabalho de mesa).

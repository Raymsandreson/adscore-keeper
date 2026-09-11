# Aba Métricas

`/metricas` (menu **Financeiro → Métricas**). Página:
`src/pages/MetricasPage.tsx`. Backend: `railway-server/src/functions/metricas-painel.ts`.
Recortes: `railway-server/src/lib/recortesDoPainel.ts` (puro, com teste).

Uma chamada devolve tudo. Fica no Railway, não no navegador, porque o token da
Meta não pode chegar ao front e `meta_capi_events` tem RLS sem policy.

## O que mostra

| Bloco | Fonte |
|---|---|
| Investido hoje / 7d / 30d | Marketing API, ao vivo (`act_*/insights`, `time_increment=1`) |
| Leads hoje / 7d / 30d | `leads.created_at` |
| Fechamentos hoje / 7d / 30d | `leads.became_client_date` |
| Custo por lead pago (7d) | gasto 7d ÷ leads pagos 7d |
| Fila de conversões | `meta_capi_events` por status |
| Gráfico de 30 dias | barras de leads/fechamentos + linha de investimento |
| Desempenho por conjunto | Meta (`insights?level=adset`, 7d) cruzado com `leads.adset_name` |
| Funil dos leads de anúncio | `leads.lead_status` só dos pagos, 30 dias |
| Rotinas automáticas | `lib/estadoDosCrons.ts`, o mesmo estado que o `/health` mostra |

Lead **pago** = tem `facebook_lead_id` ou `source ilike '%planilha meta ads%'`.

## Regra da tela

Número que não pode ser calculado com honestidade aparece como **"—" com o
motivo do lado**, nunca como zero. É por isso que o CPL de 30 dias vem vazio:
lead pago só existe no CRM desde 28/08/2026, então dividir 30 dias de
investimento por poucos dias de lead daria um custo inventado. Importar o
backlog das planilhas é o que destrava.

## Dia civil: as duas armadilhas (corrigidas em 09/09/2026)

Ambas produziam número errado com cara de métrica, e a tela **se contradizia
sozinha** — o gráfico somava 3.536 leads enquanto o card dizia 3.615.

**1. O dia era UTC.** `toISOString().slice(0,10)` devolve o dia de Greenwich, e o
Brasil é UTC-3: "hoje" começava às 21h de ontem. Medido: o card dizia 130 leads,
e 5 tinham chegado entre 21:01 e 22:24 do dia anterior.

Pior, o insights da Meta já vem no fuso **da conta**, e as duas contas são
`America/Sao_Paulo` (confirmado por `meta-capi-dispatch` `modo: inventario`, que
agora mostra o campo `fuso`). A barra de leads e a linha de gasto do gráfico
estavam deslocadas três horas uma da outra.

**2. "7 dias" tinha oito.** O corte era `diasAtras(7)` com filtro `>=`, o que
inclui as duas pontas. Efeito medido em 09/09/2026:

| | Publicado | Real |
|---|---:|---:|
| Leads em 7 dias | 1.066 | 822 |
| Fechamentos em 7 dias | 63 | 38 |
| Leads de anúncio em 7 dias | 109 | 73 |
| Custo por lead pago | R$ 52,39 | R$ 61,67 |

Fechamento era o pior caso: **+66%**, porque um dia extra pesa muito em volume
baixo.

### Como não volta

`railway-server/src/lib/diasSaoPaulo.ts` (módulo puro, com teste):

- `diaDoInstante(v)` para coluna `timestamptz` — **converte** o fuso;
- `diaDaColuna(v)` para coluna `DATE` — **não converte** (um DATE já é o dia
  civil; passá-lo por fuso jogaria todo fechamento um dia para trás);
- `corteDeDias(n)` para montar janela que **inclui hoje**. Pede-se a janela pelo
  tamanho dela, então o off-by-one deixa de ser escrevível. `corteDeDias(0)`
  lança em vez de devolver data torta.

A borda do fetch também é `-03:00`, não `Z` — com `Z` a busca começava três
horas antes e o card "em 30" contava a mais.

## Desempenho por conjunto (10/09/2026)

A tabela que responde *de quem vem o contrato*. Os conjuntos são nomeados por
acolhedor (`CONJUNTO 3 - ISRAEL`, `CONJUNTO 6 - MATEUS`, `CONJUNTO - KAROLYNE`),
então cada linha é também uma pessoa.

A junção é pelo **nome** do conjunto — `leads.adset_name` é o único campo comum
entre os dois lados. Cada lado sabe metade: a Meta tem gasto e quantos
formulários foram preenchidos; só o CRM sabe quantos viraram contrato.

Medido em 10/09/2026, com 30 dias de leads pagos:

| Conjunto | Leads | Fechados |
|---|---:|---:|
| CONJUNTO 3 - ISRAEL — Cópia | 740 | 18 |
| CONJUNTO 6 - MATEUS — Cópia | 733 | 1 |
| CONJUNTO 4 KAROL — Cópia | 698 | 0 |
| CONJUNTO 5 EDILAN [2] | 538 | 1 |

Volume quase idêntico, desfecho não. É esse contraste que a otimização por
conversão existe para explorar — e é a linha de base contra a qual o piloto
`CONJUNTO - KAROLYNE` (QUALITY_LEAD desde 10/09) vai ser comparado.

**Conjunto pausado continua na tabela** enquanto tiver gasto ou lead na janela.
Escondê-lo faria a soma da tela não bater com a soma da conta de anúncios.

**Nome inválido:** 8 leads têm a mensagem de erro da Graph API (`You don't have
enough permission…`) gravada em `adset_name`. A tela marca a linha como "nome
inválido" em vez de escondê-la: os leads são reais e o gasto por trás também, e
apagá-los da tela apagaria junto o pedido de conserto.

## Funil dos leads de anúncio

`lead_status`, não `status`. Medido em 10/09/2026: **100% dos 3.290 leads pagos
estavam na etapa "Recepção"** do kanban — a etapa não é usada para lead de
anúncio, então contar por ela mostraria uma barra só e nenhuma informação. Quem
se move é o `lead_status`, que é também a coluna que a planilha escreve de volta.

O degrau que mais come lead é o primeiro: 2.879 de 3.290 nunca responderam.

## Rotinas automáticas

O estado dos quatro crons saiu de `index.ts` para
`railway-server/src/lib/estadoDosCrons.ts`, porque agora `/health` e a aba de
Métricas leem o mesmo objeto. "Esse número está velho?" e "a rotina parou?" são a
mesma pergunta vista de dois lados.

Os contadores **zeram a cada deploy** — são de processo, não de banco. Por isso a
tela mostra a última execução, e não o total: `execucoes: 0` logo depois de uma
publicação significa "ainda não rodou nesta versão", não "está parado".

## Gasto sem lead no funil (10/09/2026)

Conferência que só apareceu quando a tabela passou a incluir conjunto pausado:
a soma da coluna de gasto (**R$ 5.577,30**) bate com o total das contas
(**R$ 5.569,67**) — a diferença de R$ 7,63 é o gasto que continua correndo entre
as duas chamadas.

Com a soma fechando, sobra o que não fecha: **R$ 756,70 em 7 dias em 3 conjuntos
que não trouxeram lead nenhum ao CRM.**

| Conjunto | Gasto 7d | Na Meta | No CRM |
|---|---:|---:|---:|
| CONJUNTO 1 | R$ 373,57 | 0 | 0 |
| C1 | R$ 373,01 | 26 | 0 |
| C2-[ESTAGIÁRIO] | R$ 10,12 | 3 | 0 |

Os dois casos pedem conserto diferente, e por isso o card os distingue:

- **formulário na Meta e zero no CRM** (C1, C2) — lead comprado que não chegou ao
  funil. É roteamento: o formulário não está mapeado em `meta-leads-sync` nem cai
  numa aba conhecida da planilha.
- **zero dos dois lados** (CONJUNTO 1) — anúncio consumindo verba sem gerar
  formulário.

O card fica separado da tabela de propósito: numa lista de 24 conjuntos ordenada
por gasto, quem gastou R$ 373 e trouxe zero lead não se distingue de quem gastou
R$ 373 e trouxe 130.

## Filtros: período, funil e acolhedor (10/09/2026)

Os três chegam no corpo da requisição (`{de, ate, funil, acolhedor}`) e são
resolvidos **no servidor**, alcançando os DOIS lados — gasto da Meta e lead do
CRM.

Isso não é detalhe de implementação: um filtro que alcançasse só metade produziria
um custo por lead com numerador de um recorte e denominador de outro. Foi para
isso que o gasto deixou de ser lido agregado por conta e passou a vir por
`level=adset` + `time_increment=1` — dia e conjunto são a menor unidade que os
três recortes conseguem cortar.

### De onde sai cada recorte

| Recorte | Fonte | Por quê |
|---|---|---|
| Período | `de`/`ate`, dia civil de São Paulo | teto de 180 dias; futuro é cortado para hoje |
| Funil | nome da **campanha** (Meta) e nome do **board** (CRM) | "BPC-LOAS" e "BPC - Autismo" são o mesmo funil escrito de dois jeitos |
| Acolhedor | nome do **conjunto** (`leads.adset_name`) | `leads.assigned_to` é nulo nos leads do Externo |

O acolhedor é o caso delicado. Não existe coluna: o vínculo entre um lead pago e
quem o atende é o nome do conjunto de anúncio, escrito à mão por quem monta a
campanha. Medido em 10/09/2026, cobre **3.290 dos 3.291** leads pagos de 30 dias.

`acolhedorDoConjunto` compara **token inteiro**, nunca pedaço: `includes('KAROL')`
casaria dentro de "KAROLINA", e no dia em que existir uma, o número dela entraria
calado no recorte da Karolyne. Há teste para exatamente esse caso.

**KAROL = KAROLYNE.** Há uma só no quadro (Maria Karolyne de Aguiar Nunes), e os
conjuntos usam as duas grafias. Separá-las partiria o número dela em duas linhas
que ninguém saberia somar.

### O que NÃO segue os filtros, e diz isso na tela

- **Saúde da integração** — é configuração da conta, não medição de período.
- **Conversões enviadas à Meta** — é a fila inteira, desde o início.
- **Rotinas automáticas** — são do sistema.
- **"Entraram no funil"** — `entrou_no_crm_em` é coluna, então honra o funil, mas
  não o acolhedor (que é derivado de texto). A legenda avisa.

## O custo por lead da visão "todos" é misturado (10/09/2026)

A conferência dos filtros mostrou que os quatro acolhedores somam 3.250 dos 3.259
leads e os dois funis somam 3.259 de 3.259 — os recortes fecham do lado do CRM.
Do lado do dinheiro, **não**:

| | Gasto 30d |
|---|---:|
| Total nas contas | R$ 27.022,77 |
| BPC-LOAS + Auxílio Acidente | R$ 22.994,73 |
| Fora dos dois funis | R$ 4.028,04 |

As campanhas de fora não são erro de classificação — são outro negócio:
`[CBO][VENDAS][MÃES-ATÍPICAS]`, `[VENDAS][GUIA E KIT]`,
`[VENDAS][CURSO-MÃES-ATÍPICAS]`, `[SEGURO DE VIDA][JOÃO MANOEL]`,
`[CAMPANHA REPRESENTANTE COMERCIAL]`, `BURNOUT GERENTES BANCÁRIOS`.

**O efeito é um custo por lead misturado**: o numerador carrega gasto de venda de
curso e o denominador só conta lead jurídico que chegou ao CRM.

| | |
|---|---:|
| Custo por lead, gasto total ÷ leads pagos | R$ 8,29 |
| Custo por lead, só do que gera lead no CRM | R$ 7,07 |

Medido por outro corte, o mesmo dinheiro: **R$ 4.300,28 em 34 conjuntos que não
trouxeram lead nenhum ao CRM** — 16% do investimento do mês.

### Por que os dois números ficam na tela

A regra da casa proíbe filtrar, zerar ou esconder valor improvável na renderização
(CLAUDE.md, princípios de processo, item 8). Trocar R$ 8,29 por R$ 7,07 seria
trocar um número misturado por outro número parcial, e ainda apagaria o processo
que precisa de conserto.

Então o card de custo mostra o de cima e nomeia a diferença no rodapé, e o card
**"Investimento que não alimenta o CRM"** lista as campanhas agrupadas — conjunto
a conjunto seriam 34 linhas e nenhuma decisão.

**Filtrar por funil resolve de vez**: com o recorte aplicado, BPC-LOAS dá R$ 4,98
por lead e Auxílio Acidente R$ 17,56, cada um dividindo só o próprio gasto.

### O que ainda merece resposta do gestor de tráfego

Dois casos de formulário registrado na Meta que nunca chegou ao CRM:
`[CAMPANHA REPRESENTANTE COMERCIAL]` com **59** e `[CBO][VENDAS][MÃES-ATÍPICAS]`
com **26**. Ou é roteamento faltando, ou é lead de produto que não usa o CRM — e
a diferença entre as duas respostas vale dinheiro.

## Apelidos de compatibilidade (temporário)

Os filtros renomearam campos do payload (`total_7d` → `na_janela`, `gasto_7d` →
`gasto`, e assim por diante). Numa SPA isso **não** é um problema de deploy que
passa em minutos: quem está com a aba aberta continua rodando o bundle antigo até
recarregar, e isso dura horas (ver [[deploy-front-lovable-verificacao]]).

Sem apelido, essa pessoa veria meia tela de "—" e concluiria que o painel quebrou
— pior que o número velho, porque parece defeito de dado.

Então o handler devolve os nomes antigos **junto** com os novos. Eles só são
corretos para a janela padrão (30 dias até hoje), que é a única que o bundle
antigo pede: fora dela vão `null`, em vez de número de outro recorte com nome
antigo.

**Como remover:** conferir que o chunk publicado da página contém "Todos os
acolhedores" (string que só existe na versão com filtros), esperar 24h para as
abas abertas rodarem, e apagar o bloco `compat` do handler e os apelidos
`*_7d`/`*_30d` de `desempenho_por_conjunto`.

## Organização da tela: três abas (11/09/2026)

A aba tinha crescido para onze blocos empilhados — quatro tabelas, dois gráficos,
seis cards — e a pessoa rolava a tela inteira procurando a que queria. Agrupados
por **pergunta**, não por tipo de dado:

| Aba | Responde | O que tem |
|---|---|---|
| **Desempenho** (padrão) | de onde vem contrato | investimento que não alimenta o CRM · por acolhedor · por conjunto · contas de anúncio |
| **Evolução e funil** | como mudou no tempo | dia a dia · funil dos leads de anúncio · funil por status · leads por origem · leads por funil |
| **Integração e sistema** | o encanamento está de pé | saúde da integração · conversões enviadas à Meta · rotinas automáticas |

Filtros e os quatro KPIs ficam **fora** das abas, sempre visíveis: o recorte vale
para as três, e um filtro que some ao trocar de aba faria a pessoa duvidar do
número que está vendo.

O alerta de gasto sem lead abre a aba padrão de propósito — é dinheiro saindo, e
dentro de uma aba secundária ninguém o encontraria.

## A data de fechamento é a da importação (11/09/2026)

Descoberto ao testar o filtro combinado: BPC + Israel + 7 dias devolvia **22
contratos**, o mesmo número da janela de 30 dias. Não era bug do filtro.

```
select became_client_date, count(*) from leads
where lead_status='closed' and adset_name ilike '%ISRAEL%' ...
-> 2026-09-09 | 22
```

**24 dos 28 fechamentos pagos que existem estão em 09/09** — o dia em que o
`sheet_status_sync` leu a coluna de status da planilha pela primeira vez. E os 24
foram atualizados nesse mesmo dia: `became_client_date` guarda a data da
importação, não a do fechamento.

Os fechamentos orgânicos não têm esse problema — espalham-se naturalmente
(31, 25, 20, 18, 14 por dia). É só o lote importado da planilha.

### Por que isso é armadilha, e não número feio

Quem filtrar "últimos 7 dias" na semana que vem vai ver o Israel com **zero**
contratos e concluir que ele parou de fechar. E o gráfico mostra um pico de
fechamento num dia em que ninguém fechou nada.

A tela **detecta** e nomeia: quando um único dia concentra ≥60% dos fechamentos
pagos do período (e são ao menos 5), o card de Fechamentos e a tabela Por
acolhedor exibem o aviso com o dia e a contagem. O valor não é filtrado, zerado
nem corrigido — ver CLAUDE.md, princípios de processo, item 8.

### O conserto de verdade

A planilha precisa carregar a **data do fechamento**, e o `bpc-sheet-sync` gravar
essa data em vez de `now()`. Enquanto não carregar, o aviso é o que impede a
leitura errada — e a comparação entre acolhedores só é honesta em janela que
inclua 09/09.

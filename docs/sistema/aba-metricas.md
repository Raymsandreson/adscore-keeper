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

## Apelidos de compatibilidade — removidos em 14/09/2026

Os nomes antigos (`total_7d`, `gasto_7d`, `ultimos_30d`…) conviveram com os novos
por três dias, para não quebrar a tela de quem estava com a aba aberta no bundle
anterior.

Removidos depois de conferir o chunk publicado: `MetricasPage-CR6jZS-f.js` tem as
abas novas e **zero** ocorrências de qualquer nome antigo. O critério era esse,
não o calendário.

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

## "Ignoradas" não é lista de conserto (11/09/2026)

O card de conversões mostrava 107 ignoradas e dizia "é lista de conserto". Medido:
**nenhuma das 107 tem id da Meta.** Vêm de `whatsapp` (97), `manual` (7),
`instagram` (2) e `Internet` (1) — são fechamentos de lead que nunca veio de
anúncio. A Meta não tem o que casar, e ignorar está certo.

O texto mandava alguém procurar defeito onde não há. Agora a contagem é separada:

- **ignorados_organicos** — lead sem id da Meta. Comportamento correto.
- **ignorados_de_lead_pago** — lead de anúncio sem telefone nem e-mail. *Esses*
  a Meta casaria, e são a lista de conserto de verdade. Hoje: zero.

O `lead_id` dentro de `user_data_hash` é a prova: o normalizador só o grava
quando o lead tem `facebook_lead_id`.

## Lista nominal: aba "Leads e fechamentos" (11/09/2026)

A aba passou a mostrar **lead a lead** e **fechamento a fechamento**, agrupados
por acolhedor. Duas travas, e a razão de cada uma:

**1. Só sai quando pedido (`detalhar: true`).** O painel se atualiza sozinho a
cada minuto; puxar nome e telefone de 2.500 leads a cada ciclo, sem ninguém ter
pedido, é carregar PII de graça. As colunas `lead_name` e `lead_phone` nem entram
no `select` quando o detalhe não foi pedido.

**2. Só sai para quem está logado.** `AUTH_ENFORCE` está **desligado** em
produção — `/functions/metricas-painel` responde a qualquer um que saiba a URL.
Devolver a lista nominal por padrão seria publicar a carteira de clientes numa
URL aberta. O detalhe chama `authorizeFunctionRequest`, que aceita JWT de usuário
logado, chave interna ou de API; o front já injeta o JWT da sessão nas chamadas
ao Railway, então para quem está na aba isso é transparente.

**Telefone sai mascarado** (`•••• 1234`), do servidor, não da tela. Quem precisa
do número inteiro abre o lead no funil, onde existe registro de quem olhou.
Painel de métricas não é lugar de copiar carteira.

### O que deliberadamente não está lá

**"Dias até fechar".** `became_client_date` guarda a data da importação da
planilha, não a do contrato — 24 dos 28 fechamentos pagos caem todos em 09/09.
Qualquer duração calculada daí seria inventada, e com cara de métrica. A legenda
do card diz isso em vez de mostrar o número.

O acolhedor sai do nome do conjunto, então **fechamento de lead orgânico não tem
um** e aparece em "Sem acolhedor identificado", marcado como "não veio de
anúncio" — em vez de ser escondido ou atribuído a alguém por chute.

## A aba cobre só PREV (14/09/2026)

Trabalhista e Previdenciário têm **estrutura de lead diferente, acolhedores
diferentes e origem diferente**. O board de Acidente de Trabalho tem 7.990 leads
vivos e **zero** vindos de formulário de anúncio. Somar os dois num painel que
existe para medir anúncio produzia um "total de leads" que não servia a nenhuma
das duas equipes: a janela de 30 dias trazia 3.100 leads de Trabalhista.

Agora a leitura é escopada: entram só os boards cujo nome mapeia para um funil
conhecido do PREV (`BPC - Autismo`, `Auxílio Acidente`). **Pelo nome, não por
lista de ids** — board novo de BPC passa a contar sozinho, e board de outro
negócio não entra por engano. A tela diz o escopo no cabeçalho e na barra de
filtros.

Os acolhedores de `ACOLHEDORES` (Israel, Mateus, Karolyne, Edilan) são os do
PREV. Trabalhista tem outros, e quando entrar precisará da sua própria lista.

### O defeito que isso expôs

`funilDoNome` casava por token solto, e `ACIDENTE` casa "Acidente de Trabalho".
Medido em 14/09/2026: filtrar a aba por "Auxílio Acidente" devolvia **3.224 leads
do board de Acidente de Trabalho contra 544 do funil de verdade** — 86% do
recorte era o funil errado, e o custo por lead daquele recorte estava dividindo
gasto de Auxílio Acidente por leads de Trabalhista.

A regra passou a ser por **grupos de tokens**: "ou" dentro do grupo, "e" entre
grupos. `auxilio_acidente` exige `ACIDENTE` **e** (`AUXILIO` ou `AUX`). Isso
separa sem lista negra:

| Nome | Antes | Agora |
|---|---|---|
| `[AUXÍLIO-ACIDENTE]` | auxilio_acidente | auxilio_acidente |
| `AUXÍLIO - ACIDENTE [EDILAN]` | auxilio_acidente | auxilio_acidente |
| `Acidente de Trabalho` | **auxilio_acidente** | — |
| `[SEGURO ACIDENTE DE TRÂNSITO]` | **auxilio_acidente** | — |
| `[ANALYNE][ACD. DE TRABALHO]` | — | — |

Há teste para cada uma dessas linhas.

## O escopo valia só para metade da conta (15/09/2026)

O recorte de 14/09 deixou o **lado do CRM** em PREV e esqueceu o **lado do
dinheiro**: o gasto continuava vindo das contas inteiras. A tela dizia "esta aba
cobre só PREV" no cabeçalho e, logo abaixo, exibia um investimento que somava
Trabalhista e venda de curso.

Medido no dia, janela de 30 dias:

| | |
|---|---:|
| As contas gastaram | R$ 25.604,91 |
| Campanha de PREV | R$ 21.539,97 |
| Outro negócio | **R$ 4.064,94 (15,9%)** |
| Custo por lead publicado | R$ 9,13 |
| Custo por lead do mesmo escopo | R$ 7,68 |

`[ANALYNE][ACD. DE TRABALHO]` sozinha punha R$ 1.656,82 no numerador de um CPL
cujo denominador não tem um único lead de Trabalhista.

Numerador de um universo dividido por denominador de outro não é um número
conservador — é um número que não existe. Agora `investimento.na_janela` é só
campanha do escopo, e o resto vai inteiro para `investimento.fora_do_escopo`,
agrupado por campanha no card **"Fora do escopo desta aba"**. Sair da conta não
é sumir da tela: é a mesma carteira, e quem olha precisa saber que ela gastou
mais do que o card de cima mostra.

Efeito colateral bom: o card "Investimento que não alimenta o CRM" deixou de
misturar duas coisas. Ele listava R$ 4.166 somando campanha de curso (que nunca
teve roteamento para o CRM, e nem deveria) com conjunto do próprio funil que
gastou e não trouxe lead. Só o segundo é lista de conserto, e agora só ele está
lá.

### "Entraram no funil" contava o banco inteiro

`contaEntradas` nunca recebeu `idsPrev` — só filtrava board quando havia funil
pedido. Publicava **7.325** ao lado de **3.018 leads**, e os 7.325 incluíam
Trabalhista e todo board que não é desta aba. Com o escopo aplicado: **4.188**.

A diferença que sobra é a que o número existe para mostrar — lead que entrou no
CRM agora com formulário de semanas atrás — e não mais a mistura de dois
universos dentro do mesmo card.

### POP não é funil de captação

`funilDoNome` casa pelo nome, e `POP - BPC (Administrativo e Judicial)` tem
"BPC". O board entrava no escopo e aparecia no rótulo da tela como se fosse
porta de entrada. Medido: **174 leads no board, zero** com id da Meta ou origem
de planilha; os 10 da janela vieram todos de `whatsapp`.

`ehBoardDeCaptacao` (puro, com teste) recusa board desativado e board cujo nome
**começa** com POP. Pelo prefixo: "BPC POPULAR" e "Auxílio Acidente (migrado do
POP em 2026)" continuam entrando, e POP novo sai sozinho.

## Conjunto sem acolhedor deixou de sumir (15/09/2026)

`ACOLHEDORES` é lista fixa de propósito — comparar token inteiro contra uma lista
conhecida é o que impede "KAROLINA" de entrar calada no número da Karolyne. O
preço era o conjunto de nome novo não casar ninguém e **sumir da tabela**.

`CONJUNTO 7 - TAFFAREL` nasceu em 11/09 e em quatro dias já trazia **61 leads e
R$ 383,23** que não apareciam em linha nenhuma: a coluna "leads" somava 2.745
contra 2.806 pagos, e nada na tela dizia onde estavam os 61 que faltavam.

A tabela ganhou a linha **"Sem acolhedor identificado"**, com os conjuntos
nomeados embaixo. Ela não é clicável — não existe chave para filtrar por
"ninguém" — e existe para que a soma da tabela feche com os cards de cima. É a
classe do problema que fica resolvida: conjunto novo aparece no dia em que gasta
o primeiro real, pedindo cadastro, em vez de virar diferença inexplicada.

**Taffarel não entrou na lista de acolhedores**: não existe perfil com esse nome
no roster do Externo, e inventar o vínculo seria pior que mostrá-lo como
pendente.

## A porta, fechada em 15/09/2026

O painel respondia a **qualquer um que soubesse a URL**. Não era teoria: um
`curl` anônimo de fora devolvia 200 com o investimento do mês, o custo por
contrato e o desempenho de cada acolhedor — e o `/health` registrou a chamada
como `missing_por_funcao: {metricas-painel: 1}`, o que confirma que não havia
porta, só a contagem.

O agregado ser anônimo era o motivo pelo qual só a **lista nominal** exigia
credencial. Agora a exigência é da função inteira: `authorizeFunctionRequest` na
primeira linha do handler, 401 com o motivo quando falta. O bloco do detalhe
deixou de reverificar — quem chega lá já apresentou credencial.

### Por que não foi ligando o `RAILWAY_AUTH_ENFORCE`

Porque ele é do **serviço inteiro**, não de uma função. Ligá-lo hoje derruba
junto quem ainda chama sem credencial — o placar do `/health` mostra 13 chamadas
de `meta-call-queue-processor` nessa situação. O gate local fecha esta porta sem
esperar a limpeza das outras, e continua valendo depois que o enforce global for
ligado.

Fechar aqui é seguro porque a função tem **um chamador**: a aba, pelo
`functionRouter`, que injeta o JWT da sessão do Cloud em `Authorization` sozinho
(`invokeFunction` → `getSession()`). Nenhum cron, nenhuma edge, nenhum webhook —
conferido no repo inteiro. Quem está logado não percebe diferença.

Na tela, o 401 tem uma causa prática só: a sessão expirou com a aba aberta (o
painel se recarrega a cada minuto, então ele aparece bem depois de a pessoa ter
parado de mexer). A mensagem diz isso — "sua sessão expirou, entre de novo" — em
vez do erro cru do Railway, que mandaria procurar defeito onde não há.

### Quem pode abrir a tela

`/metricas` estava só sob `ProtectedRoute` sem módulo: qualquer pessoa logada
via investimento, custo por contrato e a carteira por acolhedor. Passou a exigir
o módulo **`finance`**, o mesmo do menu onde a rota vive. Admin passa sempre.

`MODULE_DEFINITIONS` não tem entrada para `/metricas`, então a detecção
automática por rota não alcançava esta tela — o módulo vai explícito no
`requiredModule`.

Duas coisas que ficaram **de fora** de propósito, e continuam valendo:

- **O menu não filtra.** O item "Métricas" aparece para todo mundo e quem não
  tem `finance` recebe "Acesso Restrito" ao clicar. É o comportamento de todo o
  resto do app (ver memória `dois-bloqueios-de-acesso-distintos`); consertar só
  aqui criaria uma exceção sem consertar a classe.
- **`/cost-organization` segue sem módulo**, na mesma seção do menu. Não foi
  tocada porque não era o que se pediu — mas é o mesmo buraco.

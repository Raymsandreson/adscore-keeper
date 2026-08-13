---
name: marcos-pop-e-captura
description: Use SEMPRE que a tarefa envolver marcos processuais, fases de POP, jurimetria, valor de carteira, ou a captura automática (e-mail push, DataJud, Escavador). Guarda as três armadilhas que já custaram caro — número inflado 2,6x, estado virando fase e cron que falha em silêncio. Acione ao ouvir "marco", "fase do POP", "jurimetria", "carteira", "quanto vale", "Escavador", "DataJud", "push", "atualização de processo", "movimentação".
---

# Marcos, POP e captura automática

Metáfora: o **marco** é a placa de quilometragem da estrada — diz onde o processo está.
O **POP** é o manual de bordo — diz o que a equipe faz naquele trecho. Desde ago/2026 são
a mesma coisa: cada fase do POP É um marco. A **captura** é quem lê as placas por nós.

---

## 1. Marco é fase. Estado não é marco.

Regra do usuário, literal: *"marco pela etimologia da palavra não pode ser um estado"*.

| Isto é fase (marco) | Isto é estado (resultado) |
|---|---|
| Ajuizamento, Audiência inicial, Perícia, Sentença, Recurso, TST, Execução, Alvará, Arquivamento | **Acordo homologado**, **Suspensão** |

Estado ganha `atravessa_fases = true` e **nunca** entra no cálculo da fase atual.

```sql
-- certo: fase atual ignora quem atravessa
where not atravessa_fases
order by cnj_num, ordem desc, data_detectada desc
```

**Por que importa:** Acordo (ordem 26) e Suspensão (27) têm a maior ordem da régua. Como
"maior ordem vence", eles apareciam como fase atual de **61 processos**, escondendo onde
esses processos estavam de verdade. Acordo homologado no TST não põe o processo numa fase
"acordo" — ele continua no TST, com um acordo. Viraram coluna (`tem_acordo`, `suspenso`).

### O que mais mudou junto
- "Status possíveis do POP" → **"Resultados possíveis do POP"**, e cada resultado pode
  declarar `estagio` financeiro próprio. Sem isso, Indeferido/Extinto/Desistido eram
  carimbados como CONDENAÇÃO — os quatro compartilham trânsito em julgado.
- "Instrução e Julgamento" se parte em três: Perícia, Audiência de instrução, Sentença.
- Todas as fases ficam visíveis sempre.
- **Responsável em cascata** — `src/lib/popResponsavel.ts`: passo → objetivo → fase →
  processo. Definir no nível de cima vale para tudo abaixo sem responsável próprio.
- **Prazo por passo** — `src/lib/popPrazo.ts`: dias úteis, dias corridos ou meses.
  Feriado **não** é considerado; está declarado no arquivo.

Tabelas: `pop_marcos`, `pop_marco_sinais` (Externo). POP de referência: board
`Trabalhistas judicial — marcos (rascunho)`.

**Pendente:** migrar os 703 checklists com trabalho já feito para as fases-marco. Plano em
`supabase/migrations-external/PLANO_20260808_migrar_checklists_para_fase_marco.sql` — o
prefixo `PLANO_` existe para **não** rodar sozinho.

---

## 1b. A régua manda na fase e no percentual (12/08/2026)

Antes: o % da ficha vinha de **passo marcado à mão** (`calculateHierarchicalProgress`)
e `workflow_stage_id` estava null em **1848 de 1848** processos — ninguém movia fase.
Processo no TST desde maio aparecia com 8% na fase 1.

Agora: `process_pop_marcos` (materializada de `vw_pop_marcos_regua`) → fase e
percentual. `pop_marcos_tick()` roda aos **:15 e :45** (cron `pop-marcos-tick`),
atrás dos crons de captura. Primeiro tick: **1430 marcos, 401 processos posicionados**.

```
% = marcos cumpridos ÷ marcos PREVISTOS deste processo
    previsto = obrigatório, ou eventual que aconteceu
    cumprido = detectado, ou obrigatório anterior ao marco atual ("presumido")
```

O **presumido** existe porque `lead_processes.movimentacoes` guarda no máximo **20**
movimentações (367 processos estão exatos em 20): é janela do recente, não histórico.
Sem ele o percentual cairia sozinho conforme a movimentação velha sai da janela.

**Duas medidas, dois nomes.** Régua = ANDAMENTO do processo (barra da ficha).
Passos = TRABALHO da equipe (percentual por objetivo e `team_process_goals_progress`,
que **não** mudou). Não junte as duas num número só.

### As quatro leituras, e a que faltava

| fonte | processos | o que dá |
|---|---|---|
| `movimento` (TPU/DataJud) | 183 | código determinístico |
| `escavador_texto` | **274** | `classificacao_predita.nome` — a maior cobertura |
| `movimento_grau` | 87 | subida de instância pelo `grau` |
| `documento` | 74 | título em `jm_documentos` |
| `escavador_grau` | 58 | subida pelo `fonte.grau` (1/2/3) |

O Escavador tem código TPU em **0%** das 7.284 movimentações e classificação em
**100%** — por isso o tipo `'texto'`, criado em 08/08 e vazio até aqui. Nunca
tente casar TPU nele.

**Marcos de subida** (`remessa_2grau` ordem 8, `remessa_superior` ordem 12) marcam a
CHEGADA, não o julgamento. Sem eles, processo que subiu e está esperando ficava
carimbado na instância de baixo — era o sintoma do caso que abriu a investigação.

**Sinal de grau vale nas duas fontes.** Só no Escavador, a subida ao TST do
0016855-58.2023.5.16.0008 saía como 31/07; com o DataJud junto, 14/05 — a data certa.
Consolidação vence pela **menor data**, empate desempata por TPU.

**Armadilha repetida:** `suspensao` estava com `atravessa_fases = false` no POP em uso
e, tendo a maior ordem (21), sequestrou a fase de 9 processos no primeiro tick. Mesmo
erro dos 61 de julho. Marco novo que é ESTADO nasce com `atravessa_fases = true` —
está no checklist do fim deste arquivo por um motivo.

**A carteira não foi tocada:** `vw_pop_carteira_por_fase` lê o board **rascunho**
(`Trabalhistas judicial — marcos (rascunho)`), e as mudanças acima são todas no board
**em uso** (`b436c043-…624816`) e em views novas. Antes de mexer em marco, confira em
qual board você está.

---

## 2. Nunca some `jm_valores` direto

`jm_valores` tem **uma linha por (decisão × cliente)**. Cada decisão que confirma o valor
cria linha nova para a mesma pessoa — MARIA aparece com R$ 550.000 na sentença e mais
R$ 550.000 nos embargos. É o mesmo dinheiro, dito duas vezes.

```
soma bruta ....................... R$ 83.228.467
última decisão de cada cliente ... R$ 31.622.209   ← o número certo
```

**2,6x inflado, e para cima** — o pior lado para número que vai a relatório de fundo.

```sql
-- sempre assim
select distinct on (v.processo_cnj, v.cliente) ...
  order by v.processo_cnj, v.cliente, d.data_decisao desc nulls last
```

O join com `lead_processes` duplica de novo (26 números repetidos, um deles 4×) — também
pede `DISTINCT ON`. Granularidade é **(processo × cliente)** por litisconsórcio: ao
agrupar, processos contam distintos e valores somam.

**Limite conhecido:** o número é "quanto o processo vale", **não** "quanto entra no caixa"
— não separa cota do cliente de honorário do escritório. Ao apresentar, diga isso.

Tela: `src/pages/CarteiraPorFasePage.tsx` · view: `vw_pop_carteira_por_fase`.

---

## 3. A cadeia de captura, na ordem

```
e-mail push  →  DataJud  →  Escavador
(quem mexeu)    (o que      (o documento,
                mudou, e     só de quem
                se tem doc)  tem)
```

| Fonte | Custo | Tempo real? | Traz |
|---|---|---|---|
| E-mail push (Gmail) | zero | sim | o **gatilho**: quem teve movimentação |
| DataJud (CNJ) | zero | **não** — piso de 8 dias | código TPU da movimentação |
| Escavador | R$ 0,20 público | sim | o documento em si |

Não são redundantes: o DataJud dá o código de graça, o Escavador dá o documento e o tempo
real. Roda **uma vez por dia à meia-noite BRT** = `0 3 * * *` no cron (o servidor é UTC).

### "O DataJud é necessário, se nem tempo real ele é?"

Pergunta recorrente do usuário. Resposta medida em 12/08/2026, para não responder de
memória na próxima vez:

```
atraso do DataJud (317 processos, último movimento de cada um)
  mínimo em toda a base ......  8 dias
  mediana ....................  64 dias
  com movimento de até 8 dias ... 1 de 317
```

Ele não está na cadeia para **avisar** — está para **classificar**. É a única fonte com o
código TPU: `jm_movimentos` tem 39.244 linhas, **100% `fonte='datajud'`**, 39.082 com
código. E-mail chega em texto livre; Escavador devolve documento e estado, nenhum dos dois
traz o código. Cruzando com a carteira de 344 processos:

| marco veio de | processos |
|---|---|
| código TPU (DataJud) | 317 |
| documento + IA (Escavador) | 27 (26 sobrepostos) |
| **só existe por causa do DataJud** | **291** |

Ressalva ao citar esse corte: o Escavador tem documento em 219 processos mas a IA só leu
71 (`pop_marco_extracoes`) — a rota do documento está subutilizada, não esgotada. Ainda
assim 125 processos não têm documento nenhum, e leitura por IA custa token por documento
enquanto o DataJud custa zero. **Desligar o DataJud não economiza nada e cega a régua.**

Painel: `CapturaStatusPanel` no sino, view `vw_jm_captura_status`. O gasto exibido não é
estimativa — vem de `jm_esc_solicitacoes.creditos`, o que a própria API devolve.

A ordem das barras é a da cadeia (e-mail → DataJud → Escavador), e quem manda nela é a
constante `ORDEM_DA_CADEIA` no componente: a view é `UNION ALL` **sem `ORDER BY`**, então
a ordem que ela devolve é a de escrita (o pago em cima) e não é garantida. Ler de cima
para baixo tem que ser ler o funil.

Desde 12/08/2026 o painel **vem recolhido**: as três barras comiam um terço da tela do
celular antes da primeira movimentação aparecer. Abre no clique do título e a escolha fica
salva em `localStorage['jm.captura-status.aberto']`, por navegador. Fechado, a barra ainda
diz `· N na fila` ou, havendo falha, `⚠ N com erro` em âmbar — esse resumo é o que impede
o painel de virar decoração: fila parada não avisa sozinha, foi o que custou o mês entre
09/07 e 11/08. Se um dia mexer nesse componente, mantenha o resumo da barra fechada.

### O que o card do sino escreve embaixo do processo

`process_updates.descricao` mistura duas naturezas, e quem for mexer no card precisa saber
separar (`resumoMovimentacao.ts`, com teste dos padrões reais):

| Natureza | Exemplo | No card |
|---|---|---|
| Teor do tribunal | `Distribuído por sorteio`, `Proferido despacho de mero expediente` | assunto, em destaque |
| Ruído do push por e-mail | `[TRT15] [PUSH] Atualizações de Informações Processuais do Processo <CNJ>` | `aviso por e-mail · TRT15`, miúdo |

Medido em 12/08/2026 sobre os 30 dias anteriores: **327 com teor (67%) contra 161 de ruído
(33%)**. O assunto já existia na maioria dos cards — estava só com o mesmo peso visual do
lixo que repetia o número do processo impresso duas linhas acima.

#### O teor do push estava no e-mail o tempo todo (12/08/2026)

A linha de cima dizia que não dava para tirar assunto das linhas de push — e a razão estava
errada. Não faltava dado: faltava parser. O PJe/TST/TRT manda o teor num bloco `Eventos:`
em **linha corrida**, sem a tabela de `|` que o `parsePje` lia:

```
Eventos: Data Evento 06/08/2026 00:14 Decorrido o prazo de CGB ENERGIA LTDA em 05/08/2026
05/08/2026 00:26 Documento sigiloso  Para acessar este processo na consulta pública...
```

São **804 dos 4.203** e-mails da caixa nesse layout, contra 166 no de tabela. Sem casar,
caíam no fallback do assunto — **1.083 linhas** (74,5% das de `origem='email_push'`) tinham
como descrição o próprio assunto do e-mail. Nenhuma delas gerou notificação ao cliente nem
virou atividade: card que não diz o que aconteceu não gera ação.

Hoje `extrairEventosInline` + `resumirEventos` (em `_shared/emailPushParser.ts`, com teste
sobre corpos reais) transformam o e-mail em **UMA** linha do feed:

- `titulo` = o primeiro evento que diz alguma coisa (`Documento sigiloso` nunca vira título);
- `descricao` = os eventos distintos com `(Nx)` nos repetidos;
- `eventos` (jsonb, migration `20260812150000`) = a lista inteira, consultável no card;
- `data_movimentacao` = a do evento **mais recente** do lote.

Uma linha por e-mail, não uma por evento: a média é de 4,1 eventos por push (um chegou a
27), e granular o sino viraria uma parede de "Documento sigiloso".

O que continua valendo: **o texto TPU do DataJud não serve para isso**. Está em
`jm_movimentos.nome` e vive dias atrasado — em 12/08 o movimento mais novo era de 03/08.
Antes de prometer resumo vindo dali, rode:

```sql
select max(data_hora)::date as movimento_mais_novo, count(distinct processo_cnj) as processos
from jm_movimentos;
```

### O card responde "e agora?" sem sair do lugar

`UpdateDetalhe.tsx` abre dentro do próprio card (nada de aba nova, nada de `navigate`) e traz,
nesta ordem: os **eventos** do tribunal com data e hora; o **passo em aberto do POP** daquele
processo (via `fetchLeadSteps`, de graça, só quando o card é aberto — são 4 consultas por
movimentação e o sino carrega 100); e, sob clique, a **dica da IA** (`activity-from-movement`,
a mesma da aba de movimentações do processo) lendo os eventos + o POP. Sem POP, cai na fase da
régua de marcos (`fetchFaseProcessual`).

A IA é botão e não automático de propósito: 100 cards por abertura do sino seriam 100 chamadas
para movimentação que ninguém foi ler.

#### O resumo é escrito na captura, não no render (12/08/2026)

Aquele limite ("100 cards = 100 chamadas") vale para o **render**, não para a chegada. Por isso
o resumo do que o tribunal disse vive numa **coluna**: `process_updates.resumo_ia` +
`resumo_ia_at` (migration `20260812210000`), preenchida pelo cron do Railway
`summarize-process-updates` — 20 por rodada, de 10 em 10 minutos. O card lê texto do banco e
não custa chamada nenhuma; a fila vazia não chama IA.

Ganho medido na primeira rodada em produção (20 de 20 resumidas):

| descrição no banco | resumo gerado |
|---|---|
| `Expedido(a) notificação a(o) <NOME>` | audiência de encerramento designada para 03/12 às 08:00, despacho indeferiu segredo de justiça |
| `Remetidos os autos para Centro Judiciário…` | autos ao CEJUSC para conciliação **e** nova audiência em 07/10 às 08h50 |

**A data e a hora não estavam na `descricao`** — vieram do e-mail. É a prova de que o
histórico de `processual_emails` (casado por `process_number`; 191 das 192 movimentações da
semana têm e-mail casado) é onde está o teor.

Três decisões que não se devem desfazer sem pensar:

- `resumo_ia_at` é carimbado **mesmo quando a IA não devolve texto** — é o que tira a linha da
  fila. Filtrar por `resumo_ia is null` faria o varredor tentar as mesmas linhas para sempre.
  Falha de *provider*, ao contrário, **não** carimba: essa volta na próxima rodada.
- Janela de `SUMMARIZE_UPDATES_WINDOW_DAYS` (30). Sem ela, ligar a coluna joga 2.057
  movimentações históricas na fila de uma vez (~17 h de varredura) para resumir processo que
  ninguém vai reabrir. Com a janela: 569.
- A coluna entrou como o **primeiro degrau de recuo** do select (`COLUNAS_SEM_RESUMO`), antes
  de eventos e esfera. Coluna que falta derruba o select inteiro em silêncio — foi assim com
  `callback_at` em `lead_activities`.

#### A dica de IA lê o processo inteiro

`activity-from-movement` aceita `include_email_history: true` (opt-in — a mesma função atende a
aba de movimentações do processo, e mudar o contexto de todos mudaria a saída de quem não
pediu). Com a flag, `lib/processual-email-context.ts` busca os e-mails daquele CNJ no Externo;
o sino manda junto as **atividades anteriores** do processo e o passo do POP.

Tetos obrigatórios, não cosméticos: 10 e-mails, 2,5 mil caracteres por e-mail, 14 mil no total.
A média por processo é 7,8 mil caracteres, mas o maior soma **650 mil** — sem corte, um único
caso estoura o request e a dica quebra para todo mundo.

### Avisar o cliente é por CLIENTE, não por movimentação

O botão "Notificar" do card manda uma mensagem e cria uma atividade. Em 7 dias isso eram 43
movimentações para 30 clientes — 43 confirmações na mão, e sete clientes recebendo duas ou mais
mensagens seguidas (um deles seis). Na prática **1** das 73 foi avisada: o manual não escala.

O modo lote ("Selecionar" no topo do sino) agrupa por lead e consolida em `notificacaoEmLote.ts`:
registros em ordem cronológica, glossário uma vez só, e o "próximo passo" da movimentação de
maior peso (`PESO`: decisão > audiência > perícia > prazo > despacho > movimentação — a audiência
manda na mensagem, não a juntada que caiu depois dela). Uma mensagem e uma atividade por cliente.

- O disparo é **em série com 1,5 s** entre clientes, a mesma cadência de `useBroadcastLists` —
  30 mensagens de uma vez pela mesma instância derruba o número da firma.
- A atividade nasce **no envio**, não no preparo: quem desistir na revisão não pode deixar
  trinta atividades órfãs no nome de quem clicou.
- Nada é automático, e não deve ser: 81% das movimentações são rotina, e o texto do tribunal vai
  **citado** ao cliente. Aviso automático em cima disso é mandar o teor de um processo ao grupo
  sem ninguém ter lido.

### Armadilha: o feed do sino ordenado por `created_at`

`useProcessUpdates` busca as **100 mais recentes** (`FETCH_LIMIT`). Enquanto essa ordem foi
`created_at desc`, o backfill do Escavador/DataJud — que insere linha **nova** com
movimentação **velha** — tomava as 100 vagas e empurrava o que era do dia para fora.

Em 12/08/2026 o banco tinha 22 movimentações do dia e 26 do dia anterior; o sino carregava
**3 e 0**, e o filtro "Hoje" abria com 3 cards sem nenhum erro em log:

```sql
-- o que o sino REALMENTE carrega vs. o que existe: rode os dois e compare
with carregadas as (
  select coalesce(data_movimentacao::date, created_at::date) as dia
  from process_updates order by data_movimentacao desc nulls last, created_at desc limit 100
)
select count(*) filter (where dia = current_date) as hoje,
       count(*) filter (where dia = current_date - 1) as ontem from carregadas;

select count(*) filter (where coalesce(data_movimentacao::date, created_at::date) = current_date) as hoje,
       count(*) filter (where coalesce(data_movimentacao::date, created_at::date) = current_date - 1) as ontem
from process_updates;
```

A ordem agora é `data_movimentacao desc nulls last, created_at desc` — a mesma data que o
card mostra e que o filtro de período lê. Regra geral: **ordenar pela data do fato, não pela
data da linha**, sempre que houver backfill alimentando a tabela.

Consequência que fica: Hoje, Ontem e 7 dias cabem nas 100 e os chips são exatos; 30 dias
(488) e Tudo (2334) não cabem e aparecem como `100+`. Se um dia precisar do número exato
desses dois, é contagem agregada no servidor — não adianta subir o `FETCH_LIMIT`, que
engorda também as queries `in(ids)` de leitura e de notificação.

### Armadilha: cron que falha em silêncio

A URL certa do Railway é **`adscore-keeper-production.up.railway.app`**. Vários crons
antigos nasceram com `adscore-railway-production` (não existe) e levavam 404
`Application not found` a cada disparo — por duas semanas, sem uma linha de log.

Motivo: `net.http_post` só **enfileira** a chamada. Ninguém lê `net._http_response`. O
erro volta para o vazio.

```sql
-- diagnóstico: dispare na mão e LEIA a resposta pelo id retornado
select net.http_post(url := '...', headers := '...', body := '{}'::jsonb);  -- devolve id
select status_code, left(content::text, 400) from net._http_response where id = <id>;
```

Sintoma: painel do sino com **zero em todas as filas** enquanto o Gmail recebe dezenas de
push por dia. Antes de suspeitar de token vencido ou edge não deployada, cheque a URL.

`net._http_response` também **expira em ~6h** — resposta perdida trava a fila para sempre.

**Pendente:** a caixa administrativa (`inbox#3` — INSS, MPT, relatórios de investigação de
acidente) tem `body_text` preenchido, mas nenhuma IA lê esse texto. Nenhum POP
administrativo tem marco cadastrado; o tipo `'texto'` em `pop_marco_sinais` foi criado
para isso e está vazio.

---

## Checklist antes de entregar

- [ ] Marco novo que é estado ganhou `atravessa_fases = true`?
- [ ] Toda soma de valor passa por `distinct on (processo_cnj, cliente)`?
- [ ] Ao mostrar dinheiro, ficou claro que é valor do processo e não caixa do escritório?
- [ ] Cron novo: a URL foi conferida disparando e **lendo** `net._http_response`?
- [ ] Código TPU: 237/238/239 é provimento em 2º grau. 219/220/221 é procedência, **só G1**.
- [ ] Audiência só conta com complemento `realizada` — designada não é marco (840
      designadas vs 526 realizadas; contar designação dava mediana de 7 dias).

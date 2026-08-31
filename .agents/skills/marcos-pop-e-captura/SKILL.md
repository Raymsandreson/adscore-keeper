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
- **Responsável por CARGO (13/08/2026)** — o jeito principal de designar. Cada nível
  aponta um cargo ("Advogado de audiência") e a pessoa é resolvida NA HORA pelo time
  vinculado ao POP (`settings.responsible_team_id` → `teams` → `team_member_cargos`,
  Externo) — trocar quem ocupa o cargo no time atualiza todos os POPs de uma vez.
  Pessoa explícita no mesmo nível vence o cargo (exceção legítima); cargo sem ocupante
  ou com 2+ (empate) desce a cascata. Resolução: `resolverResponsavelComCargos`
  (popResponsavel.ts) + `src/lib/popCargo.ts`. Persistência SEM migration: fase em
  `stages[].assigneeCargo`, passo em `items[].assigneeCargo`, objetivo em
  `settings.objetivo_cargos` ("stageId|templateId"). **Time vinculado é OBRIGATÓRIO
  em POP** (save e autosave bloqueiam sem ele). A IA (generate/edit-workflow, Railway)
  atribui por cargo e sugere cargos faltantes (`sugestoes_cargos`). Atenção:
  `team_member_cargos` é chaveado por NOME do time — renomear pelo TeamsManager migra
  as linhas junto (13/08/2026); rename por SQL direto ainda órfã.
- **Seção "Time e cargos" no editor de POP (13/08/2026)** —
  `PopTeamCargosSection.tsx`, logo abaixo do seletor de time: membros do time
  vinculado com cargo editável inline (upsert em `team_member_cargos`, mesma chave
  do TeamsManager), incluir pessoa no time e criar time novo sem sair do POP
  (insert no Cloud + `sync_teams_snapshot` pro Externo antes de vincular). Editar
  cargo ali recarrega o CargoMap dos seletores na hora (`cargoMapVersion`).
  Decisão de arquitetura: time é entidade GLOBAL (criado em Membros OU no POP,
  mesmas tabelas) — o POP só vincula e edita; não existe cadastro paralelo. A IA
  continua atuando DENTRO do POP (já recebe marcos, objetivos, passos e cargos).
  Contexto: em 13/08/2026 `team_member_cargos` estava com 0 linhas em produção —
  ninguém preenchia cargo porque a única porta era Configurações → Times.
  - **Ponte com o plano de carreira**: o campo de cargo sugere os cargos formais
    (`job_positions`, Cloud — datalist); nome que casa mostra a DESCRIÇÃO
    (atribuições) e o PLANO DE CRESCIMENTO (`career_plans` + nível) embaixo do
    campo, com botão pra vincular a pessoa (`member_positions`). Cargo sem ficha
    formal ganha aviso âmbar + "Criar ficha do cargo" (descrição + plano) inline.
    Escrita em job_positions/member_positions é ADMIN-ONLY por RLS — a seção
    trata a recusa com toast, não quebra. Duas dimensões que NÃO se fundem:
    `team_member_cargos` = quem faz o quê NESTE time (resolve responsável do
    POP); `job_positions` = ficha formal da função (descrição, salário, trilha).
    A ligação é por NOME do cargo, e a IA já lê as duas (buildTeamForAI).
  - **Sugestão de cargo da IA CRIA cargo ao confirmar** (`CargoSugestoesCard`,
    no card âmbar): cada sugestão tem seletor "quem assume?" (opcional) +
    botão Criar — nasce a ficha formal com o motivo da IA como descrição e,
    com ocupante escolhido, o cargo do time junto. Pra isso funcionar sem
    ocupante, `fetchCargoMap` passou a INCLUIR os cargos formais ativos
    (job_positions) nas opções — sem ocupante não resolve pessoa (cascata
    segue) e o seletor mostra "— ninguém no time". Fluxo completo: IA sugere →
    confirma (cria) → IA/usuário atribui nos passos → pessoa é definida na
    seção "Time e cargos" quando o usuário decidir.
- **Prazo por passo** — `src/lib/popPrazo.ts`: dias úteis, dias corridos ou meses.
  Feriado **não** é considerado; está declarado no arquivo.
- **IA do POP atribui responsável e prazo** (ago/2026) — criar/editar com IA no
  `WorkflowBuilder` envia a equipe (cargo por time de `team_member_cargos` no Externo +
  cargo formal com atribuições de `job_positions`/`member_positions` no Cloud) e a IA
  pode setar `assigneeId` nos três níveis (preferindo o mais alto da cascata) e
  `prazoValor`/`prazoUnidade` por passo. Id que não é de perfil real é descartado no
  front. Se o POP exigir função que nenhum cargo cobre, a IA devolve `sugestoes_cargos`
  (card âmbar ao lado do changelog). As duas functions rodam no **Railway**
  (`railway-server/src/functions/{generate,edit}-workflow.ts`); as cópias do Cloud são
  fallback sem esses campos. **Armadilha (13/08/2026): a IA devolve o fluxo COMPLETO
  numa function call — com `max_tokens: 16000` o POP trabalhista (173 passos, ~41k
  chars de items) estourava MAX_TOKENS, o Gemini não devolvia tool_call nenhuma e a
  edição "não fazia nada"** (só um toast genérico). Hoje: teto de 60k e o erro
  devolve o finish_reason. Se voltar a "não fazer nada", olhe o log do Railway por
  `[edit-workflow] sem tool_call`. Armadilha irmã: a edição por IA expandia TODAS
  as fases/objetivos — 173 passos no DOM de uma vez travavam o celular; hoje
  preserva o recolhido/expandido anterior e só o que a IA criou abre expandido. Armadilha corrigida junto: a edição por IA reconstruía as
  fases e **zerava** responsáveis, prazos, messageTemplates e stagnationDays — hoje o
  front restaura do estado anterior tudo que a IA omitir.

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

### As leituras (5 desde 14/08/2026)

| fonte | processos (14/08) | o que dá |
|---|---|---|
| `movimento` (TPU/DataJud) | 197 | código determinístico |
| `escavador_texto` | **372** | `classificacao_predita.nome` — a maior cobertura |
| `escavador_grau` | 88 | subida pelo `fonte.grau` (1/2/3) |
| `documento` | 78 | título em `jm_documentos` |
| `campo_processo` | 36 | **ajuizamento pela CAPA** (`data_distribuicao`/`data_inicio`), prioridade 3 — só vale se nenhuma movimentação detectou. Existe porque a janela de 20 expulsa a distribuição dos processos antigos (66 trabalhistas só tinham expediente na janela). |

### A régua saiu do POP trabalhista (14/08/2026)

285 dos 681 processos com CNJ estavam sem marco NENHUM — 217 deles COM
movimentação do Escavador baixada. Causa: a régua só materializa marco se o
POP do processo tiver `pop_marcos`, e só o trabalhista tinha. Migration
`20260814130000_marcos_escavador_todos_os_pops.sql`:

- Régua **previdenciária judicial** (14 fases + acordo/suspensão como estados,
  SEM audiência de conciliação) em 6 POPs: BPC JUDICIAL, POP - BPC -
  Administrativo (93 CNJs judicializados moravam lá), Salário Maternidade,
  Auxílio Doença, Auxílio Acidente (board judicial), Pensão por Morte.
- Régua **cível** (idem + conciliação do art. 334) em Justiça Comum e Seguro.
- Sinais copiados **por chave** do board trabalhista em uso — as chaves são
  as mesmas de propósito; chave exclusiva do trabalhista fica de fora pelo join.
- Marco→fase mapeado só onde o board tem fase judicial inequívoca; Salário
  Maternidade (board 100% administrativo) ficou com `stage_id null`: régua e
  percentual funcionam, fase não é movida.

Resultado medido: 396 → **558 processos com marco**; 139 fases andaram
sozinhas no primeiro tick (81 = BPC-Adm indo para "4. Fase Judicial").

**Atenção ao board:** o POP trabalhista EM USO agora é `0bcd8be6-…47e15`
("Trabalhistas judicial — marcos"); `b436c043-…` foi renomeado para "(fases
antigas — desativado)" e está sem processos. Migration antiga que cite
b436c043 como "em uso" está falando do passado.

**A capa entra sozinha desde 14/08/2026:** `backfill-process-marcos` (v8),
nos modos backfill/push, faz UMA consulta extra ao endpoint do processo
quando `data_distribuicao`/`data_inicio` estão vazios e persiste a capa —
depois disso a condição nunca mais dispara para aquele processo. Também
aceita `process_ids` para reconsultar uma lista exata. Foi o que zerou os
trabalhistas com janela só de expediente: reconsulta de 9 → 9 capas salvas.
Fechamento de 14/08 (com OK do usuário): duplicata do `0010566-42.2020`
resolvida (2 soft-deletes, ficou a linha "ACIDENTE DE TRABALHO") e o
`0016662-44.2026` consultado (sem 404 — capa + 1 marco). Resultado:
**272 de 272 trabalhistas com marco (100%)**.

### Carteira do POP no editor (14/08/2026)

`PopCarteiraSheet` — Sheet, sem redirecionar — abre por TRÊS caminhos: botão
"Carteira" no card do POP (`BoardCard`), atalho "Visão geral da carteira"
dentro do sheet "Processos do POP" (`BoardsList`), e a seção "Carteira do POP"
no editor (`WorkflowBuilder`). O do card existe porque o usuário navegava pela
lista de POPs e não achava a carteira escondida no editor (14/08). Valores
sempre com centavos. Confirmado funcionando em produção pelo usuário em 14/08. Fonte: RPC
`pop_carteira_marcos(board_id)` no Externo, uma linha por (processo × cliente).
Mostra por marco a relação de processos com DIAS em cada um, valores por
estágio financeiro (chips na ordem da régua FIDC), e no topo: carteira total,
tempo médio no marco, idade média, índice de sucesso, custo (CAC) e
rentabilidade. Números do primeiro load (POP trabalhista): 493 processos,
R$ 21,17 mi, média de 337 dias no marco atual.

Três regras que o código respeita e quem mexer precisa manter:

- **Valor = última decisão por (processo × cliente)** via `DISTINCT ON` — somar
  `jm_valores` direto infla 2,6x. O aviso "valor do processo, não caixa" está
  na tela, em texto corrido, não em tooltip.
- **Índice de sucesso divide pelos AVALIÁVEIS**, não pelos decididos: dos 239
  decididos do POP trabalhista só 62 têm leitura em `jm_decisoes` — "decidido
  sem valor" sem leitura é buraco de captura, não derrota. Honesto: 71/77 =
  92%; ingênuo: 30%. A coluna `tem_leitura` existe para isso.
- **Custo (CAC)**: o snapshot de `leads` do Externo está com `cac` ZERADO
  (14/08); o hook `useCarteiraDoPop` busca o valor vivo no Cloud (`authClient`)
  e usa o snapshot como fallback. Sem custo em nenhum lead, a tela diz isso em
  vez de mostrar rentabilidade zero.

**404 é categoria, não falha:** no backfill de 14/08 dos nunca-consultados,
~26 CNJs (todos ajuizados em 2026) deram `Escavador 404` — ainda não
indexados. A edge NÃO carimba `data_ultima_verificacao` nesses, então eles
continuam aparecendo como "nunca consultados"; re-tentar é de graça só
quando chegarem no push do e-mail. Fora do formato CNJ estrito a edge pula
sem custo (`sem_cnj`).

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

### O elo que faltava na cadeia: radar de processos quietos (31/08/2026)

A cadeia acima só anda quando o **e-mail** dispara — e há movimentação que nunca gera
e-mail: juntada de petição não sai no Diário. O caso `1017247-47.2025.4.01.3100` provou o
custo: réplica juntada em 03/08, prazo automático nasceu **30/08** (53 dias). E o detalhe
que engana qualquer diagnóstico: `data_ultima_verificacao` de 30/08 com movimentação
parada em 08/07 **não** é bug nosso — a consulta aconteceu, mas ela lê o **cache do
Escavador**, e o cache deles estava parado. Quem quer o tribunal de verdade paga
`solicitar-atualizacao`.

O elo agora existe: edge `radar-processos-quietos` (cron 09h/17h UTC). Três motivos, em
ordem: `email_recente` (push chegou e o cache está mais velho que o e-mail),
`prazo_proximo` (atividade aberta vence em ≤7d e movimentação >7d), `mov_estagnada`
(≥20d parado com atividade aberta). Primeiro re-consulta **grátis** o cache
(`backfill-process-marcos` + `process_ids`); só quem continua parado vira solicitação
**paga** via `esc-autos acao=solicitar` corpo `{}` — cooldown 3/7/30 dias por motivo,
teto 15/rodada, créditos gravados em `radar_atualizacoes`. Quem anda ganha prazo na hora
(`sync-process-compromissos` por processo). Doc completa: `docs/sistema/processual.md`
§ "Radar de processos quietos". `process_movement_monitors` segue vazia e agora é
irrelevante: o radar é quem re-consulta sozinho.

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

## Régua previdenciária POR PRODUTO (30/08/2026)

Até 30/08 as réguas dos POPs previdenciários eram cópias idênticas do trabalhista
(migration 20260814130000) — nenhuma particularidade de produto. Aplicado com OK
do usuário (PLANO_20260830_marcos_previdenciarios_por_produto.sql, correções no
cabeçalho do arquivo): **222→254 marcos, 556→622 sinais** (medidos, não
estimados), 1337 processos com marco antes e depois (ninguém perdeu régua).

Marcos novos nos 6 POPs prev (BPC JUDICIAL, POP-BPC-Adm, Auxílio Acidente,
Aux. Doença Acidentário, Pensão por Morte, Salário Maternidade), todos
eventuais/fase: `contestacao`, `replica` (antes da sentença),
`liquidacao_calculos`, `implantacao_beneficio`, `rpv_precatorio` (entre execução
e alvará; RPV sugere estágio `A_RECEBER`). Só nos dois BPC: `pericia_social`
(estudo social — a segunda perícia que nenhum outro benefício tem; `pericia`
virou "Perícia médica" com padrao_excluir dos termos sociais — NUNCA `social`
seco, que casaria "Instituto Nacional do Seguro **Social**" em todo cabeçalho).

Vocabulário recursal por competência: no JEF o acórdão sai por **recurso
inominado/Turma Recursal** (o padrão antigo "recurso ordinário" é trabalhista e
casava 0 de 17 processos com o termo); acidentários têm sinal extra de
**apelação/TJ** porque acidente do trabalho corre na Justiça Estadual (art. 109
I CF — confirmado nos CNJs 8.10/8.13/8.14/8.15/8.18 da base). Anexo manual tem
porta em três marcos (sinal `documento`): planilha de liquidação →
`liquidacao_calculos`, carta de concessão → `implantacao_beneficio`, comprovante
de pagamento → `pagamento`.

Primeiro tick: `pericia_social` detectado em 8 processos, `contestacao` em 5.
Caso `1017247-47.2025.4.01.3100`: o 28/04 era "juntada de laudo de perícia
social" (reclassificado de Perícia para Estudo social) e o marco atual virou
**Contestação do INSS em 17/06** — 40%→50%.

**Justiça Comum e Requerimento de Seguro** entraram na mesma tarde (OK do
usuário; 254→260 marcos, 622→642 sinais): `contestacao` (rótulo "Contestação do
réu" — o réu não é o INSS), `replica` e `rpv_precatorio`. NÃO ganharam
`implantacao_beneficio` (não há benefício a implantar) nem `pericia_social`
(exclusiva do BPC), e NÃO ganharam `liquidacao_calculos` porque esses dois
boards JÁ TÊM o marco `liquidacao` (ordem própria, antes da execução) — que
estava **sem sinal nenhum**, junto com `pagamento`; os dois receberam os sinais
(cálculos/CECALC + planilha de liquidação; pagamento efetuado + comprovante).
Acórdão ganhou os dois vocabulários estaduais: apelação/TJ (rito comum) e
recurso inominado/Turma Recursal (JEC estadual). Primeiro tick: contestacao,
liquidacao e rpv_precatorio detectados 1× cada na Justiça Comum — a primeira
detecção de RPV da base. Antes de criar marco em board novo, SEMPRE conferir as
chaves que ele já tem: `liquidacao` vs `liquidacao_calculos` teria duplicado.

Armadilhas para a próxima mudança de régua: `pop_marcos` tem UNIQUE
(board_id, ordem) **deferred** e UNIQUE (board_id, chave); as ordens diferem por
board (POP-BPC-Adm: adm 1..4, judicial 11+, estados 30..43) — shift de ordem é
sempre relativo à âncora do board e move TODOS os marcos dali em diante, estados
incluídos, senão colide. `estagio_financeiro_sugerido` usa underscore
(`A_RECEBER`).

---

## Unificação do BPC + trabalho espelhando os marcos (30/08/2026, noite)

Três mudanças com OK do usuário, todas com backup em `zz_bpc_unificacao_bkp_20260830`:

**1. Um POP só de BPC.** `BPC JUDICIAL` (cbaa0dfb) foi unificado no
`POP - BPC (Administrativo e Judicial)` (8377ee1b — o antigo "POP - BPC -
Administrativo", renomeado; a edge zapsign referencia por id, intacta). Movidos:
1.154 instâncias de 109 leads (estado marcado preservado; as 6 fases judiciais
colapsam em `stage_fase_judicial`, pós-decisão em `stage_pos_deferimento`), 35
processos (workflow_id + workflow_stage_id + workflow_name), 52 atividades, e os
16 objetivos judiciais viraram links no board unificado (display_order 200+ na
sequência do fluxo original). O board antigo ficou vazio e renomeado
"(desativado — unificado no POP BPC em 30/08/2026)" — é o rollback. Zero sobras
conferidas; caso Sidiney revalidado no unificado (fase judicial, 50%,
contestação atual). A fase-detalhe judicial agora é dada pela ORDEM DOS
OBJETIVOS dentro de stage_fase_judicial, não por 6 stages — o percentual segue
sendo da régua, que não mudou.

**2. Concedido no adm não desce pro judicial — JÁ ERA ASSIM.** A RPC
`pop_processo_regua` tem `bool_or(estado='atingido' and terminal)` → percentual
100, e `concessao_administrativa` já é `terminal=true` com sinal de e-mail
configurado. Pendência de calibragem: **0 processos** com essa detecção hoje
(84 indeferimentos, 114 exigências) — quando o primeiro deferimento adm chegar,
conferir se o padrão do despacho casa.

**3. Trabalho espelhando os marcos nos 4 POPs com buraco.** Templates novos
"Contestação e Réplica" e "Liquidação e Recebimento" em dois sabores (Prev/
Cível), reuso dos genéricos do BPC ("Fase Recursal", "Elaboração e Propositura",
"Sentença" — link carrega o dono, template é global) — 14 links: Aux. Doença
Acidentário, Pensão por Morte, Seguro e Justiça Comum (que estava com ZERO
objetivo). O passo de planilha/comprovante manda anexar a peça — é o anexo que
move a régua, o passo é o lembrete.

Nota de vocabulário (do usuário, 30/08): marco e fase são a MESMA coisa — o
tick move a fase pelo marco, os dois são autodetectados. A única distinção real
é marco/fase (autodetectado) × passo/objetivo (marcado à mão). Não descrever
como três conceitos.

---

## Checklist antes de entregar

- [ ] Marco novo que é estado ganhou `atravessa_fases = true`?
- [ ] Toda soma de valor passa por `distinct on (processo_cnj, cliente)`?
- [ ] Ao mostrar dinheiro, ficou claro que é valor do processo e não caixa do escritório?
- [ ] Cron novo: a URL foi conferida disparando e **lendo** `net._http_response`?
- [ ] Código TPU: 237/238/239 é provimento em 2º grau. 219/220/221 é procedência, **só G1**.
- [ ] Audiência só conta com complemento `realizada` — designada não é marco (840
      designadas vs 526 realizadas; contar designação dava mediana de 7 dias).

---

## Conferir o número antes de acreditar nele (15/08/2026)

Na Carteira do POP, clicar na linha do processo abre a **ficha** (`ProcessDetailSheet`,
aba lateral por cima); o botão de escudo abre a **conferência**
(`ProcessoConferenciaSheet` + `useConferenciaProcesso`), que mostra a matéria prima do
número: qual decisão virou o valor e quais foram descartadas, qual movimentação detectou
o marco atual (com fonte e prova documental), pagamentos recebidos vs. previstos, e os
outros cadastros do mesmo CNJ.

Tudo é SELECT direto no Externo — `jm_decisoes`, `jm_valores`, `jm_pagamentos`,
`process_pop_marcos`, `pop_marcos`, `lead_processes` já têm policy de SELECT para
`authenticated`. Nenhuma RPC nova, nenhuma escrita. O hook **replica** as regras da
`pop_carteira_marcos` de propósito: se a conferência divergir da carteira, a tela acusa.

### O buraco que a conferência achou de cara

**A carteira agrupa por cadastro, não por CNJ.** O mesmo CNJ com duas linhas em
`lead_processes` entra duas vezes no total do POP. Medido em 15/08/2026 no POP
trabalhista (`0bcd8be6-3aa5-4ab0-8091-9987bdc47e15`): **494 cadastros para 475 CNJs
distintos → R$ 21.168.246,70 exibidos contra R$ 20.292.233,25 reais, R$ 876.013,45
inflados**. Exemplo: `0000491-34.2020.5.05.0101` aparece 4 vezes ("PA M", "Indenização",
"Processo", "0000491-34.2020.5.05.0101 - ACIDENTE DE TRABALHO"), cada uma levando os
R$ 376.013,45 dos 5 clientes.

**RESOLVIDO em 15/08/2026** — migration
`20260815120000_pop_carteira_marcos_dedup_cnj.sql`: a RPC passou a percorrer **CNJ**,
não cadastro (`distinct on (cnj_num)`, ficha canônica eleita por ter marco → maior
ordem → mais marcos → mais recente → id). Verificado em produção depois de aplicar:
**494 → 475 processos, R$ 21.168.246,70 → R$ 20.292.233,25**.

Antes de escolher o critério, dois riscos foram medidos:

- **Perder marco?** Não. Nos 17 grupos duplicados dentro do mesmo POP, ZERO têm marco
  divergente entre as fichas irmãs — a captura grava por CNJ, não por ficha.
- **Perder custo? SIM, se feito ingenuamente.** Em 6 dos 17 grupos as fichas irmãs
  pertencem a **leads diferentes** (litisconsorte que entrou como lead próprio).
  Descartar a ficha irmã descartaria o CAC daquele lead e faria a rentabilidade mentir
  para cima. Por isso as colunas novas `leads_do_cnj` (todos os leads do CNJ — é por
  onde `useCarteiraDoPop` soma o custo agora) e `cadastros_do_cnj` (quantas fichas
  existem, para a tela avisar). Confirmado: **298 → 298 leads**, nenhum perdido.

Limpar os cadastros duplicados continua valendo, mas agora é higiene — não é mais o
total que depende disso. A tela avisa quantos CNJs estão nessa situação.

### O valor é por PARTE

`jm_valores` tem uma linha por (decisão × pessoa) e a RPC devolve (CNJ × parte) — um
litisconsórcio tem um valor por pessoa. Clicar no valor na carteira abre a conferência
já rolada na abertura por parte (`AlvoConferencia.foco = 'valores'`); a linha mostra
"N partes" e o cabeçalho da carteira, o total de partes do POP.

### Alertas que a tela levanta

CNJ cadastrado N vezes · sem marco de fase detectado · marco atual sem data · marco
gravado que não existe mais no POP (o inner join com `pop_marcos` derruba) · sem leitura
de decisão (alto quando já passou da sentença deste POP) · valor sem `dec_id` válido ·
duas decisões da mesma data com valores diferentes (a "última decisão" vira sorteio) ·
clientes em estágios financeiros diferentes (a carteira joga o valor inteiro num só) ·
divergência entre o valor exibido e o recalculado · decisão com `flag_revisar`.

### Achado aberto: `pago` da carteira dá R$ 0

Medido em 15/08/2026 e **não** causado pela dedup — é dado. `jm_pagamentos` tem 441
parcelas recebidas (R$ 596.000) em 14 CNJs, mas só **1** desses CNJs está no POP
trabalhista, e a parcela dele está com `valor_pago` nulo. Enquanto isso não for
corrigido na origem, "realizado − custo" da carteira é sempre negativo pelo custo
inteiro.

### De quem é o processo (15/08/2026)

Migration `20260815170000_pop_carteira_marcos_lead_nome.sql`: a RPC devolve
`lead_nome` (o caso da ficha canônica) e `leads_nomes` (todos os leads do CNJ). Fonte é
`leads.lead_name` do **próprio Externo** — o snapshot está vivo (updated_at do mesmo
dia) com 19.973 de 19.974 leads nomeados, e 713 de 713 processos do POP com lead chegam
a um nome; não precisa ir ao Cloud. Verificado depois de aplicar: 475 processos, 473
com nome, carteira inalterada em R$ 20.292.233,25.

Na tela o nome do caso vem em cima e o CNJ + título viram a segunda linha, menores — o
`title` de `lead_processes` é o que a equipe digitou ("Processo", "PA M") e muitas vezes
não identifica ninguém. CNJ com fichas em casos DIFERENTES ganha "+N" na linha, e o
alerta da conferência nomeia os casos: apagar a ficha errada perde histórico.

O alerta de ficha repetida baixou de **alto para atenção** depois da dedup — o total do
POP já está certo, o cadastro duplicado virou higiene.

---

## Valor ATUALIZADO da condenação — juros e correção (15/08/2026)

Migration `20260815200000_pop_carteira_marcos_valor_atualizado.sql`. Decidido com o
usuário: o corrigido anda **AO LADO** do nominal, nunca no lugar — a carteira continua
somando o nominal, que é o que FIDC/Tercon/Limine leem.

### A base já tinha tudo; faltava ligar

- **`jm_indices`** — `SELIC_SIMPLES_JT` (1995-01→2026-07) e `TCM_ESTADUAL`
  (1964-01→2026-07). `coeficiente` é o multiplicador da competência até `referencia`;
  a competência da própria referência vale 1.0.
- **`jm_decisoes.termo_inicial_jcm`** — início de juros e correção, em 435 das 439
  decisões. Quando falta, cai na `data_decisao` e a linha vem com `jcm_termo_estimado`.

### Índice pelo RAMO, dígito 14 do CNJ

| segmento | ramo | índice |
|---|---|---|
| 5 | Justiça do Trabalho | `SELIC_SIMPLES_JT` |
| 8 | Justiça Estadual | `TCM_ESTADUAL` |
| outro | — | **nenhum**, não corrige |

Justiça Federal (segmento 4) tem manual próprio de cálculo: aplicar TCM_ESTADUAL nela
seria mentira. Hoje os 51 processos de segmento 2/4 deste POP não têm valor lançado, então
ninguém fica sem índice — quando tiverem, a tela diz "sem índice para este ramo" e o
total avisa que o corrigido está subestimado.

**O termo é o da decisão QUE VALE**, não de qualquer uma. Corrigir pela sentença quando
o acórdão é que vale dá número errado — a `valor_vigente` carrega o termo junto do valor.

### A RPC entrega insumos, o front multiplica

`jcm_indice`, `jcm_termo_inicial`, `jcm_termo_estimado`, `jcm_coeficiente`,
`jcm_referencia`. De propósito: a conferência mostra a conta inteira
(`R$ 75.202,69 × 1,6161 = R$ 121.520,00 · SELIC simples de 15/01/2020 até jul/2026`)
em vez de um número mágico que ninguém consegue contestar.

**A data limite anda sempre junto do número.** `jcm_referencia` é até quando a tabela
corrige (2026-07-01 enquanto estamos em 15/08/2026) — valor corrigido sem dizer até
quando não serve para negociar. Manter a `jm_indices` atualizada é o que mantém o número
vivo; ela venceu, o número congela sem avisar ninguém além dessa data na tela.

### Impacto medido (POP trabalhista, 15/08/2026)

| | |
|---|---|
| nominal | R$ 20.292.233,25 |
| atualizado até jul/2026 | R$ 26.010.426,00 (**+28,2%**) |
| cobertura | 223 de 223 partes com valor |
| termo estimado | 2 partes |

### Índices vêm do Bacen sozinhos — e o tick que estava travado (15/08/2026)

**Já existia** `jm_indices_tick()`, no cron `jm_indices_diario` (`30 7 * * *`): busca
SELIC (SGS **4390**) e IPCA (SGS **7478**) no Bacen via **pg_net** e atualiza os DOIS
índices — SELIC por **soma** simples, TCM por **produto** (1+IPCA). Validado contra as
tabelas oficiais. **Procure por ele antes de escrever qualquer sync de índice.**

> ⚠️ **Erro caro cometido em 15/08/2026:** construí um pipeline paralelo
> (`jm_selic_sync_*`) sem procurar o que já existia. Além de duplicar trabalho, ele
> **quebrou** o original — o tick começa com `if exists (referencia = mês corrente) then
> return 'ja_atualizado'`, e a safra parcial que o paralelo criou (só SELIC) fez o tick
> desistir de criar a TCM. Removido na migration `20260816000000`. A lição não é sobre
> índice: é `grep`/`pg_get_functiondef` **antes** de construir, não depois.

**Por que a tabela estava parada em jul/2026 — deadlock por resposta expirada.** O tick
disparava as buscas e processava num tick seguinte, com esta guarda de re-disparo:

```sql
and (x2.id is null or x2.status_code = 200)   -- ERRADO
```

`net._http_response` expira em ~6h. Depois disso `x2.id is null` fica verdadeiro para
sempre, o `not exists` nunca libera, e a função nunca mais re-dispara. Travou em
01/08/2026 e ficou mudo. Corrigido para:

```sql
and (x2.status_code = 200
     or (x2.id is null and h2.created_at > now() - interval '2 hours'))
```

Pedido recente sem resposta ainda pode chegar; pedido velho sem resposta expirou e
precisa de um novo. **Toda fila baseada em `net._http_response` precisa desta janela** —
é a terceira vez que essa armadilha aparece nesta base.

**Verificado de ponta a ponta:** tick devolveu `aguardando_bacen_202607` (re-disparou —
antes ficava mudo), respostas 200 (SELIC jul 1,22% · IPCA jul 0,06%), tick seguinte
`atualizado_para_2026-08`. Safra 08/2026 completa: SELIC 380 competências, TCM 743. O
coeficiente de 2020-01 ficou **1,6283** = 1,6161 (safra de julho) + 1,22%, batendo com o
cálculo independente feito reconstruindo a série inteira do Bacen desde 1995 — que
também já havia reproduzido as 379 linhas antigas com **0 divergências**. Carteira: 475
processos, nominal R$ 20.292.233,25 intacto, atualizado R$ 26.236.887,71, nenhuma parte
sem correção, os dois índices em ago/2026.

**A regra do coeficiente:** `1 + Σ SELIC(m)/100` da competência até o mês **anterior** à
referência — a SELIC do mês de referência não incide (regra da tabela única do TST/CSJT;
por isso competência = referência vale 1,0).

**SAFRA, não sobrescrita.** `jm_indices` tem chave única `(indice, competencia,
referencia)` e guarda o histórico. Quem consultar tem que eleger a mais recente —
`jm_coef()` já fazia (`order by referencia desc limit 1`), a `pop_carteira_marcos` não
fazia e duplicaria a carteira inteira a cada mês novo; corrigido com a CTE
`indice_vigente` (`distinct on (indice, competencia) order by referencia desc`) na
migration `20260815220000`. **Query nova contra `jm_indices` tem que fazer o mesmo.**

**Na tela:** `corrigidoAte` é a **MENOR** referência entre os índices, nunca a maior —
se um índice ficar para trás, prometer a data do mais novo mentiria para metade da
carteira. A safra de cada um aparece ao lado quando divergem.

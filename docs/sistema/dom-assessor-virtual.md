# Dom — Assessor Jurídico Virtual

Atendente virtual que responde o cliente **dentro do grupo do caso**, com o
andamento real dos autos, em linguagem que o cliente entende. Assina toda
resposta como assessor virtual — nunca se passa por advogado ou por atendente
humano.

Fontes de verdade do código:
- Banco: `supabase/migrations-external/20260821180030_dom_assessor_juridico_virtual.sql`
- Isolamento por grupo: `supabase/migrations-external/20260904120000_dom_isolamento_por_grupo.sql`
- Contexto: `supabase/functions/_external/dom-contexto/index.ts`
- Resposta: `supabase/functions/_external/whatsapp-ai-agent-reply/index.ts` (bloco `=== DOM ===`)

Tudo vive no Supabase **Externo** (`kmedldlepwiityjsdahz`). Agente:
`DOM-Atendente Processual`, id `d6ad8eee-d6a3-452c-b852-b94ef8dd54bf`, que é uma
linha de `wjia_command_shortcuts` exposta pela view `whatsapp_ai_agents`.

## As três travas

O Dom só fala quando as três abrem. Qualquer uma fechada = silêncio.

1. `wjia_command_shortcuts.is_active = true`
2. `wjia_command_shortcuts.contexto_processual = true`
3. O grupo está em `dom_grupos_piloto` com `ativo = true`

Fora disso `dom-contexto` devolve `atende: false` e a resposta é engolida antes
de chegar ao modelo. Três travas de propósito: um atendente que fala com cliente
sobre o processo dele erra caro, e a lista do piloto é o freio de mão.

## Cada grupo é uma caixa fechada

As três fontes que alimentam a resposta são isoladas por grupo:

| fonte | como isola |
|---|---|
| histórico da conversa | `whatsapp-ai-agent-reply` filtra `phone` + `instance_name` |
| andamento processual | `dom_contexto_processual(group_jid)` → lead → autos daquele lead |
| acervo de exemplos | `dom_respostas_parecidas(..., p_group_jid)` — só o mesmo grupo |

O acervo nasceu (21/08/2026) varrendo os 4.546 pares de todos os 481 grupos,
para pegar o tom da equipe. Em 04/09/2026 isso foi fechado: sem `p_group_jid` a
função **não devolve nada**. Falhar calado é o certo — um chamador que esquecer
de passar o grupo receberia, na versão antiga, o acervo inteiro sem perceber.
Custo aceito: grupo novo roda sem exemplos, e o tom vem só do prompt.

## Como ele fala

`blocoComoFalar()` em `dom-contexto` é obrigatório em toda resposta:

- **Nunca pede o número do processo.** Nasceu de um caso real: o atendente
  virtual pediu o número ao cliente para falar do processo *do próprio cliente*.
  Os autos já chegam prontos no bloco de andamento — pedir escancara que ninguém
  está olhando o caso.
- **Zero juridiquês.** O bloco carrega um glossário de tradução obrigatória
  (juntada, conclusos, citação, contestação, réplica, perícia, trânsito em
  julgado, exigência, sentença, arquivado).
- **Uma comparação do dia a dia por resposta**, no máximo.
- **Pergunta sobre andamento** = resumo de 2 a 3 frases de CADA processo e
  requerimento, a partir das últimas movimentações. Audiência ou perícia marcada
  vem primeiro. Sem movimentação recente, diz isso com honestidade — sem prometer
  prazo.

## Data de movimentação no futuro

Medido em 04/09/2026: **16 processos** com `lead_processes.data_ultima_movimentacao`
no futuro, o mais distante em 03/12/2026 — provavelmente data de prazo ou de
audiência gravada como movimentação.

`blocoProcessual` **não esconde** a linha: marca como `DATA INCONSISTENTE`,
proíbe o Dom de dizer a data ao cliente e manda emitir
`[REVISAR: data de movimentação no futuro neste processo]`, o que joga a resposta
na fila de revisão. Detector, não filtro — o processo torto continua visível e
vai para a esteira de conserto. Esconder trocaria um número errado por um
silêncio errado.

## Modos do piloto (`dom_grupos_piloto.modo`)

- `hibrido` — envia o factual, enfileira o sensível em `dom_respostas_pendentes`
- `rascunho` — enfileira tudo
- `automatico` — envia tudo, sem revisão

O modelo classifica a própria resposta com o marcador `[REVISAR: motivo]`, que é
removido antes do envio. Valor, prazo, mérito de decisão, recurso, acordo e
cliente reclamando são sempre revisão.

## Estado em 04/09/2026

Pronto e vivo:
- 481 grupos com caso mapeados, todos com acervo carregado
- 4.546 pares no acervo; o gatilho `trg_dom_captura_resposta` alimenta sozinho
- `contexto_processual = true`; `respond_in_groups = true`
- prompt sem as frases que mandavam deduzir o processo da conversa
- acervo isolado por grupo

8 grupos no piloto, todos em `rascunho` (escolhidos em 04/09/2026):

| grupo | linha | perguntas/30d | acervo | conteúdo |
|---|---|---|---|---|
| FAMILIA 375 — Ester Maria, Sinop/MT | Processual | 141 | 71 | 5 processos |
| Familia 412 — Felipe Barbosa x CGB | Processual | 129 | 29 | 2 processos, mov 28/07 |
| Caso 224 — Arlan, Abaetetuba/PA | Processual | 89 | 26 | 6 processos, mov 26/08 |
| Caso 217 — Bruno, Arcos/MG | Processual | 68 | 99 | 7 processos |
| CASO 398 — Charles x Porto Rico | Prev 2 | 145 | 67 | 1 processo |
| PREV 1934 — São Mathus | Prev 2 | 106 | 17 | só INSS |
| 1104 Milagros — BPC/LOAS | Prev 2 | 64 | 18 | judicial + INSS |
| PREV 1943 — Mauricio | Prev 2 | 55 | 12 | judicial + INSS, acervo pequeno |

Começa em `rascunho` de propósito: **nada chega ao cliente**, tudo cai em
`dom_respostas_pendentes`. Dá para ler por SQL o que o Dom responderia a
perguntas reais antes de ele falar com alguém. Vira `hibrido` quando as
respostas passarem no olho e a tela da fila existir.

Descartados na conferência, e por quê:
- **FAMÍLIA 374 (Peterson)** — maior acervo de todos (298 pares), mas em
  **segredo de justiça**. O próprio prompt manda não detalhar conteúdo desses no
  grupo.
- **CASO 396** e **Família 294** — movimentação datada em 16/09 e 21/09, no
  futuro. Ver a seção acima.

Deployadas em 04/09/2026: `dom-contexto` (v1) e `dom-rascunho` (v1), ambas
testadas contra grupo real do piloto.

Falta:
- **deploy** de `whatsapp-ai-agent-reply` (produção roda v47, de 11/06/2026, sem
  nenhum código do Dom). O arquivo do repo está pronto; só a publicação falta.
- `is_active = true`
- vincular os grupos do piloto em `whatsapp_conversation_agents` (o Dom só é
  consultado quando a conversa tem agente atribuído)
- tela da fila `dom_respostas_pendentes` — sem ela o modo híbrido enfileira para
  ninguém
- atraso de 5 min por fila agendada (ver abaixo)
- aviso proativo de movimentação nova (o Dom hoje só reage a mensagem)

## `dom-rascunho` — o piloto rodando sem tocar em produção

A integração definitiva do Dom mora dentro de `whatsapp-ai-agent-reply` (50 mil
chars, ~5,9 mil chamadas/dia). Trocar aquele arquivo só para começar o piloto é
apostar o caminho quente inteiro numa mudança que ninguém viu funcionar.

No modo `rascunho` o Dom **não envia nada** — lê o contexto, escreve, e a
resposta vai para `dom_respostas_pendentes`. Tudo o que o piloto precisa cabe
numa função própria de ~210 linhas: `supabase/functions/_external/dom-rascunho/`.
Ela chama a mesma `dom-contexto`, usa o mesmo prompt, grava na mesma fila, e não
encosta na função de produção. Sai de cena quando a integração definitiva subir.

Acionada por POST: `{}` varre todos os grupos ativos do piloto, `{group_jid}`
roda um só, `{limite}` limita a rodada.

### Primeira rodada — 04/09/2026, 6 rascunhos

O que funcionou: resumo com fato real, data real e linguagem de cliente; e o
marcador de revisão saindo sozinho (`[REVISAR: valor]` quando o Dom falou em
R$ 600, `[REVISAR: depoimento]` num caso trabalhista).

Três defeitos achados, **todos abertos**:

1. **O gatilho dispara em qualquer inbound.** Cliente escreveu "Muito obrigada"
   e o Dom respondeu com relatório de 7 processos. Falha de projeto do
   `dom-rascunho`, não do prompt: ele precisa rascunhar só quando houve
   pergunta de verdade.
2. **Resposta desconectada da pergunta.** Cliente reclamou que o app da Caixa
   estava travando; o Dom respondeu sobre declaração de Bolsa Família. Mesma
   raiz do item 1 — o contexto do processo atropela o que foi dito.
3. **O grupo não pertence a uma linha só.** Vários números da equipe estão
   dentro do mesmo grupo (os rascunhos saíram com `Raym`, `Luiz Abraci` e
   `Atendimento Previdenciário`). De qual número o Dom responde é decisão de
   operação, não se resolve escolhendo o grupo.

Menor, mas anotado: ele cita o número CNJ completo ao cliente. Não é erro, é
ruído — cliente não usa esse número.

O cron **não foi criado** por causa do item 1: um tick de 2 em 2 minutos hoje
encheria a fila de resposta para "obrigada".

## Como ele decide: as 19 intenções

`dom-rascunho` classifica a última mensagem do cliente num modelo barato
(flash-lite) ANTES de gastar o modelo bom, e o grupo da intenção decide a ação:

| Grupo | O que ele faz | Intenções |
|---|---|---|
| A | responde a pergunta | A1 andamento, A2 explicação, A3 problema prático, A4 o que ele precisa fazer |
| B | acolhe, **sem falar de processo** | B5 desabafo, B6 notícia boa, B7 notícia ruim |
| C | confirma curto | C8 entregando dado, C9 documento, C10 agendamento, C11 fato novo |
| D | **cala** | D12 cumprimento, D13 agradecimento, D14 fora do caso, D15 mensagem da equipe |
| E | chama humano | E16 reclamação, E17 dinheiro/prazo, E18 quer pessoa, E19 assunto novo |

Mais `conversa_encerrada`: quando a última mensagem só reconhece o que já foi
dito, ninguém responde de volta. O Dom é convidado na conversa, não dono dela.

## Cron: `dom_rascunho_tick`, de 5 em 5 minutos

Agendado no Externo em 04/09/2026. O custo **não escala com a frequência,
escala com a conversa**: antes de qualquer chamada de modelo a função pula todo
grupo cuja última mensagem já foi decidida — `dom_respostas_pendentes` cobre o
rascunho gerado, `dom_decisoes` cobre o silêncio. Rodada em grupo parado é só
leitura de banco.

Essa segunda checagem existe porque rascunho deixa rastro e silêncio não. Sem
ela, um grupo parado num "obrigada" seria reclassificado a cada cinco minutos,
para sempre. Só decisão FINAL bloqueia: `pulou` fica de fora de propósito,
porque cobre tropeço passageiro que merece nova tentativa.

`dom-avisar-atendente` **não** está no cron. Ele manda mensagem no WhatsApp
pessoal de alguém, e isso começa por decisão humana, não por agendador.

Rollback: `select cron.unschedule('dom_rascunho_tick');`

## `dom-avisar-atendente` — a reclamação chega em alguém

Quando a intenção é do grupo E, `dom-rascunho` sorteia o atendente pelo rodízio
e grava `atendente_id` na fila. Esta função avisa a pessoa no privado, com nome
do grupo, quem falou, o que foi dito, por que caiu no colo dela e o link de
convite do grupo.

`dry_run` é TRUE quando ausente — para valer é `POST { "dry_run": false }`. O
link falha sozinho (só existe se a instância for admin do grupo) mas o aviso sai
mesmo assim. `notificado_em` só é marcado depois do envio dar certo: marcar
antes transformaria falha de rede em reclamação que ninguém veria de novo.

## Ritmo humano

Aplicado em `whatsapp-ai-agent-reply` (repo — **efeito só no deploy dela**):

- **Intervalo entre as partes** sai do tamanho do texto, a ~200 caracteres por
  minuto, com piso de 1,5s, teto de 12s e variação de 25%. Era fixo para toda
  parte de toda mensagem — uma de 40 chars levava o mesmo tempo que uma de 280.
- **Atraso antes de responder** ganha a mesma variação. Responder sempre no
  mesmo segundo exato é relógio, não pessoa.
- **Janela 8h–20h** passa a valer também para resposta normal, mas **só para
  quem tem `contexto_processual`**. A função atende todos os agentes, e calar os
  outros à noite seria mudança que ninguém pediu.

Já estavam prontos e ligados: quebra de mensagem em partes, resposta em áudio
quando o cliente manda áudio, e pausa de 45 min quando um humano responde.

## O atraso de 5 minutos NÃO é `response_delay_seconds`

`response_delay_seconds` está implementado como `await setTimeout()` **dentro**
da edge function: ela segura o worker aberto o tempo todo. Limites do Supabase:
wall clock 150s (free) / 400s (pago) e **2s de CPU por request**. Cinco minutos
parados por mensagem, com ~5,9 mil invocações/dia nessa função, bate no teto.

O caminho certo é enfileirar a resposta com `enviar_em = now() + 5min` e deixar
um tick de cron mandar — cancelando se um humano responder antes. A máquina já
existe e está provada: `wa_agendadas_tick()` + cron `wa-mensagens-agendadas`
(migration `20260825170000`), que dispara pelo mesmo `send-whatsapp`.

## Deploy

Não há CLI nem `SUPABASE_PAT` no ambiente remoto. Do seu lado:

```bash
supabase functions deploy dom-contexto --project-ref kmedldlepwiityjsdahz
supabase functions deploy whatsapp-ai-agent-reply --project-ref kmedldlepwiityjsdahz
```

Ao redeployar `whatsapp-ai-agent-reply`, os `_shared/gemini.ts` e
`_shared/doc-utils.ts` **que estão em produção** têm que ir junto. O
`_shared/gemini.ts` da raiz do repo é uma versão mais nova (com roteamento
Anthropic) e **não** faz parte desta mudança — subir ele por engano troca o
provedor de todos os agentes.

## Rollback

```sql
-- desliga o Dom sem tocar em mais nada
update wjia_command_shortcuts set is_active = false
 where id = 'd6ad8eee-d6a3-452c-b852-b94ef8dd54bf';

-- ou tira só os grupos do piloto (o agente fica ligado e mudo)
update dom_grupos_piloto set ativo = false;
```

O bloco do Dom em `whatsapp-ai-agent-reply` é inteiro guardado atrás de
`agent.contexto_processual`, que é `false` em todos os outros agentes: para
quem já roda hoje, o código é inerte.

## Pendência aberta (decisão do Raym)

### Resolvida em 04/09/2026 — a instrução das senhas

O `base_prompt` mandava o Dom dizer ativamente ao cliente que podia mandar senha
no grupo ("POIS É UM AMBIENTE SEGURO ONDE TODOS SE CONHECEM"). Grupo de WhatsApp
não é canal seguro para credencial: fica no aparelho de cada participante, no
backup em nuvem de cada um, e sobrevive à saída de qualquer um do grupo. Se for
a senha do gov.br, é acesso ao Meu INSS do cliente.

Substituída, com autorização do Raym, por:

```
NUNCA peça senha, código de acesso ou dado bancário ao cliente, e NUNCA diga que
é seguro mandar isso no grupo. Se precisar de senha (gov.br, Meu INSS), diga que
a equipe vai chamar em conversa privada para tratar disso.
```

### Aberta — de qual número o Dom responde

Ver defeito 3 da primeira rodada, acima.

---

## O contexto que o agente recebe (05/09/2026)

Ordem no prompt, e o porquê de cada camada. A ordem importa: o modelo
responde com o que vier primeiro.

| # | Bloco | O que traz | Por que existe |
|---|---|---|---|
| 1 | Quem você é | assessor virtual, 1ª pessoa do plural, nunca assina com nome de pessoa | um rascunho assinou "Com carinho, Abderaman Rafael 💚" |
| 2 | Como falar | forma de 4 partes, continuidade, glossário, proibições | ver abaixo |
| 3 | Andamento | **fase atual** → marcos → decisões → **peças lidas** → movimentações | ver abaixo |
| 4 | Atividade | o que a equipe anotou, o "como está" e o próximo passo | o agente contradizia o assessor |
| 5 | Exemplos | atendimentos anteriores **do mesmo grupo**, só para tom | ver abaixo |

### A forma padrão de toda resposta

Quatro partes, sem título e sem numeração, um parágrafo puxando o outro:

1. **Reconhecer** — o que a pessoa disse ou sente; a espera, se houver.
2. **Onde está** — a FASE ATUAL, em palavra de gente.
3. **O que mudou** — o que a última peça decidiu, desde a última conversa.
4. **O que vem** — próximo passo e de quem é, terminando em aberto.

**Continuidade é regra, não estilo.** O grupo existe há meses; o agente
sempre RETOMA, nunca se apresenta. Proibido "olá, tudo bem? como posso
ajudar?", boas-vindas, pedir para a pessoa repetir o que já contou, ou
dar a conversa por encerrada. Fecha sempre em aberto ("qualquer novidade
a gente avisa aqui no grupo").

### Por que "fase" vem antes de "movimentação"

Caso 150 - Pinhão/PR, 05/09/2026. O cliente perguntou do andamento e o
rascunho respondeu que o processo estava "na fase de intimação
eletrônica". Não existe essa fase. Ele repetiu o andamento mais recente
que recebeu, cujo próprio resumo dizia:

> "confirmação de intimação eletrônica (evento 195) no eproc. Trata-se de
> **atualização de rotina do sistema**, sem indicação de providência."

Ele narrou o carteiro em vez da carta — porque o carteiro era tudo o que
chegava até ele. `dom_contexto_processual` devolvia 17 campos por
processo e nenhum era fase, documento ou atividade.

O mesmo processo tinha, o tempo todo: marco "Execução iniciada"
(11/08/2026, `process_pop_marcos`) e um despacho lido de 28/07 dizendo
que o INSS não regularizou a pensão em três cotas e o juiz fixou multa
diária de R$ 50 (`jm_documentos` + `jm_documento_leitura`).

Hoje o bloco de andamento traz `fase_atual`, `marcos` e `documentos`, e
as movimentações vêm por último, rotuladas "rotina — NÃO são a fase do
caso".

### Por que os exemplos dizem "não copie a FORMA"

Família 412, 04/09/2026, primeira resposta 100% automática. O cliente
escreveu duas palavras ("Verbas Rescisórias") e o agente devolveu o
template de atualização de atividade do WhatsJUD inteiro: número do
processo, barra de progresso, "Etapa: Pré-Processual", jargão pesado
(gabinete, despacho, habilitação nos autos), link do sistema, menu
"digite 1", e assinatura com o nome de um advogado real que não escreveu
nada daquilo.

Causa: `dom_respostas_parecidas` alimenta o modelo com mensagens reais da
equipe para calibrar tom. Quanto mais fraca a pergunta, mais ele se apoia
no exemplo — e copiou um inteiro. O bloco de exemplos agora diz
explicitamente que dali sai só o jeito de falar, e o "como falar" proíbe
número de processo, link, menu e assinatura com nome de pessoa.

### Glossário

Cinco famílias, no `blocoComoFalar`: onde o processo está, recursos,
documentos e atos, dinheiro, INSS e benefício. Termo solto é proibido —
ou traduz, ou escreve e explica entre parênteses em seguida.

Entradas que nasceram de caso real: embargos de declaração, acórdão,
agravo, ato ordinatório, habilitação nos autos, gabinete, execução /
cumprimento de sentença, cota, RPV / precatório, cessação, implantação.

### `dom_texto_limpo()`

A anotação da atividade é escrita em editor rico e saía do banco como
HTML cru (`<p class="lexical-paragraph">`) direto para o prompt. Modelo
imita o que recebe. A limpeza é na origem, preservando as quebras de
parágrafo.

### Cliente com mais de um processo — a regra em três degraus

O grupo é "Caso 217 - Bruno", mas o cliente tem **sete** processos com a
casa. Foi essa a confusão que gerou o primeiro defeito grave: o cliente
escreveu "muito obrigada" e recebeu um relatório de sete processos.

Distribuição medida em 05/09/2026, nos 1149 grupos do piloto
(`dom_contexto_processual` por grupo):

| processos/requerimentos | grupos |
| --- | --- |
| nenhum vínculo | 309 |
| 1 | 200 |
| 2 | 236 |
| 3 a 4 | 72 |
| 5 a 7 | 7 |
| 8 ou mais (máx. 10) | 2 |

Ou seja: **317 grupos têm dois ou mais**. Não é exceção, é o caso comum —
e por isso a regra não pode ser "resuma todos" nem "resuma um".

A regra vive em dois lugares, de propósito:

1. `blocoComoFalar`, seção "QUANDO O CLIENTE TEM MAIS DE UM PROCESSO",
   em três degraus:
   - a conversa deixa claro de qual processo se fala → responde **só** esse;
   - não dá para saber e são **dois ou três** → um parágrafo curto cada;
   - **quatro ou mais** → não lista: diz quantos são, conta o que mexeu
     mais recente e pergunta de qual a pessoa quer saber.
2. `blocoProcessual`, um aviso com o **número real** logo no topo, antes
   de qualquer lista, quando `processos + requerimentos > 3`:
   `>>> ATENÇÃO: este cliente tem 7 processos/requerimentos com a casa.`

O aviso com o número existe porque a regra genérica sozinha não segurava:
lendo sete blocos `PROCESSO ...` em sequência, o modelo trata "resuma o
andamento" como ordem literal e devolve sete parágrafos. Dizer o número
antes da lista é o que muda o comportamento.

Duas regras contraditórias conviveram no mesmo bloco por algumas horas
("no máximo três parágrafos curtos" e "um parágrafo por processo e nada
além"). Com 7 processos elas se anulam. Os três degraus substituem as duas.

Verificado em 05/09/2026 no grupo `120363312825541116` (Caso 217, sete
processos): o prompt montado traz a linha
`>>> ATENÇÃO: este cliente tem 7 processos/requerimentos com a casa`
imediatamente antes do primeiro `PROCESSO`.

### As quatro ordens que brigavam (05/09/2026)

Com a regra dos três degraus escrita, o teste forçado no grupo Caso 217
(sete processos) mostrou o agente listando **quatro**. A regra estava
certa; o problema era que ela não era a única.

O system prompt é montado em `dom-rascunho`, nesta ordem:

```
agente.prompt_instructions   (banco)
domCtx.blocos                (dom-contexto)
blocoDeGenero
instrucaoDaIntencao(intencao)   ← último = posição mais forte
```

E cada pedaço dizia uma coisa:

| onde | o que mandava |
| --- | --- |
| prompt do agente (banco) | "resumo atualizado de **TODOS** os processos, mesmo que ele cite só um" |
| `dom-contexto` `blocoComoFalar` | "quatro ou mais → **NÃO liste**" |
| `dom-contexto` `blocoProcessual` | ">>> ATENÇÃO: 7 processos, NÃO liste todos" |
| `dom-rascunho` `instrucaoDaIntencao("A")` | "**resuma cada processo** em 2 ou 3 frases" |

Duas mandavam listar, duas mandavam não listar, e a que mandava listar
estava na última linha. O modelo rachou a diferença: quatro de sete.

Correção, nos dois lugares:

- `instrucaoDaIntencao("A")` não decide mais tamanho. Aponta para a regra,
  repete os três degraus e fecha a brecha com "listar quatro em vez de
  sete continua sendo listar".
- O prompt do agente no banco (`wjia_command_shortcuts`, id
  `d6ad8eee-…`) teve a linha trocada por "Siga a regra QUANDO O CLIENTE
  TEM MAIS DE UM PROCESSO…". Rollback é o `replace` inverso.

**A lição, que vale para a próxima:** uma regra de prompt só vale se for a
única sobre aquele assunto. Regra repetida em quatro lugares não é reforço
— é voto, e o modelo desempata sozinho. Antes de escrever regra nova,
procure a antiga com `grep` nos três lugares: prompt do banco,
`dom-contexto`, `instrucaoDaIntencao`.

### Modo teste do `dom-rascunho`

`POST { group_jid, teste: true, pergunta? }` ignora as travas que existem
para o cron — equipe falou por último, já rascunhado, já decidido,
silêncio — e em troca **não grava rascunho, não gera áudio e não agenda
envio**. Devolve `{ casos, intencao, precisa_revisao, resposta }` e para.

Existe porque sem ele não havia como testar um grupo escolhido a dedo, que
é onde o defeito aparece: o grupo do Bruno estava travado em "equipe falou
por último" e só voltaria a ser olhado quando a cliente escrevesse.

O `verify_jwt` da função estava **false** — ela respondia 200 sem nenhum
header de Authorization, gastando token de LLM e gravando linha a pedido
de qualquer um. Agora exige JWT. O único chamador é o cron, que já manda
Bearer.

### Rótulo interno e redação de tribunal não vão crus

Dois defeitos do mesmo teste:

- *"o caso do IVENTÁRIO AVÔ DO BRUNO"* — o campo `titulo` é apelido de
  pasta, digitado na correria: caixa alta, erro de digitação. Agora vai
  para o prompt como `Como a equipe chama este caso na pasta (RÓTULO
  INTERNO):` e o "o que nunca entra na mensagem" proíbe repeti-lo.
- *"o que mais entender de direito"* e "fase de ajuizamento" solto — a
  redação oficial do tribunal copiada. Agora o bloco de movimentações diz
  que aquilo é redação oficial escrita para advogado e proíbe repetir,
  "nem em parte, nem resumida"; a linha da FASE ATUAL lembra que o nome da
  fase é termo técnico e passa pelo glossário. Entraram no glossário
  "mandado não cumprido" e "o que entender de direito".

Depois (mesma pergunta, mesmo grupo):

> O processo está na **fase de ajuizamento, que é quando a gente entrou
> com o processo na Justiça**. […] o juiz pediu para a gente se manifestar
> sobre **um mandado que não foi cumprido, ou seja, o oficial de justiça
> não conseguiu entregar um aviso**.

### A frase que se contradizia — e o dado que a causava

> "O que teve movimentação mais recente foi o da ação de indenização,
> **que continua sem novidades**."

As duas metades se anulam. Não foi invenção do modelo: ele juntou, com
honestidade, duas fontes que discordavam — e não tinha a data para
desempatar.

**Medido em 05/09/2026, nos 644 processos dos grupos do piloto:**

| `lead_processes.data_ultima_movimentacao` | processos |
| --- | --- |
| NULA, com andamento gravado | **333** |
| ATRASADA em relação ao andamento real (pior: **1363 dias**) | **140** |
| correta | **30** |
| sem andamento nenhum (aí vazia está certa) | 141 |

**473 dos 503 processos com movimento — 94% — carregavam data errada ou
vazia.** Na base inteira, 2091 de 2686 não têm data nenhuma.

E o estrago passava do campo: o `order by ord desc nulls last` da lista de
processos usava essa mesma coluna. Com ela nula em 333 processos, a lista
chegava ao modelo praticamente sem ordem — e a regra dos três degraus manda
justamente "conte o que aconteceu de mais recente em UM deles". Estávamos
pedindo uma resposta que o contexto não permitia dar.

**Por que o feed é confiável e a coluna não:**

| fonte | linhas | tipo | datas no futuro |
| --- | --- | --- | --- |
| `process_updates` | 5741 | `date` | **0** |
| `jm_decisoes` | — | `date` | **0** |
| `lead_processes.data_ultima_movimentacao` | 2686 | `text` | **16** |

A coluna é campo de cadastro, preenchido por sincronização que falha calada.
O feed é o registro de quem viu acontecer. Passa a mandar o feed.

**Detector, não filtro** (CLAUDE.md, processo e rigor #8): a coluna errada
não é escondida. Continua saindo em `ultima_movimentacao_cadastro`, e
`cadastro_desatualizado` marca a divergência. A fila de conserto da
sincronização é exatamente:

```sql
select p ->> 'numero', p ->> 'ultima_movimentacao', p ->> 'ultima_movimentacao_cadastro'
from dom_grupos_piloto g,
     lateral jsonb_array_elements(dom_contexto_processual(g.group_jid) -> 'processos') p
where g.ativo and (p ->> 'cadastro_desatualizado')::boolean;
```

Ainda **falta** ligar essa fila na rotina do Escavador — hoje ela é uma
consulta, não um gatilho. É o próximo passo, não está feito.

Mais duas coisas que saíram junto:

- `processo_mais_recente` no topo do JSON, e a lista ordenada pela data real.
  O modelo parou de adivinhar qual andou por último.
- `blocoAtividade` compara a data da anotação com a da movimentação: se o
  processo mexeu **depois** da nota, o prompt avisa que a nota está velha.

Depois da correção, mesma pergunta, mesmo grupo:

> "Você tem sete processos com a gente. O que teve movimentação mais
> recente foi o trabalhista, **em 24 de julho**, que está na fase de
> instrução, **ou seja, é o momento de juntar as provas e ouvir as
> pessoas**. […] a próxima audiência de encerramento de instrução está
> marcada para 22 de outubro."

### Migrations que existiam só em produção

Quatro mudanças de 05/09 foram aplicadas direto no banco e não tinham
arquivo no repositório: `dom_texto_limpo`, `dom_grupos_para_olhar`, as
colunas de áudio em `dom_respostas_pendentes` e `genero_voz` em
`wjia_command_shortcuts`. Uma sessão futura leria `dom_contexto_processual`
na versão de 04/09 e concluiria, errado, que fase e documentos não chegam
ao prompt.

Reconstituídas em `20260905120000_dom_contexto_estado_de_producao.sql`,
todas como `create or replace` / `add column if not exists` — reaplicar é
seguro e não muda nada.

### Onde mora o histórico, e por que o ponteiro atrasava

O histórico **sempre esteve certo**. Duas tabelas, uma linha por evento, nada
sobrescrito:

| tabela | o que guarda | chave | volume |
| --- | --- | --- | --- |
| `process_updates` | cada movimentação | `process_id` (NOT NULL) + `numero_cnj` | 5741 linhas |
| `jm_decisoes` | cada decisão | `processo_cnj` | — |

Colunas de `process_updates`: `data_movimentacao` (`date`), `categoria`,
`titulo`, `descricao`, `resumo_ia`, `origem` (`escavador` \| `email_push`),
`eventos` (jsonb), `data_presumida`, `conteudo_hash` (dedupe).
Chave única: `(process_id, conteudo_hash)` — reprocessar não duplica.

O feed é saudável: **1691 movimentações ingeridas nos últimos 7 dias**,
2875 do Escavador e 2866 de e-mail push.

O que faltava era o **ponteiro**: `lead_processes.data_ultima_movimentacao`,
o campo que diz "a mais recente é esta". Ele é escrito **só quando alguém
cadastra ou edita o processo na mão** (`AddProcessDialog`,
`ProcessDetailSheet`) — uma foto tirada uma vez. Nada o atualizava quando
chegava movimentação nova.

Consequência que passou anos invisível: `StaleProcessesReport.tsx` filtra
`.not('data_ultima_movimentacao', 'is', null)`. A tela feita para achar
processo esquecido **não enxergava 1136 dos 1731 processos** — dois em cada
três.

**Corrigido em 05/09/2026** (`20260905214000`):

1. `lead_processes_sem_duplicata` passou a checar só quando o UPDATE mexe em
   `process_number` ou `lead_id`. Duplicata só nasce de CNJ ou de cliente;
   editar o título não cria duplicata nenhuma. Antes ele refazia a checagem
   inteira em toda edição — e como **100 fichas já eram duplicatas antes do
   gatilho existir**, elas estavam congeladas: qualquer salvamento levantava
   "Processo já cadastrado", que parece explicação e não é.
2. Backfill de **926 processos** (597 vazios + 329 atrasados), com o valor
   antigo guardado em `lead_processes_ult_mov_backup_20260905`. Rollback é um
   `update ... from backup`.
3. Gatilho `AFTER INSERT` em `process_updates` e `jm_decisoes`: cada
   movimentação nova empurra a data. **Só para frente** — reprocessamento com
   movimentação antiga não faz a data andar para trás. **Data presumida não
   conta**: `data_presumida = true` é chute do parser quando o e-mail não
   trazia data, e deixar chute definir "última movimentação" trocaria coluna
   vazia por coluna mentirosa. O histórico não é tocado.

Testado em transação com rollback: uma movimentação de hoje levou
`5002486-69.2021.8.13.0042` de 17/06 para hoje; a de data presumida em
`current_date + 5` foi ignorada. Zero linhas de teste ficaram na base.

**Sobra, e está dito:**

- **539 processos** continuam sem data porque não têm movimentação nenhuma no
  feed. Não é dado errado, é dado ausente — são fichas digitadas na mão que
  nunca entraram na fila de monitoramento (nenhuma está em `jm_processos`,
  nenhuma tem linha em `jm_esc_solicitacoes`). A solução é colocá-las na fila,
  não inventar data.
- **16 datas no futuro** continuam lá, todas vindas de digitação manual. O
  backfill não as toca porque só avança, e o feed não tem data futura. O
  detector do `blocoProcessual` já as marca com `[REVISAR]`.

### Panorama: quando a regra se inverte

Os três degraus resolvem "o cliente perguntou do caso dele". Não resolvem
"o cliente quer saber de tudo" — aí omitir é que é a falha.

Quem decide qual das duas regras vale é o **classificador**, não uma lista
de palavras. Ele passou a devolver um terceiro campo:

```json
{"intencao":"A1","conversa_encerrada":false,"quer_panorama":true}
```

com a instrução de julgar pelo sentido ("Na dúvida, false: perguntar de
qual caso ele quer custa uma frase; despejar dez processos em cima de quem
queria um custa a conversa"). O `dom-rascunho` repassa `panorama` ao
`dom-contexto`, que troca o bloco inteiro:

| | regra |
| --- | --- |
| `panorama: false` | três degraus — 1 processo, 2-3, ou 4+ (não lista) |
| `panorama: true` | um parágrafo por processo, **sem pular nenhum** |

**A regra vive num lugar só.** As duas nunca aparecem no mesmo prompt, e a
`instrucaoDaIntencao` (que é o último bloco, a posição mais forte) apenas
aponta para a que estiver valendo. Foi a lição de listar quatro de sete.

Verificado em 05/09/2026, grupo Caso 217 (7 processos):

| pergunta | `panorama` | resposta |
| --- | --- | --- |
| "tem novidade do inventário do avô?" | false | só o inventário, 467 car. |
| "me atualiza de tudo, como estão todos?" | **true** | os 7, um parágrafo cada, 1444 car. |
| "boa tarde, tudo bem? alguma novidade?" | false | são sete, o mais recente em 24/07, quer ver outro? 377 car. |

**O primeiro panorama saiu com dois defeitos**, e os dois vieram da mesma
causa: quando se lista vários casos é obrigatório nomear cada um, e sem uma
fonte de nome sancionada o modelo pega a única coisa única que enxerga.

1. Nomeou os sete pelo **número do processo** — proibido em toda mensagem.
   Corrigido apontando a fonte: `Assunto` + `Classe` do bloco de andamento,
   mais de quem é o caso. A `Classe` nem estava sendo enviada ao prompt;
   passou a ser.
2. Pôs cada nome em `**negrito**`. O WhatsApp não entende `**` — o cliente
   leria os asteriscos na tela. Proibido explicitamente.

Depois: sem número, sem asterisco, os sete nomeados por assunto ("o
trabalhista da indenização", "o do reconhecimento de união estável", "o
inventário do avô do Bruno").

Sobrou um: `O processo cível "Autor vs Réu"`. É o título literal do
cadastro — o texto padrão do formulário, nunca preenchido — e o registro
não tem Classe nem Assunto para o modelo usar. A mensagem escancara o
cadastro ruim em vez de escondê-lo, e esse processo está na fila do
Escavador, que vai trazer classe e assunto.

### Os 539 sem feed foram para a fila

Nenhum dos 539 processos sem movimentação estava em `jm_processos` nem
tinha linha em `jm_esc_solicitacoes`: são fichas digitadas na mão que nunca
entraram no monitoramento.

Enfileirados em 05/09/2026: **403** (`status='A_ENVIAR'`, `modo='PUBLICOS'`,
ids 599–1001). Ficaram de fora 91 com CNJ inválido (não tem 20 dígitos, não
dá para consultar) e 43 que já tinham solicitação.

**Custo, medido no histórico:** ~20 créditos por consulta PUBLICOS → **~8.060
créditos**. Para comparar, foram 9.685 gastos entre 10/07 e 05/09. Taxa de
acerto histórica: de 486 consultas com SUCESSO, 327 trouxeram movimentação e
159 voltaram vazias (**33%**) — então espere ~2.600 créditos sem retorno.

O cron `jm-esc-rotina` drena 15 a cada 20 minutos (45/h), ou seja ~11h com
a fila que já existia. **Para parar no meio:**

```sql
delete from jm_esc_solicitacoes where status = 'A_ENVIAR';
```

### A fila do Escavador corria atrás do próprio rabo

Enfileirei 403 processos em 05/09 e afirmei que drenariam em ~11h. **Estava
errado: não drenou nenhum.** Seis horas depois a fila estava exatamente onde
eu a deixei.

`jm_esc_rotina` roda a cada 20 min, nesta ordem:

```
destravar(2) → confirmar() → colher_docs() → disparar(15)
```

E o `destravar` decidia pelo carimbo errado:

```sql
where status = 'ENVIANDO'
  and criado_em < now() - make_interval(hours => 2)   -- ← criação, não envio
```

`criado_em` é quando a **linha** foi criada, não quando a consulta foi
**enviada**. Uma linha criada em 17/08 é sempre "mais velha que 2 horas".
Então, a cada rodada:

1. `destravar` (que roda **primeiro**) arrancava a linha de `ENVIANDO` e a
   devolvia para `A_ENVIAR` — mesmo tendo sido disparada 20 minutos antes;
2. `confirmar` não achava mais nada em `ENVIANDO` e fechava zero;
3. `disparar` pegava as 15 de menor id — exatamente essas — e mandava de novo.

Quem devia destravar o que travou estava desarmando o que acabou de sair,
antes de alguém conferir se chegou.

**Medido em 05/09/2026, 23h50:** `jm_esc_rotina(0)` devolvia
`destravadas=15 confirmadas=0 disparadas=0`. As 15 estavam em `ENVIANDO`
desde 17/08, com `escavador_id` nulo.

E como o `disparar` ordena por id e essas 15 tinham os menores, elas
consumiam a fila inteira: **as 403 (ids 599–1001) nunca seriam alcançadas.**
Cabeça de fila entupida trava todo mundo atrás.

**Custo do loop: zero.** As 15 voltam `422 NUMERO_CNJ_INVALIDO` com
`creditos: null` — o Escavador não cobra por CNJ que ele nem aceita. Foi
desperdício de rodada, não de dinheiro.

**Conserto (`20260906001500`), duas partes:**

1. **`enviado_em`** — o carimbo certo. O `disparar` grava a hora do envio; o
   `destravar` compara com `coalesce(enviado_em, criado_em)`. O `confirmar`
   ganha a chance de fechar: as respostas ficam 30 min em
   `net._http_response`, e agora a janela cabe.
2. **`tentativas`** com teto 3. Uma linha que falha sempre voltava para a
   cabeça da fila e bloqueava todo mundo, para sempre. Ao bater o teto ela
   vira `ERRO` e sai da frente. Tentar eternamente não é resiliência: é fila
   parada com cara de fila andando.

**Verificado em produção, ciclo completo:**

| passo | antes | depois |
| --- | --- | --- |
| `jm_esc_rotina(2)` | — | `destravadas=15 confirmadas=0 disparadas=2` |
| `jm_esc_rotina(0)` | `destravadas=15 confirmadas=0` | **`destravadas=0 confirmadas=2`** |

As duas (ids 137, 138) foram para `ERRO` — que é o que deveria ter
acontecido em 17/08 — e o menor id em `A_ENVIAR` saiu de 137 para 282: a
cabeça da fila andou.

Restam 13 travadas da mesma safra; elas seguem o mesmo caminho nas próximas
rodadas. Depois disso a fila anda a 15 por 20 min (45/h), e as 403 entram
atrás das 84 antigas — aí sim ~11h.

**Achado à parte, não consertado:** a URL dentro do `jm_esc_disparar` carrega
a chave `?k=…` em texto puro, e ela já está hardcoded em 4 migrations e no
`esc-autos/index.ts` (`const GUARD`). É exposição pré-existente, não nova —
mas está no repositório e merece rotação.

### A corrente do documento está partida em dois lugares (06/09/2026)

O conserto do `destravar` funcionou: em 8h a fila saiu de 500 para 196, com
`max_tentativas = 1` em quase tudo (nada ciclando), 0 erros de transporte e
**5.585 créditos** gastos.

Mas o resultado dos meus 403 conta outra história:

| dos 191 que deram SUCESSO | |
| --- | --- |
| trouxeram **documento** (metadado) | **182** |
| trouxeram **movimentação** | **0** |
| entraram em `jm_processos` | 5 |

O modo `PUBLICOS` do Escavador enche `jm_documentos`, **não**
`process_updates`. E o caminho de um documento até a resposta do cliente tem
quatro degraus:

```
1. consulta Escavador  → linha em jm_documentos (só metadado)   ✅ funcionando
2. download do arquivo → storage_path preenchido                ❌ PARADO
3. leitura pela IA     → jm_documento_leitura.resumo            ❌ PARADO
4. entra no prompt     → blocoProcessual só usa doc COM resumo  ⛔ inalcançável
```

**Degrau 2 está morto há 12 dias.** Último `stored_at`: **25/08 22:07**.
Hoje há **3.246 documentos só com metadado**, sem arquivo nenhum.

**Degrau 3 está morto há 3 dias.** Última leitura: **03/09 21:16**. E é
consequência do degrau 2 — `jm_ler_documentos_tick` exige
`storage_path is not null`, então ele roda a cada 2 minutos, "succeeded", e
seleciona zero linhas. Dos 3.270 documentos sem leitura, só 24 têm arquivo,
e esses 24 já foram disparados sem produzir resultado (`jm_ler_documento`
falhando neles).

**O que isso significa em dinheiro:** os créditos compram metadado que fica
parado no degrau 1. Nada se perde — o metadado é durável e os arquivos podem
ser baixados quando o degrau 2 voltar — mas **nada disso chega ao cliente
hoje**, e nenhum dos 403 vai preencher `data_ultima_movimentacao`, que era o
motivo de eu tê-los enfileirado.

Três pipelines quebrados em sequência (fila do Escavador, download, leitura)
não é coincidência: é um encadeamento longo onde cada elo falha calado e o
cron reporta "succeeded" em todos eles. O padrão comum é o mesmo dos outros
defeitos desta sessão — **a etapa devolve sucesso por ter rodado, não por ter
feito**.

Ainda em aberto, decisão do usuário:
- consertar o degrau 2 (download) antes de gastar mais crédito;
- se `data_documento` conta como movimentação (gatilho em `jm_documentos`);
- parar ou deixar a fila terminar: `delete from jm_esc_solicitacoes where status = 'A_ENVIAR';`

### Degrau 2 consertado: o download nunca teve cron

A ação que baixa a peça do Escavador para o bucket é `acao: "arquivar"` do
edge `esc-autos`. Ela existe, funciona, e **nunca teve cron**. Alguém rodava
na mão. A última vez foi **25/08/2026 às 22:07**.

Não era um bug no código do download — era um degrau que dependia de alguém
lembrar. Doze dias sem ninguém lembrar, e a cascata:

| | |
| --- | --- |
| documentos com link e sem arquivo | **4.761** |
| leituras nas últimas 24h | **0** |
| documentos chegando ao prompt | **0** |

O degrau 3 (`jm_ler_documentos_tick`) exige `storage_path is not null`. Sem
o degrau 2, ele roda a cada 2 minutos, reporta `succeeded`, e seleciona zero
linhas — verde, e sem fazer nada.

**Conserto (`20260906074500`), duas partes:**

1. `jm_esc_arquivar_tick()` + cron `jm-esc-arquivar` de 5 em 5 minutos. A
   ação `arquivar` já é auto-limitada (orçamento 110s, lotes de 60,
   concorrência 8) e repete até esvaziar a fila ou estourar o tempo. Como
   5 min > 110s, rodadas não se sobrepõem.

2. **Erro passageiro deixa de ser sentença.** A seleção do `arquivar` é
   `storage_path is null and storage_error is null` — ou seja, qualquer falha
   exclui a linha **para sempre**. Dos 139 excluídos, 138 eram `HTTP_404`
   (a peça não existe mais no Escavador: permanente, exclusão correta) e
   **1 era falha do nosso próprio storage** — passageira, e mesmo assim
   condenada. O tick agora limpa o erro das famílias passageiras depois de
   6h. `HTTP_4xx` e `NAO_PDF` seguem permanentes: documento que não existe
   não passa a existir por insistência.

**Custo: zero crédito do Escavador.** O `arquivar` só baixa o que a consulta
já pagou. O gasto é storage e banda.

**Verificado em produção, corrente inteira, 06/09 11h50:**

| degrau | antes | depois |
| --- | --- | --- |
| 2 · download | último em 25/08 22:07 | **390 peças em 30 min** |
| 3 · leitura | última em 03/09 21:16 | **10 lidas, 10 com resumo** |
| 4 · prompt | 0 documentos | **12 peças** no contexto do grupo Caso 118 |

O grupo `Caso 118- Flávio (MT-MA)` (3 processos) passou de zero para **12
peças lidas** dentro do bloco "O que as peças do processo dizem". Uma delas:
*"A decisão recebe os recursos ordinários interpostos pelas partes, intima
para contrarrazões e remete os autos ao Tribunal Regional."* — exatamente o
tipo de fato que o assessor precisava para responder e não tinha.

**Ritmo e o que falta:** o download faz ~780/h e a leitura ~300/h. Com 4.400
ainda na fila de download, o download termina em ~6h e a leitura fica atrás,
levando ~16h no total. A leitura consome tokens de LLM por documento —
`jm_documento_leitura.custo_estimado` está **nulo em toda a base**, então
não consigo dizer o custo pelo banco. É a única parte desta corrente cujo
gasto eu não sei medir.

Rollback: `select cron.unschedule('jm-esc-arquivar');`

### A peça conta como movimentação — e um vazamento que apareceu no caminho

Decisão do usuário em 06/09: `data_documento` conta como movimentação.

**A validação que veio antes de mexer.** `jm_documentos`: 9.523 linhas, zero
sem data, zero no futuro, zero antes de 2000, faixa de 10/12/2013 a ontem.
E o teste que decidiu — nos 359 processos que têm peça **e** movimentação:

| | processos |
| --- | --- |
| datas idênticas | 22 |
| dentro de ±7 dias | 113 |
| peça **mais velha** que a movimentação | **240** (média −55 dias) |
| peça mais nova por mais de 7 dias | 3 (máx +54) |

Se `data_documento` fosse a data de captura, todas estariam amontoadas em
"baixado agora". Estão espalhadas no passado, quase sempre atrás da
movimentação: **é a data do ato**. E o efeito colateral é bom — como a peça
costuma ser mais velha, o `greatest()` raramente sobrepõe data boa, ele
preenche buraco.

**Resultado:** 503 processos corrigidos — **399 ganharam data do zero**, 104
tiveram a data avançada. Os sem data caíram de 539 para 139.

**A definição mudou nos dois lugares**, de propósito: o gatilho (que escreve
a coluna) e `dom_contexto_processual` (que monta o prompt) usam a mesma lista
de origens. Deixar só um saber de documentos recriaria a doença desta sessão
— duas regras discordando sobre o mesmo fato, e o modelo desempatando
sozinho.

Gatilho testado em transação com rollback: peça de hoje empurrou a data;
peça **oculta** e peça com data **no futuro** foram ignoradas.

#### O vazamento entre clientes

Conferindo se as duas verdades batiam, duas linhas discordaram. Não era
inconsistência — era um `process_number` com o texto
`"reprotocolar-cliente nao foi p perícia"`.

`dom_so_digitos` devolve **string vazia** para qualquer texto sem número:

```sql
select dom_so_digitos('Não protocolado');   -- ''
```

Há três fichas assim (`"."`, `"Não protocolado"`, `"reprotocolar-cliente…"`).
Do outro lado, `process_updates` tem **12 linhas com `numero_cnj` nulo**, que
viram `''` pela mesma função. O join `'' = ''` casava as duas pontas: essas
fichas puxavam as 12 movimentações órfãs e ganhavam a data 17/06/2026.
**O assessor contaria a um cliente a movimentação de um processo que não é
dele.**

| a ficha `"reprotocolar-cliente…"` | antes | depois |
| --- | --- | --- |
| `ultima_movimentacao` | 2026-06-17 | **nulo** |
| andamentos | **12** | **0** |
| documentos | 0 | 0 |

O conserto é `nullif(dom_so_digitos(...), '')`, aplicado em **todas** as
junções por CNJ (andamentos, documentos, decisões, audiências). NULL não casa
com NULL num join — que é a resposta certa para "não sei de qual processo
isto é".

Os dois backfills desta sessão **não** foram contaminados: o de 05/09
filtrava `numero_cnj is not null`, o de 06/09 vem de `jm_documentos`, que não
tem linha sem dígito. Conferido nas tabelas de backup, zero em cada.

**Ainda aberto:** 958 fichas têm `process_number` que não é CNJ — a grande
maioria nula, três com texto. O campo aceita qualquer coisa. Não é vazamento
mais, mas é cadastro que ninguém valida na entrada.

### `process_number` validado na entrada

O campo aceitava qualquer coisa, e isso custou caro duas vezes: as três fichas
com texto no lugar do número (que abriram o vazamento entre clientes) e os
CNJs inventados que ficaram três semanas girando na fila do Escavador.

**O campo não guarda só CNJ.** Medido em 06/09/2026, 2.689 fichas vivas:

| | fichas | |
| --- | --- | --- |
| número nulo | 955 | legítimo |
| CNJ com 20 dígitos | 1.326 | **todos passam no verificador** |
| menos de 20 dígitos | 403 | NB do INSS (197), protocolo/BO (141), processo administrativo federal (14), internos |
| mais de 20 dígitos | 2 | um do Ministério Público, um CNJ com dígito a mais |
| texto sem número | 3 | `.`, `Não protocolado`, `reprotocolar-cliente…` |

Por isso a regra **não** é "tem que ser CNJ" — isso rejeitaria 403 cadastros
legítimos e quebraria o trabalho de quem usa o campo para requerimento.

**A regra, estreita e mirando só o que já deu errado:**

| entrada | o que acontece |
| --- | --- |
| nulo, vazio ou só espaço | aceita, vira nulo. "Sem número" é resposta honesta |
| sem dígito nenhum | **recusa** — anotação não é número |
| exatamente 20 dígitos | tem que passar no verificador; grava canônico `NNNNNNN-DD.AAAA.J.TR.OOOO` |
| qualquer outro | aceita, só aparando espaço |

`cnj_valido()` **só conferia o comprimento** — nunca o verificador. Foi assim
que `0000240-19.2025.5.11.0152` entrou. Agora confere de verdade (Res. 65/2008:
remontado sem o DD e com ele no fim, o número deixa resto 1 na divisão por 97).

Conferido contra dado real **antes** de virar trava: 1326 de 1326 CNJs da base
passam, os 3 recusados pelo Escavador reprovam, e um dígito trocado de
propósito reprova.

**Só confere quando o número muda.** Editar o título de uma ficha antiga com
número torto continua funcionando — foi exatamente o erro do gatilho
anti-duplicata, que refazia a checagem em toda edição e deixou 100 fichas
impossíveis de salvar sem ninguém perceber.

Testado em transação com rollback:

| caso | resultado |
| --- | --- |
| `00108807620255030160` (colado) | vira `0010880-76.2025.5.03.0160` |
| `0000240-19.2025.5.11.0152` | **recusa**: "o correto seria 16, e não 19" |
| `Não protocolado` | **recusa**: "não tem um dígito sequer" |
| NB `1004690362`, protocolo, B.O. | passam |
| `'   '` e `null` | viram nulo |
| editar título de ficha antiga torta | funciona |

**Sobrou uma decisão sua.** A limpeza dos espaços abortou no gatilho
anti-duplicata: aparar o espaço de `0056732-43.2026.4.05.8300 ` revela que
**existem duas fichas do mesmo processo, no mesmo cliente** — o espaço era o
disfarce. Aparei os outros três e deixei esse. Qual das duas fichas fica é
decisão do dono do caso.

O erro da migration foi a informação: sem ele, ninguém saberia que as duas
eram a mesma.

### As duas fichas duplicadas viraram uma — e o que a fusão revelou

Resolvidos os dois casos que estavam em aberto. Nenhum dos dois era descarte:
nas duas vezes a ficha "errada" carregava algo que a "certa" não tinha.

**Caso 1 — `0056732-43.2026.4.05.8300`, cliente único, duas fichas.**

| | `13d685de` "BPC DEFICIENTE" (04/08) | `d55c896e` "PREV 174" (20/08) |
| --- | --- | --- |
| dados do processo | TRF5, 15ª Vara Federal, R$ 29.178, 8 movimentações | nenhum |
| POP / etapa | POP-BPC, marco de ajuizamento | nenhum |
| atividades | 3 | 1 |
| **intimações por e-mail** | **0** | **3 — uma delas um PRAZO** |

A ficha "vazia" não era vazia: era para onde o push de e-mail vinha mandando as
intimações. "Publicado Intimação para Emendar em 31/08/2026" caiu na casca —
sem POP, sem etapa, sem histórico — enquanto quem acompanha o caso olhava a
outra. Fundidas: a que fica tem agora 4 atividades e 11 linhas de feed, e o
rótulo interno virou parte do título (`BPC DEFICIENTE — PREV 174`) para a
equipe não perder o índice que usa.

**Caso 2 — `1505819`: eram três fichas, não duas.**

A terceira (`4ac5e67f`, outro cliente) **não** é duplicata — é litisconsórcio, e
a trava permite de propósito. Das duas do mesmo cliente, a de CNJ correto
(`ab73a87e`) tinha os dados mas nenhum responsável e título "Processo"; a do
CNJ torto (`a3d2f961`, 21 dígitos) tinha o título bom, o responsável e duas
atividades — **uma ainda pendente**. Por isso fusão: a que fica herdou título,
responsável e as duas atividades.

**O `process_title` também carregava o erro.** É campo desnormalizado: o card da
atividade mostra aquele texto, não a ficha. Mover só o `process_id` deixaria
`1505819-97.2025.8.26.03788` vivo na tela. Mesma coisa com `numero_cnj` e
`processo_titulo` no feed.

**E a última movimentação não se recalcula sozinha.**
`lead_processes_avanca_ultima_movimentacao` roda `AFTER INSERT` em
`process_updates`. Mover linha é UPDATE: o gatilho não dispara. Sem recalcular
à mão, a ficha ficaria com a data de antes da fusão.

Tudo reversível: `zz_fusao_fichas_bkp_20260907` guarda as 10 linhas inteiras em
jsonb com o `process_id` antigo. As fichas saíram por `deleted_at`, não por
`delete` — a tabela tem `trg_lead_processes_no_hard_delete` justamente para isso.

### O buraco do 21º dígito, fechado

`a3d2f961` foi criada em **25/08, depois** da trava anti-duplicata (24/08).
Passou porque a trava só age com exatamente 20 dígitos:

```
if v_cnj is null or length(v_cnj) <> 20 then return new; end if;
```

Com 21 ela é outro número. E a validação de 06/09 tinha o mesmo ponto cego —
essa ficha torta entraria de novo hoje, igualzinha.

A regra nova confere pela **forma**, não pelo tamanho: número escrito na máscara
do CNJ (`^[0-9]+-[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$`) tem que ser um CNJ de
verdade. Fora dessa máscara, nada muda — o procedimento do MP
`02.16.0079.0389620/2026-57` tem 21 dígitos e é legítimo.

Conferido contra a base antes de virar trava: **1.322** fichas com cara de CNJ
passam, **1** reprova (o typo), **413** de outro formato não são tocadas.
Testado nos oito casos que importam:

| entrada | resultado |
| --- | --- |
| `1505819-97.2025.8.26.03788` | recusa: "tem 21 dígitos, e CNJ tem 20" |
| `02.16.0079.0389620/2026-57` (MP) | aceita |
| `00108807620255030160` | vira `0010880-76.2025.5.03.0160` |
| `0000240-19.2025.5.11.0152` | recusa: "o correto seria 16, e não 19" |
| `1004690362` (NB) | aceita |
| `150581-97.2025.8.26.0378` (1 dígito a menos) | recusa |
| `0056732-43.2026.4.05.8300` | aceita |
| `Não protocolado` | recusa |

### O defeito estrutural que fundir ficha NÃO resolve

`supabase/functions/sync-email-push/index.ts:167` monta o índice assim:

```ts
porChave.set(chaveIdentificador(cls.tipo, cls.digitos), p)
```

percorrendo as fichas em `order by id`. Quando duas têm os mesmos dígitos, a
segunda **sobrescreve a primeira em silêncio**. Não há erro, não há aviso: uma
das duas simplesmente deixa de existir para o push. Quem recebe a intimação é
decidido por ordem de UUID.

Medido em 07/09/2026, fichas vivas com dígitos repetidos:

| | grupos | fichas |
| --- | --- | --- |
| mesmo cliente — duplicata de verdade, fundir resolve | 37 | 89 |
| **clientes diferentes — litisconsórcio, fundir NÃO resolve** | **16** | **37** |

Os 16 de litisconsórcio são o problema real: são dois clientes que legitimamente
dividem o mesmo CNJ, e nunca vão virar uma ficha só. Hoje um dos dois não recebe
intimação nenhuma.

**Não é teoria.** Em `0010657-76.2024.5.18.0052`, dois clientes:

| ficha | intimações | primeira | última |
| --- | --- | --- | --- |
| `28add5ed` | 12 | 12/08 | **22/08** |
| `3be53d75` | 10 | **30/08** | 04/09 |

Disjuntas no tempo, sem uma única sobreposição. A ficha do primeiro cliente
**parou de receber** e ninguém foi avisado. (Por que virou em 30/08 é hipótese —
provavelmente a segunda ficha só ganhou o número naquele momento, e o índice
pula ficha sem número. O corte em si está medido.)

O conserto é no código, não no dado: o índice precisa ser um-para-muitos e
espalhar a movimentação para todas as fichas do CNJ. **Ainda não feito** — é
mudança no pipeline do push e pede seu próprio ciclo de leitura e teste.

**Também ainda aberto:** os 37 grupos de duplicata de verdade (89 fichas). Cada
um pede a mesma leitura caso a caso feita aqui — qual ficha tem o dado e qual
tem o cuidado nem sempre é a mesma.

### A leitura de peça passa a dizer por que falhou

Em 07/09/2026, **73 peças baixadas nunca viraram leitura** — a mais antiga
parada desde 12/07 — e nenhuma delas deixou rastro. Três camadas de silêncio
empilhadas:

1. `jm-ler-peca` devolve **HTTP 200 em toda falha**, com `{success:false}` no
   corpo. Do ponto de vista do banco, deu certo.
2. `jm_ler_documento` chama com `perform net.http_post(...)` — **descarta a
   resposta**. Ninguém lê o corpo.
3. `jm_documentos` não tinha onde guardar erro de leitura. Só
   `leitura_disparada_em`, que diz que saiu, nunca que chegou.

O tick redispara a cada 24h. Resultado: peça falhando desde julho, pagando uma
chamada de Gemini por tentativa, sem uma linha dizendo por quê. É o interfone
que toca e ninguém atende — quem aperta o botão conclui que atenderam.

**O motivo real**, capturado do `net._http_response` antes de expirar (TTL ~6h):

```
{"success":false,"documento_id":30,"error":"leitura: Expected ',' or '}' after
 property value in JSON at position 6796"}
{"success":false,"documento_id":110,"error":"leitura: Unterminated string in
 JSON at position 818"}
```

O JSON que o Gemini devolve chega cortado e o `JSON.parse` estoura.

**Não é teto de token.** Já está em `maxOutputTokens: 8192`, e corte na posição
818 são ~200 tokens. Há peça de **uma página** entre as travadas. As duas
coisas que diriam qual é a causa — `finishReason` e o número de `parts` — eram
justamente as que o código descartava.

**O que passou a existir:**

| | |
| --- | --- |
| `jm_documentos.leitura_erro` | motivo da última falha, com o diagnóstico da resposta |
| `jm_documentos.leitura_erro_em` | quando |
| `jm_documentos.leitura_tentativas` | quantas vezes já custou uma chamada |
| `vw_jm_leitura_travada` | a lista, com motivo e próxima tentativa |

A `jm-ler-peca` agora escreve nessas colunas em **toda** falha do modo
documento, e limpa quando a peça é lida — erro que fica depois de resolvido
vira alarme falso, e alarme falso ninguém olha. O diagnóstico gravado tem a
forma `finishReason=… partes=N chars=N fim="…"`.

**Uma mudança além do combinado, declarada:** o código lia só `parts[0].text`.
Passou a juntar todas as partes — ler a resposta inteira é o certo qualquer que
seja a causa, e estava nas mesmas linhas.

**E o registro desmentiu a hipótese na primeira rodada.** Disparadas três das
travadas, o motivo gravado foi:

| peça | páginas | diagnóstico |
| --- | --- | --- |
| 30 | — | `finishReason=MAX_TOKENS partes=1 chars=6796` |
| 110 | 12 | `finishReason=MAX_TOKENS partes=1 chars=2579` |
| 1604 | — | `finishReason=MAX_TOKENS partes=1 chars=3069` |

**`partes=1` nas três** — não era resposta partida. Era teto de token mesmo, e
o `fim=` gravado mostra onde: as três cortam dentro do `cronograma`, no meio de
uma parcela (a peça 30 na parcela **39**). Pensão mensal e acordo longo geram
uma lista enorme.

E o número que fecha o caso: **`MAX_TOKENS` com 2.579 a 6.796 caracteres** —
algo entre 600 e 1.700 tokens visíveis, contra um teto de 8.192. O resto do
orçamento não foi para a resposta. `gemini-2.5-flash` é modelo com raciocínio,
e os tokens de pensamento contam contra o mesmo `maxOutputTokens`.

Ou seja: o comentário antigo no código estava certo no sintoma ("sem teto alto
o Gemini corta no meio") e errado na conta — 8.192 nunca foram 8.192 de saída.

**O que NÃO foi feito, de propósito:** não há teto de tentativas. Capar antes
de saber a causa parqueia para sempre peça que voltaria a ler depois do
conserto. O teto se decide depois, com o motivo na mão.

**O modo anexo tem o mesmo `parts[0]`** (`processual_email_anexos`), e ali o
efeito é pior: texto parcial não estoura, entra em silêncio como se fosse a
transcrição inteira. Não mexi — é outro pipeline. Fica anotado.

**Erro meu no caminho, registrado:** o primeiro deploy foi sem passar
`verify_jwt`, cujo default do tool é `true`. A função é chamada pelo banco por
pg_net **sem JWT** — ela tem autenticação própria por `x-jm-key`. A janela com
`verify_jwt=true` durou 150 segundos e nenhuma peça chegou a ser disparada
nela (conferido: zero linhas com `leitura_disparada_em` no período). Redeploy
com `verify_jwt: false` restaurou a v21. **Todo deploy desta função tem que
passar `verify_jwt: false` explicitamente.**

### O teto de token que sufocava a resposta

Com o motivo gravado (seção anterior), o conserto deixou de ser chute.
`maxOutputTokens` subiu de **8.192 para 32.768**.

**A conta que estava errada.** O comentário antigo no código dizia, corretamente,
que sem teto alto o Gemini corta no meio. Só que 8.192 nunca foram 8.192 de
resposta: `gemini-2.5-flash` raciocina antes de responder e **os tokens de
pensamento contam contra o mesmo `maxOutputTokens`** ([Gemini API — Thinking](https://ai.google.dev/gemini-api/docs/thinking)).
Medido nas travadas: `MAX_TOKENS` com **2.579 a 6.796 caracteres** de JSON
visível — entre 600 e 1.700 tokens de saída dentro de um teto de 8.192. O resto
foi pensamento.

É contratar oito horas de serviço e o profissional gastar seis planejando: sobram
duas de trabalho entregue. Não adiantava reclamar do trabalho — faltava hora.

**Por que só subir o teto e NÃO desligar o raciocínio.** Dá para silenciar o
pensamento com `thinkingConfig.thinkingBudget = 0`, e sairia mais barato. Mas
isso muda como o modelo lê a peça, e as **9.091 leituras que já existem foram
feitas com raciocínio** — misturar os dois regimes na mesma tabela é criar uma
inconsistência que ninguém vai lembrar de explicar daqui a seis meses. Subir o
teto corrige a causa medida sem mexer na qualidade. E teto alto não custa:
paga-se pelo token gerado, não pelo limite.

Há também relatos de que o `thinkingBudget` é ignorado em alguns casos
([issue googleapis/python-genai#782](https://github.com/googleapis/python-genai/issues/782)),
o que faria do "desligar" um conserto que não se pode confiar que pegou.

**O que passou a ser gravado junto:** `pensamento=` (`thoughtsTokenCount`),
`saida=` (`candidatesTokenCount`) e `entrada=` (`promptTokenCount`). Se ainda
estourar, o erro diz quanto foi pensamento e quanto foi resposta — que é a
diferença entre subir o limite de novo e capar o modelo.

**E uma trava contra dado pela metade:** se `finishReason` vier `MAX_TOKENS`, a
peça falha explicitamente mesmo que o JSON tenha feito parse. JSON cortado quase
nunca parseia, mas quando parsear seria leitura incompleta gravada como se fosse
inteira — no lugar exato onde alguém vai olhar valor de condenação.

**Verificado em dado real**, nas três peças que falhavam:

| peça | antes | depois |
| --- | --- | --- |
| 30 | cortava na parcela 39 | **leu** — SENTENÇA, **241 parcelas**, 3 partes, R$ 662.000 |
| 1604 | cortava na parcela 6 | **leu** — ACORDO, **45 parcelas**, 3 partes, R$ 900.000 |
| 110 | cortava na parcela ~6 | ainda falha, agora **na parcela 464** |

E a peça 110 é o número que fecha o diagnóstico:

```
finishReason=MAX_TOKENS chars=59511 pensamento=7217 saida=25537 entrada=5447
```

**7.217 tokens de pensamento contra o teto antigo de 8.192** deixavam ~975 para
a resposta — que é exatamente o que se via (2.579 caracteres). Não era o modelo
falando demais; era o orçamento indo quase todo para o raciocínio antes de a
resposta começar.

### O que a peça 110 revelou, e que teto nenhum conserta

Ela é uma pensão mensal com **mais de 464 parcelas** — décadas de pagamento
mês a mês. O prompt manda gerar uma entrada por parcela ("GERE as N entradas
com as datas calculadas"), então o modelo enumera as 464. São ~28 mil tokens só
de `cronograma`, e a peça estoura qualquer teto razoável.

O erro aqui não é de limite, é de desenho: **um cronograma definido por regra
(valor, periodicidade, início, quantidade) está sendo materializado linha a
linha pelo LLM**, que é o lugar mais caro e mais frágil possível para expandir
uma progressão aritmética. Guardar a regra e expandir no banco resolveria a
peça 110 e baratearia todas as outras.

Não foi feito: muda o contrato do JSON, mexe em `jm_documento_leitura.cronograma`
e em quem consome — é decisão de desenho, não conserto de bug. Fica medido e
anotado.

### O cronograma passa a vir como REGRA, e o banco expande

Subir o teto de 8.192 para 32.768 destravou a maioria, mas cinco peças
continuaram estourando — e o diagnóstico gravado mostrou por que **teto nenhum
resolveria**:

```
finishReason=MAX_TOKENS  pensamento=22917  saida=9835  entrada=9576
```

**22.917 tokens só de raciocínio.** O pensamento cresce junto com a
complexidade da peça e disputa o mesmo orçamento da resposta. É corrida
perdida: cada teto novo é comido pelo raciocínio da peça seguinte.

**O erro não era de limite, era de desenho.** Um cronograma definido por regra —
"464 parcelas mensais de R$ 1.736,57 a partir de 05/06/2025" — estava sendo
materializado linha a linha por um LLM. É pedir que alguém escreva "1, 2, 3…
464" à mão em vez de dizer "de 1 a 464". Caro, lento, e sujeito a erro de conta.

**O desenho novo:** o modelo devolve a regra em `cronograma_regra`, e o gatilho
`jm_leitura_expande_cronograma` a expande em `cronograma` — a mesma lista, no
mesmo formato de sempre.

| | |
| --- | --- |
| `jm_documento_leitura.cronograma_regra` | `{n_parcelas, valor_parcela, primeira_data, periodicidade, beneficiario}` |
| `jm_expandir_cronograma_regra(jsonb)` | a expansão, pura |
| gatilho `jm_leitura_expande_cronograma` | preenche `cronograma` **só quando está vazio** |

**Por que no banco e não na edge function:** assim **nada que hoje lê
`cronograma` precisa mudar**. `cronogramaParcelas.ts`, a tela de mudanças da
peça, o financeiro e as 179 leituras que já têm cronograma seguem idênticos.
Muda só quem escreve a coluna.

**Parcela irregular continua enumerada.** A regra serve para a série regular,
que é justamente a que fica grande. Se vierem os dois, o enumerado vence — a
peça manda mais que a regra.

**Teto de 1.200 parcelas** (100 anos de pensão mensal). Acima disso a regra é
recusada em vez de gerar lista absurda: número improvável é detector, não
licença para materializar.

**Periodicidade desconhecida gera parcelas SEM data**, nunca data chutada. Data
errada em parcela é pior que data ausente — uma some do radar, a outra cobra no
dia errado.

Testado em transação com rollback, oito casos:

| caso | resultado |
| --- | --- |
| 464× mensal a partir de 05/06/2025 | 464 parcelas, última em 05/01/2064 |
| começa em 31/01 | 31/01 → 28/02 → **31/03** (não fica preso no 28) |
| 11× quinzenal | 10/03 → 25/03 |
| periodicidade desconhecida | parcelas com valor, **sem data** |
| sem data na regra | parcelas sem data |
| 5.000 parcelas | recusado, lista vazia |
| `n_parcelas: "varias"` | recusado |
| nulo / não-objeto | recusado |

**Verificado nas cinco peças que estouravam**, todas leram:

| peça | resultado |
| --- | --- |
| 1646 | ACÓRDÃO — **367 parcelas** mensais, por regra |
| 8974 | DECISÃO — **612 parcelas** mensais, por regra |
| 11770 | SENTENÇA DE LIQUIDAÇÃO — **522 parcelas** mensais, por regra |
| 25652 | **360 parcelas** mensais, por regra |
| 110 | SENTENÇA DE LIQUIDAÇÃO — leu por outro caminho, ver abaixo |

**A peça 110 leu melhor, e não pelo cronograma.** Ela agora devolve
`SENTENCA_LIQUIDACAO`, R$ 1.051.696,54 de condenação, **6 partes**, **18
verbas** e `meses_pensionamento: 504` — o resumo diz "pensão mensal de
R$ 1.736,57 dividida entre os sucessores do falecido até que completasse 73
anos". O modelo classificou a pensão como VERBA com duração, não como
cronograma de acordo — que é defensável e provavelmente mais correto. Antes ela
enfiava a pensão em `cronograma` (464 linhas) e explodia.

**Fica em aberto, e é decisão de quem revisa:** pensão de 504 meses é ou não é
para virar parcela na carteira? Se for, `meses_pensionamento` + valor da verba
PENSAO_MENSAL já são uma regra — a mesma regra em outra roupa — e daria para
expandir a partir dela. Não fiz: é escolha de negócio, não conserto de bug.

**Resultado da família inteira: 5 → 0.** Das 22 travadas restantes, nenhuma é
mais por teto de token.

### PDF truncado: conferindo o fim do arquivo, não só o começo

Onze peças chegavam ao leitor e voltavam com
`gemini 400: "The document has no pages."` — mas o arquivo estava lá, com
mimetype `application/pdf`, e o Escavador dizia quantas páginas tinha: 9, 18,
23, 24, 54, 57. Documento com página, arquivo guardado, e mesmo assim "sem
páginas".

**Os tamanhos denunciaram.** Sete dos onze eram múltiplo EXATO de 16.384 bytes:

| bytes | ÷ 16.384 |
| --- | --- |
| 32.768 | 2 |
| 311.296 | 19 |
| 442.368 | 27 |
| 475.136 | 29 |
| 688.128 | 42 |
| 851.968 | 52 |
| 1.081.344 | 66 |

PDF real não tem tamanho redondo assim. E o corte cai onde dói: o índice de
páginas de um PDF mora no **fim** do arquivo (xref, trailer, `%%EOF`).
Truncado, ele abre, começa com `%PDF` e não tem página nenhuma.

**A causa no código** (`esc-autos`, ação `arquivar`):

```ts
const magic = new TextDecoder().decode(buf.slice(0, 5));
if (!magic.startsWith("%PDF")) throw ...
```

Conferia os cinco primeiros bytes e concluía que o arquivo estava inteiro. É a
mesma família de defeito que esta sessão já encontrou três vezes: a etapa se dá
por bem-sucedida porque **rodou**, não porque **fez** — aqui, porque o arquivo
COMEÇA como PDF, não porque É um PDF completo. E o preço do silêncio: o defeito
nasceu no download, em agosto, e só apareceu semanas depois, do outro lado do
sistema, disfarçado de erro do Gemini. Quem olhasse o erro procuraria no lugar
errado.

**O conserto** (`esc-autos` v33): o que chegou tem que bater com o
`Content-Length` declarado, **e** o arquivo tem que terminar com `%%EOF`
(procurado nos últimos 2 KB, porque há PDF com lixo depois do marcador).
Falhando qualquer uma, não grava: fica com `storage_error` e volta para a fila.
Arquivo pela metade guardado como bom é pior que ausente — some do radar e
reaparece como defeito de outro degrau.

#### A hipótese que o teste derrubou

Eu escrevi que a conexão tinha morrido no meio da transferência. **Errado.** No
re-download, as sete voltaram com **exatamente o mesmo número de bytes** e sem
`%%EOF`. Repetição idêntica não é conexão instável: **o arquivo já está
truncado na origem**. Nosso download é fiel; quem está quebrado é o Escavador.

E a segunda metade da trava foi a que não serviu: `declarado=?` em todas — a
API **não manda `Content-Length`**. Quem pegou o defeito foi o `%%EOF`.

#### O que o re-download revelou, e o que ainda não está consertado

| família | peças | o que é |
| --- | --- | --- |
| `PDF_SEM_FIM` | 7 | truncadas **na origem**, idênticas a cada tentativa |
| `HTTP_410` | 4 | o link do documento morreu |

**Nenhuma das 11 é legível hoje.** O que mudou é que agora elas dizem a
verdade: em vez de um arquivo mentindo que é PDF e um erro do Gemini apontando
para o lugar errado, há `storage_error` nomeando o defeito no degrau onde ele
nasce.

**O conserto real custa dinheiro e é decisão do dono.** As 11 vêm de **6
processos**; recuperá-las exige nova consulta ao Escavador para regerar
arquivo e link. Medido em 997 consultas: **19,87 créditos em média por
consulta** — cerca de **119 créditos** para os 6 processos.

E elas não estão sozinhas. A base inteira tem **369 arquivos ruins em 61
processos**: 223 com `HTTP_410`, 139 com `HTTP_404` e as 7 truncadas. Re-consultar
todos seria da ordem de **1.200 créditos**.

### Review dos consertos de 07/09 — cinco achados, três meus

O review do range `9730085^..HEAD` (7 commits) achou cinco defeitos. **Três
foram introduzidos hoje, por mim, nos próprios consertos.** Vale registrar
porque o padrão se repete: fechar um silêncio abre outro furo se ninguém olhar.

**1. Laço infinito de download — o mais caro.** `jm_esc_arquivar_tick` devolve à
fila, a cada 6h, todo erro que não casa `^(HTTP_4|NAO_PDF)`. Os erros que criei
hoje — `PDF_SEM_FIM` e `TRUNCADO` — não casam: as 7 peças truncadas na origem
seriam re-baixadas **4× por dia, para sempre**, falhando sempre igual.

Não bastava somar `PDF_SEM_FIM` à lista de erro permanente: a API do Escavador
**não manda Content-Length** (medido, `declarado=?` nas 7), então um corte
genuinamente transitório também chega como `PDF_SEM_FIM` — e seria parqueado
para sempre. Por isso a solução é **teto, não lista**: `download_tentativas`
com limite de 3, o mesmo número da fila de solicitações. Vale para toda a
família de erro passageiro, não só a minha: 5xx e falha de upload também
deixaram de girar sem fim.

**2. A regra recusada era silenciosa.** `jm_expandir_cronograma_regra` devolve
`[]` quando a regra não presta ou passa de 1.200 parcelas — e o cabeçalho que
eu mesmo escrevi prometia "recusada **com aviso**". Não havia aviso: a leitura
ficava idêntica a "peça sem cronograma". Prometi detector e entreguei filtro,
que é o que a regra 8 do CLAUDE.md proíbe. Agora
`vw_jm_cronograma_regra_recusada` lista os casos com o motivo classificado.

**3. Dado de cliente numa coluna de log.** O campo `fim=` do diagnóstico
gravava os últimos 120 caracteres crus da resposta do Gemini em
`jm_documentos.leitura_erro` — que aparece na `vw_jm_leitura_travada`. Isso é
conteúdo de peça: nome de parte, beneficiário, valor. **E já tinha acontecido**:
um erro guardado trazia `"beneficiario": "<nome de uma pessoa real>"`. Violação
direta do princípio 1 de cibersegurança do CLAUDE.md.

Agora os valores de texto viram reticências e as chaves e números ficam — que é
o que diagnostica ("cortou dentro do cronograma, na parcela 464"). Testado em
cinco casos, incluindo o vazamento real, nome cortado no meio (aspas abertas) e
aspas escapadas dentro do texto:

| entrada | saída |
| --- | --- |
| `"beneficiario": "ELOIZZI PIETRA CAVALCANTE SOARES" }, { "n_parcela": 39` | `"beneficiario": "…" }, { "n_parcela": 39` |
| `"descricao": "Retroativo Pensão Mensal (Abril/2025…)", "valor": 3` | `"descricao": "…", "valor": 3` |
| `"nome": "EMPRESA \"X\" LTDA", "valor": 5` | `"nome": "…", "valor": 5` |

Exposição real hoje: **1 linha** com `leitura_erro`, sem texto de peça — as que
tinham nome foram limpas quando as peças foram lidas. O conserto é prospectivo.

**4. A migration não se reproduzia.** `20260907160000` criava a tabela de
backup e nunca a preenchia — o INSERT eu tinha rodado à mão. Num banco limpo a
comparação não existiria. Entrou na migration.

**5. Duas cópias do `esc-autos` no repo, divergentes em 309 linhas.** Só
`supabase/functions/esc-autos/index.ts` (a que bate byte a byte com o deploy
v32, conferido) recebeu a conferência de `%%EOF`. A cópia em
`_external/esc-autos/index.ts` é uma variante tipada que ficou para trás —
**deployar dali reverteria o conserto em silêncio.** Não apaguei arquivo sem
autorização; pus um aviso no topo dizendo que não é a que está no ar. **Qual das
duas deve sobreviver é decisão do dono do repo.**

### Re-consulta dos 6 processos

Autorizada e disparada. As 11 peças vêm de 6 processos, reabertos com
`jm_esc_reabrir_por_cnj` (status `A_ENVIAR`, pegos pela `jm-esc-rotina` a cada
20 min). Custo esperado: ~19,87 créditos por consulta × 6 ≈ **119 créditos**.

Zerei `download_tentativas` das peças desses 6 antes de reabrir, para que os
links novos tenham as três chances cheias.

### O intervalo de 6h entre retentativas de download nunca existiu

Estava escrito assim no `jm_esc_arquivar_tick`:

```sql
and coalesce(stored_at, '-infinity'::timestamptz) < now() - interval '6 hours'
```

A intenção é clara: só devolver à fila quem já esperou 6 horas. Mas `stored_at`
**só é preenchido quando o download dá certo**. Para a peça que nunca baixou —
exatamente a população que a cláusula existe para tratar — `stored_at` é nulo, o
`coalesce` vira `-infinity`, e a condição é sempre verdadeira.

**Retentativa a cada 5 minutos, não a cada 6 horas. 288 por dia, não 4.** O
relógio media o tempo de um sucesso que nunca houve.

**Como apareceu.** Zerei `download_tentativas` das 11 peças às 12:05 e reabri a
consulta para elas ganharem link novo. A consulta terminou às 12:40 e renovou
os links — medido na resposta da colheita: `processados` 10, 22, 35, 54, 65,
100. Só que entre 12:05 e 12:40 o tick já tinha gasto as **três** tentativas do
teto batendo nos links **velhos**. Quando o link bom chegou, a peça já estava
parqueada.

O teto que pus ontem estava certo; o relógio ao lado dele é que estava quebrado
desde sempre. E sem o teto, este defeito seria um laço de 5 em 5 minutos — bem
pior do que os "4× por dia" que estimei ao propor o teto.

Conserto: `download_ultima_tentativa`, que marca **quando se tentou**, não
quando deu certo. As 11 ganharam o teto de volta uma vez, agora com link bom.

### Re-consulta dos 6 processos: o que custou e o que trouxe

| | |
| --- | --- |
| solicitações | 6, todas `SUCESSO` |
| **custo real** | **120 créditos** (20 por consulta) — estimei 119 |
| enviadas | 12:20 · concluídas 12:40 |
| documentos processados | 10, 22, 35, 54, 65 e 100 — **links renovados** |

**Um erro meu de leitura, corrigido:** cheguei a concluir que a consulta não
tinha ingerido nada porque `captured_at` continuava antigo nas 11 peças. Errado
— `captured_at` só é gravado no INSERT; a re-ingestão atualiza `link_api` e não
mexe nele. A resposta da colheita é que prova o que aconteceu, e ela diz que os
links vieram.

### O veredito das 11 peças: nenhuma recuperada

Os 120 créditos compraram links novos. Os links novos servem **os mesmos
arquivos truncados**.

| | antes | depois da re-consulta |
| --- | --- | --- |
| peças recuperadas | — | **0 de 11** |
| peças lidas | 0 | **0** |
| `PDF_SEM_FIM` | 7 | **10** |
| `HTTP_410` | 4 | 1 |

Os bytes voltaram **idênticos** nas dez: 30.360, 24.044, 26.892, 475.136,
1.081.344, 32.768, 311.296, 442.368, 688.128, 851.968. Mesmo número, link novo,
consulta nova. **Isso encerra a dúvida**: o arquivo está truncado na origem, no
acervo do Escavador. Não há nada a fazer do nosso lado.

**O que a consulta efetivamente fez** — e não é nada: três peças que davam
`HTTP_410` (link morto) passaram a **responder com conteúdo**. O link foi
ressuscitado. O conteúdo é que veio cortado. Ou seja, a re-consulta conserta
link morto; não conserta arquivo quebrado.

**O relógio novo funciona.** Uma tentativa às 12:55, e 16 minutos depois ainda
`download_tentativas = 1`. Na lógica antiga já estaria em 3 ou 4.

### O que isso diz sobre os outros 358 arquivos ruins

Sobram **358 peças ruins em ~55 processos**: 223 `HTTP_410`, 139 `HTTP_404` e as
truncadas. Re-consultar todos custaria da ordem de **1.100 créditos**.

A amostra de hoje é ambígua e vale dizer isso: dos 4 links mortos, **3
ressuscitaram** — o que é exatamente o defeito da população de 362. Mas os
arquivos por trás vieram truncados, e os 3 eram do mesmo processo, então não dá
para saber se o problema é "aquele processo" ou "o acervo".

**Recomendação: testar 2 ou 3 processos antes de gastar os 1.100.** ~60 créditos
para descobrir se a população de link morto se recupera, em vez de pagar tudo
para descobrir que não.

### Regra dos três degraus: testada de verdade, com resultado dividido

O teste natural não vinha — só existem 2 grupos com 4 casos e 6 com 3 na base
ativa, e nenhum escreveu desde a mudança. Em vez de esperar dias, forcei pelo
MODO TESTE da `dom-rascunho` (`teste: true` + `group_jid`), que ignora as travas
do cron e **não grava nada**. Confirmado na resposta: `gravou: false`.

Grupo com **4 processos**, duas perguntas:

**1. Pergunta genérica — "Bom dia, tem alguma novidade?"**
`casos: 4 · panorama: false · 298 caracteres`

A resposta falou de **um** processo (o que mexeu por último, com a data da
audiência) e não listou os quatro. **O risco principal não se materializou.**
Mas também não disse que existem outros três, nem perguntou de qual ele queria
saber.

**2. Pedido de panorama — "Quero saber como estão TODOS os meus processos"**
`casos: 4 · panorama: true · 696 caracteres`

Discriminou os quatro, cada um com fase e data, em linguagem de leigo — inclusive
agrupando os dois arquivados. **Passa.** A decisão de "discriminar só quando ela
pedir o panorama" está implementada e funciona.

#### A causa não é desobediência do modelo

Era essa a hipótese registrada no check-in: se ele listasse tudo apesar do
aviso, o conserto seria cortar a lista na origem. **Não é o caso.** A instrução
diz:

> `NÃO liste todos. Responda sobre o que a conversa indica; se não der para
> saber, diga quantos são, conte o mais recente e pergunte de qual ele quer
> saber.`

O "**se não der para saber**" é uma saída, e o modelo a usou legitimamente: com
"tem novidade?" ele julgou que dava para saber, contou o mais recente e parou.
**Ele obedeceu.** O que está ambíguo é a instrução, não o comportamento.

#### A decisão que sobra é de produto, não de código

Cliente com 4 processos pergunta "tem novidade?". A resposta deve:

- **(a)** falar só do mais recente — comportamento de hoje. Enxuto, mas o
  cliente pode entender que aquele é o único caso dele.
- **(b)** falar do mais recente **e** avisar que há outros três, oferecendo
  detalhar. Uma frase a mais, e ninguém sai da conversa achando que viu tudo.

Minha leitura é que (b) é mais seguro — resposta incompleta que parece completa
é pior que resposta longa. Mas isso é escolha de como a casa fala com o cliente,
não conserto de defeito. **Não mexi.**

### Painel de conferência: as fontes ao lado da resposta

O painel mostrava a pergunta do cliente e a resposta sugerida, e mais nada. Quem
revisava tinha que **confiar** — não tinha como conferir.

**O caso que expôs isso** é real, e é o PREV 1050. O cliente perguntou "É 3 ou
4". A resposta disse *"o INSS informou que o benefício foi concedido, mas ainda
não detalhou o número de parcelas"*. E o `ultima_atividade.como_esta` que estava
no contexto trazia:

> Data de pagamento prevista: **22/09/2026** · Valor: **R$ 595,00** · Banco
> BRASIL, Agência 3148

Sobre parcelas a resposta pode estar certa. Mas ela **omitiu data e valor que já
estavam na mão**. Com a fonte ao lado, o revisor pega isso em dois segundos.

**O que passou a aparecer**, lendo o `contexto_usado` que já era gravado:

| bloco | o que mostra |
| --- | --- |
| Movimentação | data, título, resumo, categoria — **com selo de origem** |
| Documento lido | peça, data e resumo, quando houver |
| Requerimento no INSS | serviço, status, resultado, despacho |
| Atividade anterior | título, "como está", próximo passo, e há quantos dias |

**O selo de origem é o ponto que faltava.** "Movimentação" não é uma fonte só:

- no **judicial**, o e-mail do tribunal é o **gatilho** — avisa que mexeu, e a
  partir dele se busca a peça no Escavador;
- no **administrativo (INSS)**, o e-mail é a **única** fonte. Não há peça. Quem
  não sabe disso procura um documento que nunca existiu.

Quando todas as movimentações vêm do e-mail, o painel diz isso em uma linha, em
vez de deixar o revisor concluir sozinho.

**Sem juízo automático, de propósito.** Não há "a IA usou esta fonte para dizer
X". Pedir ao modelo que justifique a si mesmo cria uma segunda coisa para não
confiar. Aqui ficam os fatos que entraram no prompt; quem liga fato e frase é a
pessoa.

**As fontes vêm DEPOIS da resposta na tela**, também de propósito: o revisor lê
a resposta primeiro e depois confere contra o que a máquina tinha na mão. Ao
contrário, a leitura já chegaria enviesada.

**Quando falta fonte, o painel diz o que isso proíbe** — "nenhuma peça foi lida,
a resposta não pode citar conteúdo de documento; se citar, é invenção".

**Conferido no dado real**, amostra de 25 grupos do piloto: **45 movimentações
de e-mail** (8 grupos) e **32 do Escavador** (3 grupos). As duas origens chegam
ao contexto — o pipeline está inteiro; o que faltava era mostrar.

Rascunho anterior a 07/09/2026 não tem `contexto_usado` gravado, e o painel diz
isso em vez de fingir que não havia fonte.

**A conversa do grupo não é copiada para o painel, por decisão do Raym
(07/09/2026):** ela já existe inteira e ao vivo no botão "Abrir a conversa do
grupo", logo abaixo. Guardar uma segunda cópia criaria duas versões da mesma
conversa para divergirem com o tempo. O painel diz isso em uma linha, para quem
revisa não ficar procurando a conversa dentro do bloco de fontes.

### O áudio parava no meio da resposta

No Caso 341 o cliente mandou um áudio pedindo o status de **todos** os processos.
A resposta escrita cobria os dois — auxílio-acidente em ajuizamento e o
trabalhista em Recurso de Revista, com audiência marcada para 22/09. **O áudio
parou em "ajuizamento".**

**A conta:** a resposta tem **1.205 caracteres** e o teto de fala estava em
**500** (`max_tts_chars` nulo → padrão 500, com limite duro de 1.000). O corte
era `limpo.slice(0, maxChars)` — seco, no caractere.

E os 500 nunca foram limite da ElevenLabs: o `eleven_multilingual_v2` aceita
**10.000 caracteres** por chamada ([limites por modelo](https://elevenlabs.io/docs/help-center/product/speech-synthesis/text-to-speech/whats-the-maximum-amount-of-characters-and-text-i-can-generate)).
Era limite nosso, vinte vezes menor que o necessário.

**Áudio que omite metade da resposta é pior que áudio nenhum**, porque soa
completo. O cliente ouviria sobre um processo e nunca saberia do segundo nem da
audiência. É a mesma família do defeito do dia: resposta incompleta que parece
inteira.

**Três consertos:**

| | |
| --- | --- |
| teto | 500 → **3.000** de padrão, limite duro 1.000 → **5.000** |
| corte | no fim da **última frase inteira**, nunca no meio da palavra |
| aviso | quando corta, grava em `audio_erro` **e a tela mostra junto com o áudio** |

O aviso importa: antes, existindo `audio_url`, o `audio_erro` não era exibido —
um áudio pela metade parecia inteiro na tela também.

**Um erro meu, pego no teste.** A primeira versão do corte usava
`lastIndexOf(" ")` como alternativa quando não havia pontuação. Num texto com
pontuação só no começo (`"Curta. xxxxx…"`) ela achava o único espaço, no índice
6, e cortava em **6 de 4.007 caracteres**. A correção é usar metade do teto como
**piso para os dois candidatos**: sem frase nem espaço tarde o bastante, corta
seco no teto. Melhor um corte reto do que meia palavra.

Testado em cinco casos: resposta média (333, não corta), Caso 341 (1.205, não
corta), texto de 4.000 (corta em 2.999 no fim de frase), texto sem pontuação
nenhuma (corta em 2.999 no espaço) e o patológico acima (corta em 3.000).

**Custo:** a ElevenLabs cobra por caractere, então resposta longa passa a custar
mais. A média das respostas com áudio é de **333 caracteres** — a maioria não
muda de preço. Das seis com áudio até hoje, **uma** passava de 500.

**Meio conserto que já valeu, sem deploy:** `max_tts_chars` foi para **3.000** na
tabela do agente. O valor foi escolhido para estar certo nos dois mundos:

| | clamp | resultado |
| --- | --- | --- |
| código **em produção hoje** | `min(max(3000,100), 1000)` | **1.000** — dobra o que era |
| código **depois do deploy** | `min(max(3000,100), 5000)` | **3.000** — conserto inteiro |

Um valor só, sem armadilha para o eu do futuro: não precisa lembrar de mexer de
novo depois de deployar.

**Deployado em 07/09/2026 — `dom-rascunho` v13**, `verify_jwt: true` (mesmo valor
da v12; a ferramenta de deploy assume `true` por padrão e isso já derrubou a
`jm-ler-peca` uma vez — sempre passar o valor explícito). O teto em vigor agora
é **3.000**, e o conserto está inteiro: corte no fim da frase, aviso em
`audio_erro`, aviso na tela.

Verificado depois do deploy, nesta ordem:

1. **Roda**: chamada em MODO TESTE (`teste: true`) num grupo do piloto devolveu
   **200**, intenção `A1`, resposta de 406 caracteres coerente com o caso, e
   `gravou: false` — nada entrou na fila, nenhum cliente viu nada.
2. **É o arquivo certo**: o fonte lido de volta do servidor bate com o arquivo do
   repo nos três pontos alterados (`avisoCorte`, o piso de metade do teto, o
   clamp `min(max(max_tts_chars || 3000, 100), 5000)`).
3. **O corte funciona**: a lógica que está no ar, rodada isolada com o teto real
   de 3.000 — Caso 341 (1.205 ch) passa **inteiro, sem aviso**, que era o defeito;
   4.007 ch corta em 2.969 no fim de uma frase, com aviso; e os dois patológicos
   (pontuação só no começo, e sem espaço nenhum) cortam secos em 3.000, sem
   partir palavra.

### A velocidade da fala é da voz, não do sistema

`speed: 1.1` estava escrito à mão dentro da função, igual para toda voz. É
errado na raiz, e a metáfora é a de um metrônomo único numa banda: cada voz
clonada carrega o ritmo da pessoa que a gravou. A Keilane a 1,1× soa apressada;
outra voz na mesma 1,1× pode soar natural; e uma terceira, gravada pausada, vai
soar arrastada a 0,90×. **Velocidade é propriedade da voz.**

Desde 07/09/2026 ela mora em `custom_voices.velocidade_fala`:

| valor | significa |
| --- | --- |
| `1.00` | ritmo natural da voz |
| abaixo de 1 | desacelera |
| acima de 1 | acelera |
| **nulo** | usa o padrão do sistema (1,1) — o comportamento antigo |

Nulo por padrão é deliberado: nenhuma voz muda de ritmo por causa desta
mudança. Só a Keilane, que é a voz do Dom, foi para **1,00×** — 10% mais devagar
que os áudios de antes.

A faixa aceita é **0,5 a 1,5**, no CHECK do banco e no código (os dois têm que
mudar juntos). A API REST da ElevenLabs aceita 0,25 a 4,0 — fonte: o
repositório de skills da própria ElevenLabs,
`text-to-speech/references/voice-settings.md`, que também registra que a
plataforma de Agents restringe a 0,7–1,2; nós usamos a REST. A faixa apertada é
de propósito: fora dela não é ajuste de naturalidade, é voz de desenho animado
ou de câmera lenta.

### Refazer o áudio pela tela

Ritmo de voz não se escolhe no papel, se escolhe ouvindo — e até aqui a única
forma de ouvir uma velocidade diferente era **esperar o próximo cliente mandar
um áudio**. Ajuste que depende de acaso não é ajuste.

A `dom-rascunho` ganhou a ação `regerar_audio`:

```
POST { regerar_audio: "<id do rascunho>", velocidade?: 0.5..1.5 }
→ { regerado, audio_url, audio_voz, audio_erro, velocidade, caracteres }
```

No painel, dentro do bloco "Como ficaria falado": os botões **0,85× a 1,10×**
refazem o áudio naquela velocidade e **guardam ela na voz** — é isso que faz
disso configuração e não um ajuste que se perde no áudio seguinte. Ao lado, um
botão que só refaz, útil quando alguém editou e salvou a resposta.

Três decisões que não são óbvias:

- **Fala o texto editado** (`resposta_final`) quando ele existe. Se alguém
  corrigiu a resposta, o áudio antigo já era mentira; refazer com o texto velho
  seria repetir a mentira com voz nova.
- **`dom_respostas_pendentes.audio_velocidade` guarda em que ritmo CADA áudio
  saiu.** Sem isso, mudar a velocidade da voz reescreveria o passado: os áudios
  antigos continuariam soando como soavam e a tela diria o número novo — o que
  inutiliza a comparação "antes e depois", que é justamente como se escolhe o
  ritmo. Nulo = gerado antes disto, na constante de 1,1.
- **A gravação passa pela edge function**, não pelo cliente: a RLS de
  `custom_voices` só deixa o dono da voz escrever (`user_id = auth.uid()`) e a
  sessão do painel no banco externo é anônima. Quem tem permissão é a função,
  com a chave de serviço.

Erro da ElevenLabs agora carrega o corpo da resposta e a velocidade usada.
Antes, um parâmetro recusado virava um `HTTP 422` mudo na tela.

**Verificado no ar em 07/09/2026 (dom-rascunho v14)**, contra dados reais:

| teste | resultado |
| --- | --- |
| regerar sem velocidade | 200 · voz Keilane · 1.205 ch · **velocidade 1,00 lida da voz** · sem aviso de corte |
| clicar 0,90× | 200 · `custom_voices` da Keilane virou `0.90` · a linha gravou `0.90` |
| o passado não muda | o áudio do Caso 341 continuou marcado `1.00` enquanto a voz estava em `0.90` |
| velocidade 9 | **400** · "velocidade precisa ser um número entre 0.5 e 1.5" |

**Ainda hardcoded em 1.1, de propósito, porque não foi pedido e mexer ali é
mexer em produção:** `whatsapp-ai-agent-reply` (~5,9 mil chamadas/dia),
`_shared/whatsapp-utils.ts`, `whatsapp-command-processor`, `elevenlabs-tts` e
`elevenlabs-voice-clone`. Enquanto isso, a velocidade da voz vale **só no
atendente virtual** — nos outros caminhos a mesma voz continua saindo a 1,1×.

### Data falada por extenso, e a data do próximo contato

Duas mudanças no que o cliente lê e ouve, em 07/09/2026.

**1. No áudio, data por extenso.** "28/08/2026" no papel é compacto e claro. Na
boca de uma voz vira *"vinte e oito barra zero oito barra dois mil e vinte e
seis"* — que ninguém fala e ninguém entende de primeira, ainda menos quem está
ansioso pelo processo. A conversão acontece **só na geração do áudio**, junto da
limpeza de asterisco e link, então a mensagem escrita continua com a data em
números e cada meio fica consistente consigo mesmo.

Testado em 8 casos, incluindo os que **não** podem ser tocados:

| entra | fala |
| --- | --- |
| `28/08/2026` | 28 de agosto de 2026 |
| `03/08/2026` | **3** de agosto de 2026 (sem o zero à esquerda, que é como se fala) |
| `31/08` | 31 de agosto |
| `1/2` (fração) | `1/2`, intacto |
| `10/13/2026` (mês 13) | intacto — melhor uma barra falada que uma data inventada |
| `0056732-43.2026.4.05.8300` | intacto |
| `07:30` | intacto |

**2. A data do próximo contato, e só quando ela vale.** O Dom terminava toda
resposta com "qualquer novidade a gente avisa", que é verdade e devolve ao
cliente a mesma incerteza com que ele chegou. Quando a equipe já programou a
volta, dizer a data transforma espera em previsão.

Mas o dado não sustenta dizer **sempre**. Medido em 07/09/2026, sobre a
atividade mais recente de cada ficha nos últimos 180 dias:

| | fichas | |
| --- | ---: | ---: |
| prazo no **futuro** (serve) | 869 | **10,6%** |
| prazo **já vencido** | 6.511 | **79,6%** |
| sem prazo | 799 | 9,8% |
| **total** | 8.179 | |

Dizer sempre significaria, em 8 de cada 10 conversas, prometer uma data que já
passou — pior que não prometer nada, porque o cliente confere. É o médico
dizendo "te vejo semana que vem" olhando a agenda do mês passado. Por isso a
RPC só entrega `prazo_contato` quando `deadline >= current_date`, e sem ele o
fecho volta ao genérico, com proibição explícita de inventar data.

**Detector, não filtro:** os 6.511 prazos vencidos continuam inteiros em
`lead_activities` e continuam sendo problema da esteira de atividades. O que
mudou é o atendente não repetir esse problema na boca dele.

**De quebra, um defeito real:** a subquery de `ultima_atividade` não filtrava
`deleted_at`. Atividade **apagada** podia ser a mais recente e virar o contexto
da resposta — o Dom falando com o cliente a partir de uma anotação que a equipe
removeu. Corrigido na mesma migration.

**Uma previsão minha que estava errada.** Decidi não instruir o formato da data,
com o raciocínio de que o áudio converteria tudo e instruir o modelo
desencontraria o texto. O teste mostrou o contrário: o modelo converte sozinho o
que **lê** ("28/08/2026" → "28 de agosto"), e copia ao pé da letra o que recebe
como **ordem direta**. Saiu "28 de agosto" no meio e "17/09/2026" no fim. A
fonte do desencontro era o formato que o código passava. Agora a data da ordem
já nasce por extenso.

**Verificado no ar** (`dom-contexto` v10, `dom-rascunho` v15), Caso 341:

> "...A última movimentação foi em **28 de agosto**... A próxima audiência está
> marcada para **22 de setembro**. Qualquer novidade a gente avisa aqui no grupo.
> **A gente volta a falar com o senhor até 17 de setembro.**"

Essa data de 17/09 já existia em `lead_activities` desde 02/09 e nunca chegava
ao modelo.

### O deploy das edge functions do Externo continua na mão

O workflow `.github/workflows/deploy-edge-externo.yml` foi criado em 07/09/2026
para subir as funções sozinho a cada merge em `main`. Ele **nunca funcionou**:
falta o secret `SUPABASE_PAT` no repositório, e as 4 execuções falharam com

```
##[error]Falta o secret SUPABASE_PAT no repositório.
```

Enquanto isso não for configurado, **toda função em `supabase/functions/_external/`
precisa ser deployada à mão** — merge em `main` publica o código no git e não
muda nada em produção, que é o pior tipo de divergência: o repo diz que está
consertado e o comportamento antigo continua no ar.

Para ligar: gerar um token em `supabase.com/dashboard/account/tokens` (tela da
**conta**, não do projeto) e cadastrá-lo em GitHub → Settings → Secrets and
variables → Actions → New repository secret, com o nome exato `SUPABASE_PAT`.

Cuidado que já quase aconteceu: **não** cadastrar esse token nos *Edge Function
Secrets* do Supabase. São coisas diferentes — lá é onde as funções leem
variáveis em runtime, e um token de administração da conta guardado ali ficaria
ao alcance de qualquer edge function do projeto.

### Falar como gente: sem termo técnico, com os dias parados

Confirmado funcionando em 07/09/2026, no Caso 341.

**O antes e o depois, mesma pergunta, mesmo grupo:**

| antes | agora |
| --- | --- |
| "está na fase de **ajuizamento**" | "a gente já entrou com o pedido na Justiça e ele está aguardando o juiz analisar" |
| "foi anexada uma petição **aos autos**" | "a gente anexou um documento" |
| "fase de **admissibilidade do Recurso de Revista**" | "o tribunal está decidindo se aceita analisar o nosso recurso" |
| "os **autos** foram para a mesa do juiz" | "o processo foi para a mesa do juiz" |
| "**audiência de instrução** marcada para 22/09/2026" | "a audiência, que é o dia em que o juiz ouve você, as testemunhas e o outro lado" |
| "a última movimentação foi em 28/08/2026" | "a última movimentação foi no dia 28 de agosto, **faz 10 dias**" |

#### A causa não era o modelo desobedecendo

O glossário **autorizava**, nesta frase:

> "Se precisar mesmo citar o nome técnico, escreva-o e explique em seguida,
> entre parênteses, no lugar de deixar solto."

Era uma porta aberta, e a mensagem saiu por ela: o modelo citou e explicou,
exatamente como mandado. Para quem tem estudo funciona; para quem não tem, a
explicação chega **depois** de a pessoa já ter travado na palavra.

A porta está fechada — o termo não entra nem explicado — com quatro pares
errado/certo tirados da própria mensagem. Entraram no glossário
`admissibilidade`, `recurso de revista`, `autos`, `audiência de instrução`,
`ata da audiência` e `agravo de instrumento`.

#### Os dias, e qual dos dois números

`parado_dias` (qualquer movimento) e `parado_dias_efetivo` (ignorando
`categoria = 'despacho'`). Despacho é ordem de andamento e sozinho não move o
caso: o processo andou no papel e continua onde estava. No Caso 341 a diferença
já aparece — **15 dias** contando tudo, **17** ignorando o despacho.

Fonte: `process_updates`, que recebe o e-mail do tribunal e por isso está mais
atual que o retrato do Escavador (pelo jsonb `movimentacoes` a maior parada do
piloto seria 173 dias; pela fonte certa, 83).

#### Acima de 90 dias: fala primeiro, mas não promete

O Dom diz quantos dias faz, diz que **está acionando a equipe**, e emite
`[REVISAR: processo parado há N dias — avaliar reclamação na ouvidoria]`.

**É proibido ele anunciar a ouvidoria ao cliente.** Reclamação é ato que alguém
precisa protocolar; atendente virtual anunciando ato jurídico cria dívida que
ele não pode pagar — se ninguém entrar, o cliente cobra a promessa depois e o
escritório fica pior do que se tivesse ficado calado.

**A regra nasce dormente:** medido em 07/09/2026, nenhum dos 30 processos do
piloto passa de 90 dias (a maior parada é 83). O que é frequente é outra coisa
— **16 dos 30 não têm uma movimentação registrada**, e nesses o Dom diz que vai
confirmar com a equipe em vez de deixar o vazio para o modelo preencher.

#### Pendência vira atividade com dono e prazo

Mostrar no painel não é encaminhar: quem não abrisse aquela tela não ficava
sabendo. Agora nasce linha em `lead_activities` — rodízio do Dom, prazo de 3
dias, tipo `acompanhamento`, `created_by_ai = true` para dar para filtrar.

Três travas, cada uma por um jeito de dar errado: só com pendência de verdade
(o `[REVISAR]` do modelo, não toda resposta); não repete a mesma em 7 dias
(senão o cron abriria uma a cada 5 minutos, para sempre); e falhar ali não
derruba o rascunho.

#### Dois erros meus, que só apareceram testando a resposta de verdade

1. **Português quebrado:** saiu *"está na fase de quando a gente entrou com o
   processo na Justiça"*. Culpa do glossário: as traduções são frases inteiras,
   e o modelo encaixou uma depois de "está na fase de". Agora essa construção é
   proibida.
2. **O número errado:** ele escreveu *"faz 46 dias"* para um caso parado há 10.
   Não inventou — havia **dois** números de dias no contexto (os da fase e os do
   parado) e ele pegou o que vinha primeiro e em destaque. O da fase agora vai
   rotulado `NÚMERO INTERNO, NÃO DIGA`.

A lição vale além destes dois: **quando o contexto oferece dois números
parecidos, o modelo escolhe pela posição, não pelo sentido.** Ou só um entra, ou
o outro precisa dizer, nele mesmo, que não é para sair.

#### Dívida conhecida: repo e produção podem divergir em comentários

Para caber no deploy manual, alguns comentários foram encurtados nos arquivos
enviados à `dom-contexto`. O comportamento é o que foi testado, mas trechos de
comentário podem diferir do arquivo do repositório. Reconciliar quando o
`SUPABASE_PAT` existir — a raiz é a mesma: **quatro transcrições manuais da
mesma função num único dia**, cada uma com risco de erro, que o deploy
automático elimina.

---

## O Dom não achava a ficha do cliente — e dizia "(0)" (07-08/09/2026)

### O que foi visto

No grupo "Caso 09 - SÓ RAIMUNDA" o painel de conferência mostrou
`Movimentação (0)`, `Documento lido (0)` e "Nenhuma atividade anterior".
Não era verdade. O processo `0000369-39.2018.8.10.0121` tinha, naquele
momento, 3 linhas em `process_updates`, 53 peças em `jm_documentos` (18 com
resumo lido), 4 decisões em `jm_decisoes`, e o lead tinha 36 atividades.

`dom_contexto_processual('120363405106042327@g.us')` devolvia
`tem_vinculo: false`. Não era o processo que estava parado — era o **cliente**
que não tinha sido encontrado.

### A causa: o vínculo grupo→ficha mora em dois lugares

| onde | quem usava |
| --- | --- |
| `lead_whatsapp_groups` (a ponte) | **só isto** a `dom_contexto_processual` olhava |
| `leads.whatsapp_group_id` (o cadastro) | é onde o Caso 09 tinha o grupo |

Não era caso isolado. Medido em 07/09/2026 sobre `dom_grupos_piloto` ativo:
1.149 grupos, 826 com ponte, 167 sem ponte mas com **uma única** ficha viva,
40 sem ponte e ambíguos, 116 sem ficha nenhuma. **323 grupos — 28% do piloto —
geravam rascunho sem um dado do processo, e o painel não avisava.**

### O que mudou

**1. A CTE `g` ganhou um segundo degrau** (migration
`20260907230000_o_dom_nao_achava_a_ficha_do_grupo.sql`):

1. `lead_whatsapp_groups` — a ponte explícita, continua mandando;
2. `leads.whatsapp_group_id` — **e só quando existe EXATAMENTE UMA ficha viva**
   apontando para aquele grupo.

O "exatamente uma" é a trava do vazamento, e não é teórica: **904 jids do
cadastro apontam para mais de uma ficha** (um chega a 18). Escolher "a mais
recente" ali seria contar a um cliente a movimentação de outro. Onde é ambíguo,
a resposta certa continua sendo não saber.

**2. O jsonb passou a devolver `vinculo`** — `fonte`
(`ponte` | `cadastro_do_lead` | `null`), `fichas_no_grupo`, `ambiguo`. Sem isso
o "(0)" respondia duas perguntas opostas com o mesmo número: "o processo não
andou" e "não sei de quem é este grupo".

**3. O painel (`FontesDaResposta.tsx`)** ganhou o aviso de ficha não encontrada,
que diz o conserto de cada caso. E um segundo bug foi corrigido junto: o painel
lia `d.titulo`, a RPC emite `d.peca` — **toda peça aparecia como "sem título"**
com o nome guardado ao lado.

### Efeito medido, 08/09/2026

| | antes | depois |
| --- | --- | --- |
| grupos do piloto com vínculo | 827 | **993** |
| pela ponte | 827 | 827 |
| pelo cadastro (novo) | — | 166 |
| ambíguo, agora avisa | 40 (calado) | 40 (avisando) |
| sem ficha, agora avisa | 116 (calado) | 116 (avisando) |

No Caso 09, depois de regenerar o rascunho: `vinculo.fonte: ponte`,
1 processo, 3 andamentos, 6 peças, 4 decisões, atividade "Manifestar sobre o
não pagamento da pensão".

Não-regressão: 15 grupos com ponte comparados contra
`dom_contexto_processual_antes_vinculo_por_cadastro` — zero diferença em
`lead_id`, `processos` e `ultima_atividade`.

### A armadilha do índice, que custou uma rodada

`dom_jid_curto(leads.whatsapp_group_id)` não tinha índice: 18,064 ms varrendo
19.865 das 23.984 linhas, duas vezes por chamada. Criamos
`idx_leads_jid_curto_do_grupo` com `CONCURRENTLY`, ele ficou **válido** — e o
planner **continuou varrendo**.

O índice é PARCIAL (`where whatsapp_group_id is not null and deleted_at is
null`) e a consulta não afirmava esse predicado; `dom_jid_curto(x) = 'algo'`
não prova `x is not null` para o planner. Com `and l.whatsapp_group_id is not
null` acrescentado às duas consultas: **0,145 ms, 3 buffers**. 124x.

⚠️ Essas duas linhas parecem redundantes. Quem as "limpar" devolve a varredura
sem perceber — o resultado continua certo, só fica 124x mais lento.

### O contexto é uma fotografia, não uma consulta ao vivo

`dom-rascunho` grava `contexto_usado` **no momento em que cria o rascunho**.
Consertar a RPC não reescreve rascunho já gravado: o painel continua mostrando
fielmente o que entrou naquele prompt — que era nada. Para ver o efeito é
preciso um rascunho **novo**, e o cron tem duas travas que impedem refazer o
mesmo: a linha em `dom_respostas_pendentes` ("já rascunhado") e a decisão final
em `dom_decisoes` ("já decidido antes").

No Caso 09 as duas foram apagadas à mão, com autorização, depois de conferir
que o rascunho estava `status: pendente` / `enviado_em: null` — nada havia sido
enviado à cliente. `decisao = 'respondeu'` é gravada **quando o rascunho nasce**
(dom-rascunho, linha 1050), não quando a mensagem sai; o nome engana.

### Dívidas conhecidas, deixadas de propósito

1. **`process_updates` é mais pobre que o retrato do Escavador.** O Dom lê
   `process_updates`; a tela "Movimentações" lê `lead_processes.movimentacoes`.
   Em 80 processos com jsonb não vazio: **1.384 movimentos no jsonb contra 708
   em process_updates**, e em **38 dos 80 o process_updates vê ZERO**. Atenção
   ao mexer: a escolha de `process_updates` para a **data** (`feed_em`,
   `parado_dias`) é deliberada — veja
   `20260907220000_quanto_tempo_o_processo_esta_parado.sql`. Fonte do feed e
   fonte da data são decisões separadas.
2. **Processo sem número some inteiro.** A RPC filtra `process_number is not
   null`. No Caso 09 o processo "Indenização" está com número nulo: a ficha
   mostra 2 processos e o contexto traz 1, sem o assessor saber que o outro
   existe. Sem número não há Escavador nem peça — mas o silêncio total também
   não é a resposta certa.

---

## 08/09/2026 — A peça citada no painel passa a abrir

### O que faltava

O painel "De onde saiu (para conferir)" lista, em **Documento lido**, as peças
que entraram no prompt com o resumo feito pela IA. Eram texto morto. Quem
revisava conferia a resposta da máquina contra **outro texto de máquina** — o
resumo — que é conferir uma coisa contra ela mesma. O documento, que é a prova,
ficava a dois cliques e uma tela de distância (aba Documentos do processo).

Agora o título da peça é botão: abre o PDF no `MediaLightbox`, com zoom, por
cima do painel. Fechar devolve o revisor exatamente onde ele estava — mesmo
visualizador e mesmo caminho da aba Documentos do processo, de propósito.

### A armadilha: título + data não identificam um documento

O contexto é um retrato gravado junto com o rascunho
(`dom_rascunhos.contexto_usado`) e guardava, por peça, só título, data e resumo.
Medido no Supabase externo em 08/09/2026, sobre os 9.151 documentos com leitura:

| medida | valor |
|---|---|
| chaves `(processo_cnj, titulo, data_documento)` distintas | 8.630 |
| chaves repetidas | 251 |
| documentos dentro de chave repetida | 772, em 48 processos |
| pior caso (mesmo título, mesma data) | **17 documentos** |

Casar por título+data abriria a peça errada em cerca de **6% dos cliques**, sem
avisar. Peça errada ao lado de um resumo é prova falsa — pior que botão nenhum,
porque tem cara de conferência.

### O conserto, na fonte

`dom_contexto_processual` passou a emitir, em cada item de
`processos[].documentos[]`, o `id` e o `arquivo` (`jm_documentos.storage_path`)
— migration `20260908150000_a_peca_do_dom_pode_ser_aberta.sql`. Com isso o
clique abre **a** peça, não uma parecida.

Duas coisas que a mudança **não** faz:

- **não mexe no prompt.** Quem monta o system prompt é a `dom-contexto`, e de
  cada documento ela lê apenas `data`, `peca` e `resumo`. Chave nova em JSON que
  ninguém lê não vira token.
- **não expõe arquivo.** `arquivo` é o caminho dentro do bucket privado
  `jm-autos`. Abrir exige sessão autenticada e a policy do bucket, que assina
  uma URL de 10 minutos. O caminho sozinho não dá acesso a nada.

Rota de fuga: `dom_contexto_processual_antes_peca_clicavel` guarda a versão
anterior, criada pela própria migration antes de alterar. Remover só após 24h
verdes.

### Rascunho antigo: procura, e não chuta

Rascunho gravado antes disso não tem `id` nem `arquivo` — o retrato já foi
tirado. Nesses, o front procura a peça em `jm_documentos` por processo, título e
data (`acharPecaDoContexto`, em `src/lib/pecaDoContexto.ts`) e:

- **um** candidato com arquivo → abre;
- **dois ou mais** → não abre, e diz quantas peças têm aquele mesmo título e
  aquela mesma data, mandando para a aba Documentos do processo;
- **nenhum**, ou peça sem arquivo baixado → diz qual dos dois é.

Nunca some com o botão e nunca abre "a mais parecida". Nove testes em
`src/lib/__tests__/pecaDoContexto.test.ts` seguram isso — em especial o caso de
duas peças homônimas na mesma data, que é o que quebra se alguém "simplificar"
o desempate para pegar o primeiro candidato.

### Onde ficou

| arquivo | papel |
|---|---|
| `src/lib/pecaDoContexto.ts` | decide qual peça é, ou por que não dá para saber |
| `src/hooks/useAbrirPecaDosAutos.ts` | consulta sob demanda + URL assinada (10 min) |
| `FontesDaResposta.tsx` | título vira botão; erro aparece embaixo da própria peça |
| `20260908150000_a_peca_do_dom_pode_ser_aberta.sql` | a RPC passa a dizer qual peça é |

A busca é **sob demanda, uma peça por clique**. Carregar o acervo inteiro de
cada processo listado (140 peças no caso 88) para talvez abrir uma seria pagar
adiantado por algo que quase sempre não acontece.

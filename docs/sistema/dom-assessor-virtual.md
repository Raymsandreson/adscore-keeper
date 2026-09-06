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

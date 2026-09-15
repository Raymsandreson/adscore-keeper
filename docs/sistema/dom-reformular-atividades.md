# Dom — por que ele cria atividade demais, e o que muda antes de religar

Levantamento de 10/09/2026 sobre **tudo** o que o atendente virtual gerou entre
07/09 e 10/09, antes da suspensão. Base: 512 rascunhos em
`dom_respostas_pendentes` e as 133 atividades com `action_source = 'dom-rascunho'`
(exportadas em `scratchpad/suspensao-dom-20260910/atividades-detalhe.json`).

Contexto da suspensão: `dom-assessor-virtual.md`, seção "SUSPENSO em 10/09/2026".

## 1. Como a atividade nasce hoje

Duas decisões independentes, tomadas pelo mesmo modelo em momentos diferentes:

1. **Classificar a intenção** (`INTENCOES`, 23 rótulos em 5 grupos): A responde,
   B acolhe, C confirma curto, D silêncio, **E é de gente**. Lê a última fala do
   cliente com o histórico do grupo.
2. **Redigir a resposta.** Enquanto escreve, o modelo marca o próprio texto com
   `[REVISAR: motivo]` quando toca em assunto sensível — valor, prazo, mérito,
   recurso, acordo, cliente reclamando.

O gatilho da atividade é `if (motivo)`: o `[REVISAR]` extraído por regex do texto
da resposta, ou o mapa fixo das intenções do grupo E. **É o passo 2 que abre a
atividade, e ele é texto livre escrito no meio de outra tarefa.**

## 2. A máquina contradiz a si mesma em 4 de cada 5 casos

| de onde veio o disparo | disparos | com a resposta já escrita |
|---|---|---|
| o Dom classificou como **"eu respondo"** (A, B, C, D) | **217 (81%)** | 213 |
| o Dom classificou como **"é de gente"** (E) | 52 (19%) | 52 |

269 disparos de `[REVISAR]` em 512 rascunhos — **52,5%**. Metade de tudo o que
ele escreve vira tarefa para alguém.

Em 213 casos ele **escreveu a resposta inteira ao cliente** e, no mesmo passo,
abriu tarefa dizendo que uma pessoa precisa cuidar daquilo. Se a resposta serve,
a tarefa é ruído; se não serve, a resposta não deveria ter sido escrita. As duas
coisas não podem ser verdade ao mesmo tempo, e hoje são, em 4 de cada 5 casos.

Só o grupo E acerta por construção — ali abrir atividade *é* a decisão certa.

## 3. Os tipos, medidos

72 motivos distintos para 133 atividades. Agrupados
(`scratchpad/suspensao-dom-20260910/classificar.mjs`):

| família | n | % | o que é |
|---|---|---|---|
| Prazo | 33 | 25% | "prazo", "prazo de decisão", "aguardar decisão" |
| Mérito da decisão | 29 | 22% | "interpretar o mérito", "recurso" |
| Dinheiro | 16 | 12% | valor, honorários, acordo, porcentagem |
| **Dado nosso faltando** | 14 | 11% | grupo sem processo vinculado, processo sem movimentação, valor sem lastro |
| Cliente em crise | 13 | 10% | desistir, frustrado, reclamando, luto |
| Perícia e agenda | 13 | 10% | agendamento, reagendamento, documentos para perícia |
| Documento | 8 | 6% | cliente enviou/entregou, pedido de documento |
| Só "precisa de gente" | 6 | 5% | `intenção E17: precisa de atendente humano` |

**Prazo + Mérito = 47%** — e nenhum dos dois é um pedido do cliente. São os dois
atributos que **todo processo tem**. O motivo descreve o assunto do caso, não o
que alguém precisa fazer.

## 4. Ele lê o contexto, e é por isso que erra

A pergunta era se o Dom lê por contexto ou por mensagem única. **Lê os dois, e o
erro nasce da mistura**: a intenção é classificada sobre a fala do cliente, mas o
`[REVISAR]` é emitido enquanto o modelo redige **com o processo inteiro na
frente**. O motivo sai do processo, não da fala.

**28 das 133 (21%)** nasceram de uma fala de até 25 caracteres, e 8 de mídia sem
texto nenhum:

| o cliente escreveu | virou atividade de |
|---|---|
| `No aguardo` | interpretar o MÉRITO de uma decisão |
| `Não` | mérito, prazo |
| `1` | novo acidente |
| `⁉️⁉️` | interpretação de mérito, prazo |
| `Estávamos sem luz` | prazo |
| `Com o bolsa família` | valor |
| `Olha ai` | prazo |

Nenhuma dessas frases contém pedido. O que o modelo classificou foi o caso, não
a mensagem.

## 5. O resto do estrago

- **0 de 133 concluídas.** Nenhuma. A esteira só encheu.
- **26 leads com 2+ atividades** (60 das 133), até 5 no mesmo lead — mesmo com o
  dedup de 24h, que já reduziu bastante (a trava anterior era o título exato).
- **99 leads** atingidos em 3 dias.
- Dono por rodízio de 2 pessoas, e **ninguém cadastrado no escopo `reclamacao`**:
  tudo caiu no fallback `geral`. Ver a seção sobre atribuição em
  `dom-assessor-virtual.md`.

## 6. O que muda antes de religar

### 6.1 Separar quem detecta de quem redige
A decisão de abrir atividade não pode ser um marcador no meio do texto da
resposta. Tem que ser **saída estruturada, própria**, sobre a fala do cliente —
`{ abrir: bool, tipo: enum, o_que_fazer: string }` — avaliada depois de a
resposta existir, com a pergunta: *o que ficou sem ser atendido?*

### 6.2 Inverter o gatilho
Hoje: **respondeu E o assunto é sensível** → abre.
Deveria ser: **não deu para atender com o que tínhamos** → abre.

Assunto sensível não é pendência. Se o Dom sabe o prazo, ele responde e pronto;
se não sabe, o que falta é **dado** — e aí a atividade é sobre conseguir o dado,
com o processo apontado, não sobre "prazo".

### 6.3 Tipo fechado, texto livre só no detalhe
72 motivos distintos é o sintoma. Enum curto, derivado do que os dados mostraram
ser real:

| tipo | vem de | hoje |
|---|---|---|
| `pedido_de_gente` | grupo E: reclamação, desistir, adiantamento, indicação, quer pessoa específica | 19% dos disparos — o único que já acerta |
| `dado_faltando` | grupo sem processo, sem movimentação, valor sem lastro | 11% — o mais valioso: aponta conserto estrutural, não conversa |
| `compromisso_do_cliente` | agendamento, perícia, documento a entregar | vira pendência na barra "Cliente ficou de", não tarefa |
| `documento_recebido` | cliente mandou algo que precisa de baixa | 6% |

**Prazo, mérito, valor e acordo deixam de ser tipo.** São assunto de resposta, e
resposta o Dom já dá.

### 6.4 Piso de fala
Sem pedido identificável na fala do cliente, não abre: D12–D15, mídia sem
legenda, e fala de uma palavra. Corta 21% na entrada.

### 6.5 Atividade que ninguém tocou e cuja conversa andou, fecha sozinha
Se a equipe respondeu no grupo depois da atividade nascer, o assunto foi
resolvido por quem estava lá. Hoje nada fecha — por isso 0 de 133.

### 6.6 Dono é quem acompanha o grupo
Não rodízio. Enquanto o responsável real não sair do nome do grupo / tabelas de
acolhedor, a atividade nasce na pessoa errada — ou sem dono, como a única que
foi para o financeiro.

### 6.7 Religar pequeno, com meta declarada
8 grupos, não 1.149. E uma meta que reprova o detector: **se menos de X% das
atividades forem concluídas, o gatilho está errado** — não é a equipe que está
devendo. Hoje o baseline é 0%.

## 7. O que ainda não sei

Ninguém concluiu nenhuma das 133, então **não existe rótulo humano** dizendo
quais serviam. Antes de escrever o detector novo, vale pegar uma amostra de ~30
(estão soft-deletadas, o texto está todo lá) e pedir para quem recebeu marcar
"servia / não servia". Isso dá o alvo real, em vez de eu supor pelos motivos.

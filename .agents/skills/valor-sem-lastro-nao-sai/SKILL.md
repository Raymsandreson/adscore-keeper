---
name: valor-sem-lastro-nao-sai
description: Use SEMPRE que um agente de IA for escrever uma resposta que vai chegar num cliente — Dom, atendente virtual, rascunho de WhatsApp, e-mail automático, resumo de caso — e a resposta puder conter valor em dinheiro, porcentagem, prazo, desconto, tributo ou conteúdo de documento. Regra dura do incidente de 08/09/2026 (grupo da Bianca): o modelo NÃO pode escrever fato que não esteja no contexto que ele recebeu, e número dito pelo cliente NÃO é fato nosso. Acione também ao propor "reforçar o prompt" para impedir invenção, ao ver resposta citando Imposto de Renda, bruto/líquido, porcentagem de honorário ou conteúdo de contrato/procuração, e ao investigar "de onde o agente tirou isso".
---

# Prompt é pedido. Trava é impedimento.

Quando a resposta de um agente vai chegar num cliente, a pergunta não é "o
prompt proíbe?" — é "o código impede?". Prompt é a instrução que o modelo pode
ignorar, e ignora. Trava é o código que descarta o texto antes de ele virar
rascunho.

## O incidente que originou a regra (08/09/2026)

Grupo `✅PREV 1028| BIANCA/ANUNCIO (AUX. MATERNIDADE)`. A cliente escreveu que a
carta de concessão dela dizia R$ 1.621,00 e perguntou a porcentagem do
escritório. O Dom respondeu:

> "O valor de R$ 1.621,00 é o valor bruto do seu benefício (...). O INSS faz
> alguns descontos, como o **Imposto de Renda** (...). Sobre a porcentagem do
> escritório, a gente cobra **30%** do valor que você recebe, **conforme o
> contrato que a gente assinou**."

Rastreadas as CINCO fontes possíveis daquele prompt, nenhuma continha isso:

| Fonte | Resultado |
|---|---|
| `prompt_instructions` do agente (banco, 4.867 chars) | zero "imposto" |
| `dom-contexto` deployado | zero "imposto" |
| `contexto_usado` gravado na linha | `processos: []`, `requerimentos_inss: []` |
| 513 mensagens do grupo | zero "imposto" |
| Exemplos do grupo (`dom_qa_pares`) | zero pares |

O IR veio do **treinamento do modelo**. O 30% veio de uma **pergunta da própria
cliente** em 26/08 ("Todo mês e trinta por cento??"), que ninguém tinha
respondido — o modelo devolveu a dúvida dela como confirmação nossa.

## As duas leis

**1. Fato tem que estar no contexto.** O que não está no bloco de andamento, na
peça lida ou na anotação da equipe, NÃO EXISTE para o agente. Onde falta fato,
o modelo não fica em silêncio: ele completa com o que *costuma* ser verdade no
assunto. É o estagiário com memória enciclopédica e zero acesso à pasta do
caso — ele não mente de propósito, ele preenche a lacuna com o clichê
estatístico.

**2. Número dito pelo cliente não é fato nosso.** Ele mandou o número porque
está em dúvida. Repetir afirmando é a nossa confirmação de algo que ninguém
conferiu. Trate como PERGUNTA: "sobre esse valor que a senhora viu na carta, a
equipe vai conferir e te explicar".

## Por que prompt não basta — medido, não suposto

A instrução JÁ existia. `instrucaoDaIntencao()`, ramo `g === "E"`:

> "Escreva uma resposta curta e acolhedora dizendo que já está acionando a
> equipe — **sem prometer prazo, sem número, sem valor**."

Esse bloco é o ÚLTIMO do system prompt, a posição que o próprio código chama de
"mais forte". O modelo passou por cima em **3 dos 4 rascunhos** daquela tarde. E
o `prompt_instructions` do banco já dizia "Não comenta nada sobre honorários".
Duas instruções, as duas ignoradas.

Some-se a isso: `temperature` efetiva estava em **0,007** (o código faz
`(temperature ?? 70) / 100` e o banco guardava `0.7`). Quase determinístico —
ou seja, a invenção não é sorteio, é o caminho preferido do modelo. **Vai
repetir.**

Conclusão permanente: **contra invenção de fato sensível, escreva a trava em
código.** Reforçar o texto do prompt é escrever a mesma regra em letra maior.

## A trava que existe hoje

`supabase/functions/_external/dom-rascunho/index.ts` → `valoresSemLastro()`,
aplicada depois de gerar a resposta e ANTES de gravar o rascunho:

- **família E** (dinheiro, prazo, reclamação): NENHUM valor sai, nem um que
  esteja no contexto. Quem responde valor é gente, e essa conversa já vai para
  um atendente de qualquer jeito.
- **demais intenções**: passa só o valor cuja parte inteira aparece no bloco de
  contexto ("R$ 1.621,00" casa com "1621"). Porcentagem por extenso ("trinta por
  cento") nunca casa — de propósito.
- ao barrar: o texto do modelo é **descartado inteiro** (não é tirar o número da
  frase: "o valor de X é o valor bruto" sem o X continua sendo a mesma
  invenção), entra a resposta neutra `RESPOSTA_SEM_VALOR`, e o
  `motivo_revisao` diz o que caiu.

## Isto não contradiz `conserto-estrutural-nao-pontual` — é o espelho dela

Aquela regra: valor que ESTÁ no banco não pode ser escondido da tela.
Esta regra: valor que NÃO está no banco não pode SAIR para o cliente.

As duas dizem a mesma coisa por lados opostos: **a verdade é a peça e o banco**.
Nenhuma tela inventa para menos, nenhum agente inventa para mais.

E a saída, aqui como lá, não é badge nem aviso: é a esteira. Rascunho barrado
vira pendência com dono e prazo, alguém abre a peça e responde com o número
certo. Se a peça não existe, a solução é conseguir a peça — nunca adivinhar.

## Cheiro de erro (se você escrever isso, pare)

- "vou reforçar no prompt que ele não pode inventar valor" → o prompt já
  proíbe. Escreva a trava.
- "é só tirar o número da frase" → a afirmação sobrevive sem o número.
- "o cliente mesmo falou esse valor, então dá para usar" → não dá. Ele
  perguntou.
- "geralmente o INSS desconta..." → "geralmente" não é o caso dele.
- "está no contrato dele que..." → você leu o contrato? A resposta é não.

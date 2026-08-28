---
name: conserto-estrutural-nao-pontual
description: Use SEMPRE que aparecer um número errado, inconsistente, absurdo ou "impossível" em qualquer tela, relatório, card, total, carteira, dashboard ou export — e também sempre que você estiver prestes a filtrar, excluir, zerar, capar, ignorar, "sanitizar" ou marcar com badge/aviso um valor vindo do banco. Regra dura do Raym (27/08/2026) - a resposta NUNCA é esconder o valor na tela: o valor continua somando como está no banco, e você entrega o caminho estrutural que corrige o dado na origem. Acione ao ver ou escrever "valor suspeito", "ignorar outlier", "não contabilizar", "filtrar inconsistente", "flag", "badge de alerta", "por enquanto deixa de fora", ou ao propor qualquer heurística que decida sozinha que um dado do banco está errado.
---

# Tela não conserta dado. Tela mostra o dado e aponta o caminho do conserto.

Regra permanente do Raym (27/08/2026), válida em QUALQUER tela, relatório ou
cálculo deste sistema, em qualquer conversa, mesmo em assunto diferente do que
originou a regra.

Palavras dele:

> "pare de ficar deduzindo, tem que só somar os valores que estão no banco de
> dados da última decisão com a atualização. O que tem que ser feito não é
> omitir valores e sim indicar onde pode estar errado para colocar a peça certa
> que vai pegar os valores corretos para colocar no banco de dados. Você fica
> colocando bandeide, só pra destacar o erro em vez de dar a solução definitiva.
> Me diga sempre a solução para resolver o problema estrutural e não pontual."

## A regra dura

Quando um valor parece errado, PROIBIDO:

- Filtrar a linha para fora do total ("esse HS é impossível, não soma").
- Zerar, capar, arredondar ou substituir por um valor "mais plausível".
- Deduzir o valor certo por regra de negócio quando a peça existe e pode ser lida.
- Encerrar a entrega em badge/alerta/tooltip como se avisar fosse resolver.

Filtrar na tela troca um número errado por outro número errado — agora para
menos — e ainda **esconde da vista o processo que precisa de conserto**. O total
deixa de bater com o banco, ninguém sabe mais qual é a verdade, e o dado ruim
continua lá.

O certo, sempre nesta ordem:

1. **Somar o que está no banco.** Sem exceção. O total da tela é igual ao
   `SELECT sum(...)` equivalente. Se o número está feio, o número está feio.
2. **Detectar, não descontar.** A heurística que reconhece o valor improvável
   existe, mas ela só **classifica** a linha — nunca a remove do total.
3. **Rotear para a esteira de conserto que já existe**, com o motivo escrito em
   português e o valor em jogo. O processo tem que aparecer numa fila em que
   alguém consegue agir.
4. **Corrigir na origem**, escrevendo no banco a partir da peça verdadeira.

Só depois que o dado da origem muda o total muda — e aí ele muda sozinho, em
todas as telas, porque nenhuma delas estava mentindo.

## A esteira de conserto deste projeto

Já está construída. Não invente outra:

| Etapa | Onde |
| --- | --- |
| Fila de conferência | `vw_jm_conciliacao_acordos` → `useConferenciaAcordos` → `ConferenciaSubsecao` (subseção dentro da carteira do POP, desde 28/08; o atalho "Conferência" do card abre a carteira com ela expandida) |
| Abrir o processo | `ProcessoConferenciaSheet` (trilha de marcos, cronológica) |
| Anexar / substituir a peça | `BotaoAnexar` / `BotaoDesvincular` → `usePecasDoProcesso.anexar` / `.ocultar` |
| Ler a peça | `rpc('jm_ler_documento')` → `jm_documento_leitura` |
| Ver o que muda antes | `MudancasDaPecaDialog` (valor antigo riscado × valor novo) |
| Gravar no banco | `usePecasDoProcesso.corrigirValores` → `jm_partes` / `jm_lancamentos` |

Nada se apaga: peça errada se **desvincula** (`oculta_em`, `oculta_motivo`),
nunca se deleta. As policies de DELETE foram removidas de propósito.

## Como responder quando achar um valor errado

Entregue as quatro coisas, nesta ordem, na mesma resposta:

1. **O número como está no banco** — com a query que provou.
2. **Por que ele é improvável** — a regra concreta violada (ex.: `hs > cota_parte`
   é impossível porque o sucumbencial sai de dentro da cota).
3. **Qual peça resolve** — o documento específico que traz os valores certos
   (termo de acordo, sentença de liquidação, planilha homologada, acórdão).
4. **O caminho já clicável** — em que fila o processo aparece e qual botão o
   usuário aperta para anexar a peça e gravar a correção.

Se a peça não existe no sistema, aí a solução estrutural é **conseguir a peça**
(fila do Escavador em modo AUTOS, ou pedir ao responsável pelo processo) — não é
adivinhar o valor.

## Cheiro de band-aid (se você escrever isso, pare)

```ts
// ERRADO — a tela decidiu que o banco está errado e sumiu com o dinheiro
if (hsEhSuspeito({ hs, cota })) continue;
const nosso = hc + hs;
```

```ts
// CERTO — contado, nunca descontado: soma no total E entra na fila de conferência
if (hsEhSuspeito({ hs, cota })) { hsSuspeitoValor += hs; hsSuspeitoPartes += 1; }
const nosso = hc + hs;
```

Mesmo cheiro em SQL (`where valor < 1000000`), em export (`.filter(plausivel)`),
em gráfico (`domain: [0, p95]`) e em texto de resposta ("desconsiderando os
outliers, o total é..."). Todos são a mesma falha.

## Vale além de dinheiro

A regra é sobre dado, não sobre valor monetário. Data absurda, contagem
impossível, duplicata, prazo negativo, cliente sem CPF: mostra como está, detecta,
roteia para quem corrige na origem. Nunca maquia na renderização.

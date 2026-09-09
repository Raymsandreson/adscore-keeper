---
name: valor-sem-lastro-nao-sai
description: Use SEMPRE que um agente de IA for escrever resposta que chega no cliente — Dom, atendente virtual, rascunho de WhatsApp, e-mail automático — e a resposta puder conter valor, porcentagem, prazo, desconto, tributo ou conteúdo de documento. Regra do incidente de 08/09/2026 (Imposto de Renda inventado no grupo da Bianca): o agente não escreve fato que não está no contexto que recebeu, e número dito pelo cliente não é fato nosso. Acione também ao propor "reforçar o prompt" para impedir invenção.
---

# O agente não inventa fato

**Isto não é "não fale de valores".** Valor que está na peça lida ou na nossa
base é fato, e o agente pode e deve dizer, com a fonte junto ("na carta de
concessão está R$ ..."). Esconder fato de quem está esperando dinheiro é o
outro jeito de errar.

O que não pode é inventar nem DEDUZIR. No caso que originou a regra, o
benefício era R$ 1.660 e a resposta afirmou que o cliente receberia 880 e pouco
"por causa do desconto de Imposto de Renda" — num benefício isento. O 1.660
estava na peça e podia ser dito; o 880 saiu de uma conta que ninguém fez.

Duas leis, as duas absolutas:

1. **Fato tem que estar no contexto.** O que não está no bloco de andamento, na
   peça lida ou na anotação da equipe não existe para o agente. Onde falta fato
   o modelo não fica calado — ele completa com o que *costuma* ser verdade no
   assunto, e isso chega no cliente como se fosse o caso dele.

2. **Número dito pelo cliente não é fato nosso.** Ele mandou o número porque
   está em dúvida. Repetir afirmando vira confirmação nossa de algo que ninguém
   conferiu. Trate como pergunta: "sobre esse valor que a senhora viu na carta,
   a equipe vai conferir e te explicar".

## Prompt é pedido. Trava é impedimento.

No incidente, a instrução JÁ proibia — "sem número, sem valor", no bloco mais
forte do system prompt — e o modelo passou por cima em 3 dos 4 rascunhos. Contra
invenção de fato sensível, escreva a trava em código; reforçar o texto do prompt
é escrever a mesma regra em letra maior.

A trava que existe: `dom-rascunho` → `valoresSemLastro()`, aplicada antes de
gravar o rascunho. Ela compara cada valor da resposta com o bloco de contexto:
o que está lá passa, o que não está derruba o rascunho. O texto é descartado
inteiro, e não só o número — "com o desconto o senhor recebe ___" sem o número
continua sendo a mesma invenção. O caso vira pendência com dono, e quem
responde o que faltou é gente, com a peça na mão.

## Lastro é a peça, e o nosso bilhete não é peça

Duas armadilhas medidas em produção (09/09/2026), as duas na própria trava:

- **Comparar número solto pega qualquer coisa.** "30%" casava com o "30" de
  "normalmente 30 dias" que está no bloco do INSS. Dinheiro só confere com
  dinheiro, porcentagem só com porcentagem.
- **O aviso que você escreve volta como fato.** O motivo da trava virou
  atividade ("Pendência: valor sem lastro (R$ 864,53)"), a atividade entrou no
  prompt, e dois minutos depois o valor barrado tinha "lastro" — o nosso
  próprio bilhete. O modelo até copiou a frase de volta. Lastro é só o bloco de
  andamento processual: anotação interna, exemplo antigo e recado nosso nunca
  são fonte.

Detalhe do incidente e da verificação: `docs/sistema/dom-assessor-virtual.md`,
seção "Valor inventado não vira rascunho (08/09/2026)".

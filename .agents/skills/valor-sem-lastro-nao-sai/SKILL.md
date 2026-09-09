---
name: valor-sem-lastro-nao-sai
description: Use SEMPRE que um agente de IA for escrever resposta que chega no cliente — Dom, atendente virtual, rascunho de WhatsApp, e-mail automático — e a resposta puder conter valor, porcentagem, prazo, desconto, tributo ou conteúdo de documento. Regra do incidente de 08/09/2026 (Imposto de Renda inventado no grupo da Bianca): o agente não escreve fato que não está no contexto que recebeu, e número dito pelo cliente não é fato nosso. Acione também ao propor "reforçar o prompt" para impedir invenção.
---

# O agente não inventa fato

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
gravar o rascunho. O texto barrado é descartado inteiro (tirar só o número
deixa de pé a mesma invenção), e o caso vira pendência com dono — quem responde
valor é gente, com a peça na mão.

Detalhe do incidente e da verificação: `docs/sistema/dom-assessor-virtual.md`,
seção "Valor inventado não vira rascunho (08/09/2026)".

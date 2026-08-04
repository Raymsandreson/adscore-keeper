---
name: ui-sem-sobreposicao
description: Use SEMPRE que criar ou alterar QUALQUER UI — cabeçalho, título, card, formulário, badge flutuante, cronômetro, tooltip, popover, dropdown, modal, barra fixa/sticky, overlay, FAB. Regra dura deste produto: nada pode ficar sobreposto a nada. Título de lead/caso/processo e qualquer informação precisam ficar 100% visíveis; nunca truncar sem tooltip, nunca cobrir com elemento flutuante/absolute/fixed. Acione ao ouvir "está sobrepondo", "cobrindo", "cortando o texto", "não dá pra ler", "flutuante em cima", "por cima do título", "z-index", ou ao posicionar qualquer elemento sobre outro.
---

# UI sem sobreposição — nada cobre nada

Metáfora: informação é vitrine. Nada pode ficar na frente do que precisa ser lido.

## Regra dura

PROIBIDO entregar UI onde um elemento fica por cima de conteúdo/informação. Em especial:

- Título de **lead, caso, processo ou atividade** SEMPRE 100% legível.
- Nenhum **badge / flutuante / overlay / tooltip / sticky / dropdown** cobrindo campos, labels ou textos.

Se um elemento precisa aparecer "na frente", o layout está errado — conserte o layout, não empilhe `z-index`.

## Checklist antes de entregar qualquer UI

1. **Título/assunto:** usa `truncate`/`line-clamp` sem `title=` no hover? Isso esconde informação. Ou dá espaço (`flex-1 min-w-0` + quebra de linha) ou põe `title={texto}` com o conteúdo inteiro.
2. **Elemento `position: absolute`/`fixed`** (badge, cronômetro, FAB, chip): ele cobre conteúdo em ALGUMA largura/altura de tela? Teste mobile + desktop (resize). Se cobre → reflui, recolhe, cola na borda ou reserva espaço (margem/gutter). Nunca deixa por cima.
3. **Overlay arrastável:** precisa poder sair da frente (minimizar / colar na borda) e NUNCA nascer sobre o conteúdo principal. Posição salva no localStorage deve ser corrigida para a borda ao montar.
4. **`z-index` alto não é solução** para "aparecer na frente" — costuma ser a causa do problema de sobreposição. Reveja o layout.
5. **Header com título + botões na mesma linha:** botões têm `shrink-0` e o título `flex-1 min-w-0`? Senão os botões espremem/cobrem o título. Quando o painel pode estreitar (ex.: chat interno abrindo ao lado), o header inteiro vai de `flex` para `flex flex-wrap items-start` e a barra de botões usa `ml-auto` — assim ela **cai para a linha de baixo** em vez de espremer o nome.
6. **`truncate` só vale em elemento de bloco/flex.** Em wrapper `inline-flex` (é o caso do `CopyableText`, `src/components/ui/copyable-text.tsx`) a classe não corta nada: o elemento tem largura shrink-to-fit e o texto vaza por cima do vizinho. Usar a **prop** `truncate` do componente + `max-w-full`, com o pai em `min-w-0`.
7. **Dropdown/Popover:** usa `collisionPadding` e `side` para não estourar por cima do gatilho nem sair da tela?
8. **Campo de digitar mensagem:** cresce com o texto? Chat com `<Input>` de uma linha esconde o que a pessoa está escrevendo — usar `AutoResizeTextarea` (`src/components/ui/auto-resize-textarea.tsx`) e `items-end` no rodapé.

## Padrões corretos (deste repo)

- **Título de ficha:** `line-clamp-2 flex-1 min-w-0 font-semibold` + `title={texto}` — ver o header em `src/components/activities/ActivityFullSheet.tsx`.
- **Badge do cronômetro** (`src/components/activities/ActivityTimerOverlay.tsx`): flutuante `fixed`, arrastável. Deve **colar na borda** ao soltar e ao montar — nunca descansar no meio do conteúdo. Minimiza para o pill compacto (`hideTimer`) para reduzir a área ocupada.
- **Borda = borda do CONTEÚDO, não da janela.** O menu lateral é `fixed z-10`; qualquer flutuante com z maior colado em `left: 0` fica **por cima dos itens do menu**. Use `contentLeftEdge()` (mede `[data-sidebar="sidebar"]:not([data-mobile])` no DOM) como limite esquerdo de clamp/snap e como `collisionPadding.left` dos popovers ancorados no flutuante. O menu troca de largura (16rem ↔ 3rem no modo ícone) — reagir com `ResizeObserver`, senão o badge volta a ficar por cima quando ele reexpande.

## Como verificar

- Abrir a tela em desktop e mobile (resize) e confirmar que nenhum texto some sob outro elemento.
- Se for flutuante, arrastar/rolar e conferir que o conteúdo por baixo continua acessível e legível.

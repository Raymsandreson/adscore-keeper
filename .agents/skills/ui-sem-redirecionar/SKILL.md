---
name: ui-sem-redirecionar
description: Use SEMPRE que um clique for abrir/mostrar alguma coisa — atividade, lead, caso, processo, POP, documento, imagem, PDF, feedback, avaliação, conversa, relatório, item de lista, resultado de busca, notificação, link em card. Regra dura deste produto: NUNCA redirecionar nem abrir aba nova. Abre em aba lateral (Sheet) ou painel de baixo pra cima (Drawer), por cima do que já está aberto, sem tirar a pessoa da tela. Acione ao ver ou escrever window.open, navigate(), <a href target="_blank">, location.href, "abrir em nova aba", "ver detalhes", "abrir a ficha", "deep-link", ou ao criar qualquer atalho clicável.
---

# Nunca redireciona — ou é aba lateral, ou é painel de baixo pra cima

Regra permanente do Raym (06/08/2026), válida em QUALQUER tela do sistema, em
qualquer conversa, mesmo em assunto diferente do que originou a regra.

## Regra dura

PROIBIDO tirar a pessoa de onde ela está para mostrar alguma coisa. Isso inclui:

- `window.open(...)` / `target="_blank"` — **proibido**, mesmo "só pra ver rápido".
- `navigate('/rota')` / `location.href = ...` num clique de "ver/abrir/detalhar" — **proibido**.
- Deep-link tipo `?openProcess=<id>` que troca de página — **proibido** como resposta a clique dentro de outra tela.

O certo, nesta ordem:

1. **Aba lateral (Sheet)** — padrão do sistema. `side="right"`; se já existe um
   painel à direita, o novo entra com `side="left"` pra ficar **ao lado**, nunca
   por cima da informação (ver skill `ui-sem-sobreposicao`).
2. **Painel de baixo pra cima (Drawer)** — quando a tela é estreita/mobile ou o
   conteúdo é largo (tabela, planilha, mídia).

Empilhar painéis é permitido e esperado: telão → detalhe do critério → ficha da
atividade. A pessoa fecha e volta exatamente de onde saiu.

## Componentes deste repo (use, não recrie)

| O que abrir | Componente | Observação |
|---|---|---|
| Atividade | `src/components/activities/ActivityFullSheet.tsx` | Formulário único do sistema. Props: `open`, `onOpenChange`, `activityId`, `side`. |
| Processo (leve, dentro do telão) | `src/components/tv/ProcessQuickSheet.tsx` | `processId` + `onClose`. |
| Processo (ficha completa) | `src/components/cases/ProcessDetailSheet.tsx` | |
| Movimentação processual (aviso do sino / notificação do sistema) | `abrirMovimentacaoSheet()` de `src/lib/movimentacaoSheet.ts` | Intent global; quem escuta é o `MovimentacaoSheetHost` (montado no `App.tsx`). Abre o `ProcessUpdatesBell` escopado **de baixo pra cima** (`side="bottom"`), com a movimentação destacada, a etiqueta "Notificado" e o botão da ficha do processo. Aceita só `updateId` — o host resolve o processo. |
| Lead | `LeadEditDialog` | Ver skill/memória de formulários únicos. |
| Imagem / PDF / mídia | `MediaLightbox` | Imagem **nunca** abre página nem aba — regra própria. |
| Página de PDF em canvas | `src/components/whatsapp/PdfCanvasViewer.tsx` | Usado por dentro do `MediaLightbox`; raramente precisa ser chamado direto. |

Carregue com `lazy()` + `<Suspense>` quando o painel for pesado e a tela de
origem for leve (ex.: telão da TV).

### PDF: nunca `<iframe src="....pdf">` (30/08/2026)

O Chrome e o WebView do **Android não têm visualizador de PDF embutido**. Um
iframe apontando para um PDF vira um retângulo cinza com "PDF / arquivo.pdf /
Abrir" — e aquele "Abrir" é do sistema, tira a pessoa do app. Foi o que
acontecia ao abrir peça do acervo na aba Documentos do processo.

Por isso o `MediaLightbox` desenha as páginas por conta própria, com o pdf.js
(`PdfCanvasViewer`). Pontos que **não** podem ser desfeitos por engano:

- **build `legacy`** do `pdfjs-dist` (`pdfjs-dist/legacy/build/pdf.mjs`). O build
  moderno usa APIs de JS recém-lançadas (`Map.getOrInsertComputed` na v6) que
  nem o Chrome atual tem — verificado: página em branco e `TypeError` no
  console. Legacy é transpilado e roda no WebView do Android.
- **import dinâmico**: o pdf.js (≈123 kB gzip + worker) só baixa quando alguém
  abre um PDF, nunca no bundle inicial.
- **render por proximidade**: peça de autos tem centenas de páginas; só desenha
  o que está perto da viewport e libera o canvas de quem saiu (uma A4 em 2x são
  ~5 MB de bitmap).
- o iframe continua no código **só como rede de segurança** se o pdf.js falhar.

## Checklist antes de entregar

1. Rodou `grep -n "window.open\|target=\"_blank\"\|location.href" <arquivos alterados>`? Deve voltar vazio.
2. Todo clique de "ver/abrir/detalhar" abre Sheet/Drawer por cima, e o `onClose`
   devolve a pessoa ao estado anterior (a lista continua aberta atrás).
3. Os `title=`/tooltips falam a verdade: "abrir aqui do lado", nunca "abrir em
   nova aba".
4. Ícone coerente: `PanelRightOpen` (ou similar), **não** `ExternalLink` — o
   ícone de link externo promete o que a gente não faz mais.
5. O painel novo não cobre o conteúdo que a pessoa estava lendo (aplique
   `ui-sem-sobreposicao`).

## Exceções

Só existem duas, e ambas precisam ser pedidas pelo usuário na hora:

- Site/serviço **de terceiros** (tribunal, Escavador, Meta), que não roda dentro do app.
- Botão explícito de "abrir em nova aba" pedido pelo usuário para trabalhar em duas telas.

Fora isso: aba lateral ou painel de baixo pra cima. Sem exceção.

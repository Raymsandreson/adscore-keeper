
Objetivo: resolver de vez 3 problemas conectados: (1) build quebrando no PWA, (2) botão “Atualizar” sem efeito real, (3) falta de equivalente ao Ctrl+F5 no Samsung.

1) Diagnóstico (raiz do problema)
- O build está falhando no Service Worker porque o Workbox bloqueia arquivos > 2 MiB e hoje existe um chunk `index-*.js` com ~2.28 MiB.
- Enquanto o build falha, a versão corrigida não sobe; por isso parece que “continua do mesmo jeito”.
- O fluxo atual de atualização está inconsistente:
  - `vite.config.ts` usa `registerType: 'autoUpdate'` + `skipWaiting: true`
  - mas a UI espera atualização manual (`hasUpdate`, dialog “Atualizar agora”, `applyUpdate()` com `SKIP_WAITING`)
  - resultado: o botão gira/verifica, mas não dá feedback claro nem força renovação quando precisa.

2) Plano de implementação (correção definitiva)
- Frente A — Destravar build PWA
  - Em `vite.config.ts`, ajustar Workbox com `maximumFileSizeToCacheInBytes` acima do maior chunk atual (com margem).
  - Manter limpeza de caches antigas (`cleanupOutdatedCaches`) e revisar estratégia de cache para evitar nova quebra por tamanho.
- Frente B — Alinhar estratégia de atualização com o botão
  - Tornar o fluxo de update coerente com UX manual (botão “Atualizar”):
    - detectar update disponível de forma confiável
    - aplicar update de fato ao clicar
    - feedback explícito de “já está atualizado” quando não há nova versão
  - Remover dependência de timeout cego de 3s e trocar por fluxo assíncrono com resultado real.
- Frente C — “Ctrl+F5 no Samsung” dentro do app
  - Adicionar fallback de “forçar atualização” no próprio botão:
    - unregister do service worker
    - limpeza de `caches`
    - recarregamento único da página
  - Isso vira o equivalente mobile do hard refresh, sem teclado.

3) Detalhes técnicos (arquivos)
- `vite.config.ts`
  - Ajustar `workbox.maximumFileSizeToCacheInBytes`.
  - Revisar opção de registro/ativação do SW para ficar compatível com botão manual.
- `src/lib/pwaUpdater.ts`
  - Evoluir para API assíncrona com status (ex.: update encontrado / sem update / sem registro).
  - Implementar função de refresh forçado (limpa SW + cache + reload).
  - Garantir detecção robusta de registro ativo (`serviceWorker.ready` + registration listeners).
- `src/components/FloatingNav.tsx`
  - Botão de atualizar passa a:
    - mostrar estado “checando”
    - informar “app já atualizado” quando for o caso
    - abrir dialog/aplicar update quando disponível
    - oferecer fallback “forçar atualização” (mobile)
- `src/components/updates/UpdateNotesDialog.tsx` (se necessário)
  - Ajustar texto/ação para refletir fluxo real de atualização e fallback.

4) Critério de aceite (teste final)
- Build conclui sem erro do Workbox.
- Em celular Samsung:
  - botão “Atualizar” responde com feedback imediato (não fica “morto”).
  - quando há versão nova, aplica e recarrega corretamente.
  - quando não há versão nova, informa claramente.
  - fallback de atualização forçada resolve caso de cache preso (equivalente ao Ctrl+F5).
- Verificar ponta a ponta no app instalado e no navegador mobile para confirmar estabilidade do menu e da atualização.

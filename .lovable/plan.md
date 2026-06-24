# Plano — Reduzir chamadas do useLeads

## Causa raiz confirmada
`fetchLeads` (src/hooks/useLeads.ts:412-435) faz loop `range(0, PAGE_SIZE-1)` com `PAGE_SIZE=1000`. Com ~15k leads vira 15 requests por carregamento frio. Cada coluna em `LEAD_SELECT_COLUMNS` (50+) infla o payload, então não dá pra subir o limite sem estourar o `max-rows` do PostgREST (1000).

## Estratégia (alinhada com a resposta do usuário)
Duas camadas no `useLeads`:

1. **Camada Index (leve, default em `/leads`):** carrega só `id, ad_account_id, board_id, status, lead_status, lead_name, lead_phone, created_at, updated_at, deleted_at`. ~10 colunas pequenas → cabe 5000+ por página. Para 15k leads: 3 requests em vez de 15.
2. **Camada Detail (sob demanda):** novo hook `useLeadDetails(ids)` que busca o restante das colunas só para os leads visíveis no viewport / cards abertos / drawer. Resultado mescla no cache compartilhado.

Cache `leadsCache` continua único — entradas são leads "parciais" até o detail chegar. UI já tolera campos null.

## Mudanças

### `src/hooks/useLeads.ts`
- Separar `LEAD_INDEX_COLUMNS` (leve) e `LEAD_FULL_COLUMNS` (atual, mantém nome `LEAD_SELECT_COLUMNS` para compat).
- Nova opção `UseLeadsOptions.detailLevel?: 'index' | 'full'` (default `'full'` para não quebrar consumidores legados).
- `fetchLeads`: usar colunas conforme `detailLevel`. Stats (`computeLeadStats`) só precisam de `status`/`lead_status`/`created_at` → continuam OK com index.
- Poller compartilhado também usa colunas index.

### `src/hooks/useLeadDetails.ts` (novo)
- Recebe `string[]` de ids visíveis (debounced 150ms).
- Faz 1 query `.in('id', faltantes)` pedindo `LEAD_FULL_COLUMNS`.
- Mescla via `leadsCache.update` (já existe). Marca ids já carregados num `Set` local da sessão para não rebaixar.

### `src/components/kanban/UnifiedKanbanManager.tsx` (e card render)
- Passar `{ detailLevel: 'index' }` no `useLeads(adAccountId, …)`.
- No componente que renderiza cards visíveis (lista por coluna), usar `IntersectionObserver` ou simples slice → chamar `useLeadDetails(visibleIds)`.
- Drawer/Detalhe ao abrir um card: força fetch full daquele id (já cobre via `useLeadDetails([id])`).

### Outros consumidores
- Não tocar. Continuam com `detailLevel: 'full'` default. Quando o cache estiver populado pela camada index, eles vão revalidar e completar — sem regressão.

## Fora de escopo
- Não muda Realtime, mutations, ZapSign, dashboards Finance.
- Não migra outros consumidores (`Dashboard`, `SegmentAnalysis`, etc.) — fica para iteração futura se aparecer pressão.
- Não mexe em `usePagedLeads` (já existe, sem uso real).

## Riscos
- **Filtros que dependem de coluna não-index** (ex: filtro por `city`, `acolhedor`) deixam de funcionar até o detail chegar. Mitigação: lista de filtros do Kanban hoje usa só `status`/`lead_status`/`board_id` — já cobertos. Auditar antes de habilitar.
- **Card mostra placeholder** enquanto detail carrega. Mitigação: skeleton só nos campos faltantes; nome/telefone já vêm no index.
- **Cache misto** (alguns leads index, outros full). `leadsCache.update` faz merge shallow — campos full preservados quando o index revalida (objeto novo sobrescreve, então merge precisa preservar ricos). **Ajuste necessário em `leadsCache.update`**: quando vier um row com menos chaves que o existente, manter chaves antigas (`{ ...existing, ...row }` em vez de substituir).

## Verificação (Regra V do LDPEV)
1. `bunx tsc --noEmit` passa.
2. Abrir `/leads?cat=previdenciario` com cache vazio → contar requests `leads?select=…` na aba Network. Esperado: ≤3 (index) + 1 por viewport scroll, em vez de 15.
3. Abrir um card → 1 request `leads?id=eq.<uuid>&select=<full>`.
4. Navegar para outra página e voltar → 0 requests (cache fresh).
5. Conferir que Dashboard (`/`) continua funcionando com stats reais (consumidor full).

## Tamanho estimado
- 1 arquivo novo (~80 linhas)
- 3 arquivos editados (~150 linhas no total)
- Sem migration, sem mudança de schema, sem deploy de edge function.
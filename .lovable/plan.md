## Contexto

`useLeads` é consumido por 40+ componentes (Dashboard, Kanban, Finance, Contacts, Activities…). Hoje toda navegação remonta o hook → dispara o loop paginado de 1000 em 1000 do zero. O `leads` retornado é assumido como **dataset completo** em quase todos os lugares (stats, filtros locais, kanban). Trocar o contrato pra paginação cega quebra muita coisa.

## Estratégia em 2 camadas

### 1. Cache compartilhado (default, sem mudança de API)

- Cache **module-level** (singleton fora do React) keyed por `adAccountId ?? '__all__'`.
- Guarda: `{ leads, stats, fetchedAt, inflight }`.
- Política **stale-while-revalidate**:
  - Mount: se há cache → hidrata `leads`/`stats` na hora (sem loading), revalida em background se `> 60s`.
  - Se outro mount já tem `inflight` (Promise) → aguarda a mesma Promise em vez de disparar um segundo loop paginado.
  - TTL frescor: 60s. TTL hard: 10min (acima disso mostra loading se ainda não temos dados).
- Persistência leve em `sessionStorage` (chave por `adAccountId`, comprimida só com os campos do `LEAD_SELECT_COLUMNS`) pra sobreviver a F5 da mesma aba. Skip se >5MB.
- Invalidação:
  - `addLead`, `updateLead`, `deleteLead`, `toggleFollower`, `updateClientClassification`, evento `LEAD_DELETED_EVENT`, payload realtime → atualiza o cache (mesma mutação que já fazem em `setLeads`).
  - Poll incremental (`updated_at > lastPollAt`) já existente continua e também escreve no cache.
- Resultado: navegar entre `/finance` → `/leads` → `/whatsapp` reusa instantaneamente; só dispara fetch se o cache estiver stale.

### 2. API paginada opt-in (sem alterar consumidores atuais)

Adicionar parâmetro novo, sem mexer no comportamento default:

```ts
useLeads(adAccountId)                          // legado: carrega tudo (com cache)
useLeads(adAccountId, { mode: 'paged', pageSize: 50, search })  // novo: sob demanda
```

No modo `paged`:
- Não dispara o loop completo. Faz 1 request por página com `.range()`.
- Retorna extra: `{ page, setPage, totalCount, hasMore, search, setSearch, isFetchingPage }`.
- `search` filtra server-side via `or(lead_name.ilike.%q%,lead_phone.ilike.%q%,lead_email.ilike.%q%)` com debounce 300ms.
- Não popula o cache global (datasets diferentes).
- Stats nesse modo: vem de `count` separado, não calculado localmente.

Consumidores migram pra `mode: 'paged'` um a um quando fizer sentido (listagens grandes). Nada quebra hoje.

## O que NÃO vou mexer

- Assinatura realtime, poll incremental de 3s, mutações (`addLead/updateLead/…`), CAPI, geo-rules, criação de grupo WA, snapshot de auditoria — tudo permanece igual.
- Os 40+ consumidores: zero alteração nesta entrega.
- Schema do banco.

## Riscos e mitigação

- **Cache stale mostrando lead deletado** → realtime + evento local já tratam; cache escuta os mesmos updates.
- **sessionStorage estourar** → guard de 5MB, fallback só em memória.
- **Multi-tab divergência** → realtime resolve em ≤3s; aceitável.
- **Rollback**: cache vive em arquivo novo `src/hooks/useLeadsCache.ts`. Se quebrar, basta voltar o `useLeads.ts` (1 arquivo).

## Entrega desta rodada

Só a **Camada 1 (cache SWR)** + esqueleto da Camada 2 pronto pra uso. Não vou migrar consumidores agora — confirma quais listagens quer paginar primeiro depois que o cache estiver de pé?

## Verificação pós-implementação

1. `npm run build` limpo.
2. Abrir DevTools Network, navegar `/finance` → `/leads` → `/finance`: confirmar que a 2ª visita ao `/leads` não dispara loop `leads?select=...&offset=...`.
3. Editar 1 lead no Kanban: confirmar update instantâneo (cache invalidado).
4. F5 em `/leads`: cache de sessionStorage hidrata antes do fetch.

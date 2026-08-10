# celcoin-gateway — código resgatado, NÃO usar

Esta função **já estava deployada** no Supabase Externo (`kmedldlepwiityjsdahz`, version 25,
criada em 29/04/2026 entre 11:02 e 11:13) e **nunca tinha sido commitada**. O `index.ts` ao lado
é o código exato que está no ar, recuperado em 10/08/2026 — está aqui como registro, para que um
redeploy por cima não apague um código que só existia no servidor.

**Não a use como base para a integração Celcoin.** Ela nunca funcionou:

1. **Base URLs inexistentes.** Ela aponta para `https://openfinance.celcoin.com.br` (produção) e
   `https://sandbox.openfinance.celcoin.com.br` (sandbox). Nenhuma das duas consta na documentação
   da Celcoin, que lista `https://api.openfinance.celcoin.com.br/` para produção (Baas — onde vivem
   os endpoints `/baas/v1/open/dat/…`) e `https://tpp-sandbox.openfinance.celcoin.dev/` para sandbox.
2. **Nunca foi configurada.** Não existe nenhum secret `CELCOIN_*` no Externo. `GET /celcoin-gateway/health`
   responde `500 {"error":"Missing CELCOIN_INTERNAL_KEY secret"}`.
3. **Nunca teve consumidor.** `grep -ri celcoin src/` não retorna nada — nenhuma tela chama esta função.
4. **mTLS.** A Celcoin exige certificado mTLS em produção. O `fetch` do Supabase Edge Runtime (Deno)
   não faz client certificate, então esta função não passaria de sandbox mesmo com as URLs corrigidas.

A integração real vive em `railway-server/src/functions/celcoin-open-finance.ts`, no Railway, que é
onde o mTLS é viável. Quando essa integração estiver validada em produção, esta função pode ser
deletada do Externo com:

```
supabase functions delete celcoin-gateway --project-ref kmedldlepwiityjsdahz
```

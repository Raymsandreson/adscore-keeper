# celcoin-gateway — código resgatado, NÃO usar

Esta função **já estava deployada** no Supabase Externo (`kmedldlepwiityjsdahz`, version 25,
criada em 29/04/2026 entre 11:02 e 11:13) e **nunca tinha sido commitada**. O `index.ts` ao lado
é o código exato que está no ar, recuperado em 10/08/2026 — está aqui como registro, para que um
redeploy por cima não apague um código que só existia no servidor.

**Não a use como base para a integração Celcoin.** Ela nunca funcionou:

1. **Hosts errados.** Ela aponta para `https://openfinance.celcoin.com.br` e
   `https://sandbox.openfinance.celcoin.com.br`, que não existem. A stack de Financial Data são
   quatro hosts distintos (`onboard-ui.smartkeys…`, `api-smartkeys…`, `api-openkeys…`,
   `api.v3.celcoin…`, todos em `.fsapps.app`) — confirmado no `celcoin-data-gateway` do projeto
   Quitepay, que roda contra a Celcoin em produção.
2. **Modelo de autenticação errado.** Ela faz um único `client_credentials` em `/oauth/token`.
   São dois tokens, em hosts diferentes e com esquemas diferentes: o **admin** (Basic, sem body,
   ~1h) que só mexe em consentimento, e o **rpt_token** (form-urlencoded com
   `scope=consent:<id>`, ~5min) que só lê dados. Nenhum dos dois substitui o outro.
3. **Nunca foi configurada.** Não existe nenhum secret `CELCOIN_*` no Externo. `GET /celcoin-gateway/health`
   responde `500 {"error":"Missing CELCOIN_INTERNAL_KEY secret"}`.
4. **Nunca teve consumidor.** `grep -ri celcoin src/` não retorna nada — nenhuma tela chama esta função.

Sobre mTLS: a documentação genérica da Celcoin diz que o certificado é obrigatório em produção, mas o
gateway do Quitepay é uma edge Deno — que não faz client certificate — e está validado em produção
nesta stack. Ou seja, aqui a Celcoin absorve o mTLS com o ecossistema. Não é o motivo pelo qual esta
função não serve; os quatro pontos acima é que são.

A integração real vive em `railway-server/src/functions/celcoin-open-finance.ts`. Quando estiver
validada em produção, esta função pode ser deletada do Externo com:

```
supabase functions delete celcoin-gateway --project-ref kmedldlepwiityjsdahz
```

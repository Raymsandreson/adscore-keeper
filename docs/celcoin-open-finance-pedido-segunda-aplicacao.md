# Pedido à Celcoin — segunda aplicação Financial Data sob o contrato existente

**Status:** rascunho pronto para envio — **não enviado**.
**Contrato:** PRUDENCIO CAPITAL LTDA — CNPJ 47.737.984/0001-51.
**Por que este documento existe:** o endereço de retorno do Open Finance é cadastrado
**na Celcoin, amarrado à credencial** — não vai por chamada. Sem uma credencial própria
para o WhatsJUD, o titular que autorizasse voltaria para a tela do Quitepay, e os
consentimentos dos dois produtos cairiam no mesmo balde (o `list_connections` de um
enxergaria os do outro — problema de LGPD, não de conveniência).

**Cuidado ao redigir:** pedir **segunda aplicação sob o contrato existente**, nunca
"contratar Financial Data" — isso abriria contrato novo, com prazo comercial próprio.

---

## Texto do e-mail

**Assunto:** Segunda aplicação Financial Data sob o contrato PRUDENCIO CAPITAL (CNPJ 47.737.984/0001-51)

Olá,

Já operamos o **Financial Data (Open Finance)** sob o contrato da **PRUDENCIO CAPITAL LTDA — CNPJ 47.737.984/0001-51**, com consentimentos ativos em produção (Banco do Brasil, Bradesco PJ e Nubank).

Precisamos agora habilitar uma **segunda aplicação sob esse mesmo contrato**, para um sistema distinto da mesma casa. Não se trata de contratação nova — é mais um conjunto de credenciais dentro do que já existe, para que os consentimentos dos dois sistemas fiquem segregados. Seguem os pontos:

**1. Credenciais próprias para a nova aplicação.**
Podem emitir um `client_id` / `client_secret` separados para essa segunda aplicação? Precisamos que os consentimentos criados por ela **não apareçam** na listagem da aplicação já existente, e vice-versa — os titulares são distintos e não podem se enxergar.

**2. Cadastro do endereço de retorno.**
Como o retorno pós-autorização é vinculado à credencial e não enviado por chamada, pedimos o cadastro de:

```
https://whatsjud.com.br/openfinance/callback
```

Confirmam que o retorno virá no mesmo formato da aplicação atual — `?ticket=<jwt>&state=<consentId>` — ou muda conforme o cadastro?

**3. Hosts de sandbox.**
Usamos em produção os hosts:
- `onboard-ui.smartkeys.celcoin.production.fsapps.app`
- `api-smartkeys.celcoin.production.fsapps.app`
- `api.v3.celcoin.production.fsapps.app`

Para sandbox, **deduzimos** os equivalentes trocando `production` por `sandbox`, mas nunca validamos. Quais são os hosts de sandbox corretos dessa stack (smartkeys / open-keys)? Ou a recomendação é homologar direto em produção com um consentimento de teste?

**4. Prazo.**
Qual o prazo para a nova credencial ficar ativa, e há alguma etapa de homologação antes de podermos criar o primeiro consentimento em produção?

Obrigado!

---

## Depois que a Celcoin responder

Com `client_id`/`client_secret` em mãos, setar no Railway (`WhatsJud` / `production`):

| Variável | Valor |
|---|---|
| `CELCOIN_CLIENT_ID` | (da resposta) |
| `CELCOIN_CLIENT_SECRET` | (da resposta) |
| `CELCOIN_ENV` | `production` |
| `CELCOIN_REDIRECT_URL` | `https://whatsjud.com.br/openfinance/callback` |

Sem `CELCOIN_ENV=production` o handler cai nos hosts de sandbox inferidos (item 3) —
ir direto para produção **elimina** essa incógnita em vez de criar uma.

Conferir com:

```bash
curl -s -X POST https://adscore-keeper-production.up.railway.app/functions/celcoin-open-finance \
  -H 'Content-Type: application/json' -H "x-internal-key: $RAILWAY_INTERNAL_KEY" \
  -d '{"action":"health"}'
```

Esperado: `env: "production"`, `has_client_id: true`, `has_client_secret: true`,
`redirect_url` preenchido. Hoje (12/08/2026) os três primeiros são `sandbox`/`false`/`false`.

Então o teste ponta a ponta, que nunca rodou:
`list_brands` → `create_consent` → autorizar no banco → callback → `sync_transactions`.

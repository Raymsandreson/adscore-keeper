# Pedido à Celcoin — segunda aplicação Financial Data sob o contrato existente

> **12/08/2026 — o e-mail provavelmente não é mais necessário.** O portal
> `onboard-ui.smartkeys.celcoin.production.fsapps.app/**new-application**` cria
> aplicação em autoserviço. O rascunho fica como reserva, caso a criação esbarre
> em trava comercial. **Antes de ler o resto, ver a seção de hosts no fim** — ela
> tem medição, não dedução.

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

---

## Hosts — medido em 12/08/2026, não deduzido

O código (`celcoin-open-finance.ts:51-54`) monta os hosts interpolando um `tier`
(`production` | `sandbox`) no padrão `*.celcoin.<tier>.fsapps.app`. O `tier`
`sandbox` sempre foi **dedução**. Foi medido e o resultado inverteu a expectativa.

**Produção — os 4 hosts existem e respondem:**

| Host | HTTP |
|---|---|
| `onboard-ui.smartkeys.celcoin.production.fsapps.app` | `200` (é o portal) |
| `api-smartkeys.celcoin.production.fsapps.app` | `401` (exige credencial — correto) |
| `api-openkeys.celcoin.production.fsapps.app` | `404` (servidor real, raiz sem rota) |
| `api.v3.celcoin.production.fsapps.app` | `404` (idem) |

O `404` importa: significa que **um servidor respondeu**. Difere de falha de conexão.

**Sandbox — o DNS resolve, mas não há nada publicado.**

`*.celcoin.sandbox.fsapps.app` resolve para um ELB da AWS em `us-east-1`
(`k8s-ingressn-…elb.us-east-1.amazonaws.com`), e o TLS entrega:

```
subject=O=Acme Co, CN=Kubernetes Ingress Controller Fake Certificate
```

Esse é o certificado que um nginx-ingress serve quando **nenhuma regra casa com o
hostname**. Ou seja: o DNS é curinga, não prova de serviço. `curl` falha com
`SSL: no alternative certificate subject name matches target hostname`.
Vale para `onboard-ui`, `api-smartkeys` e `api-openkeys` — os três.

O tier `dev` sob `.fsapps.app` **não resolve**.

**A documentação pública da FinanSysTech está morta.**
[developers.finansystech.com.br](https://developers.finansystech.com.br/docs/integra%C3%A7%C3%A3o-apis-copy)
descreve outro esquema — `.fsapps.**io**` com tier `dev`/`prd`, e token via
Keycloak (`keycloak.celcoin.shared.fsapps.io/auth/realms/smart-keys/…`) em vez de
`{onboard}/api/portal/onboard/v2/token`. **Nenhum** desses hosts resolve:
`api-smartkeys.celcoin.dev.fsapps.io`, `…prd.fsapps.io`, `api-openkeys.*` e o
próprio `keycloak.celcoin.shared.fsapps.io` — todos NXDOMAIN. Seguir essa doc
levaria a hosts inexistentes. É a mesma armadilha que produziu a
`celcoin-gateway` órfã com `openfinance.celcoin.com.br`.

**Consequência prática:** não existe sandbox alcançável por hostname adivinhável.
A hipótese que sobra é que "ambiente de teste" seja **estado da aplicação**, servido
pelos **mesmos hosts de produção** — o que combina com o portal de criação viver
em `…production.fsapps.app` e com as telas de "Demo da Jornada" / "Usuário de teste".

Portanto: **`CELCOIN_ENV=production`**, que é onde os hosts respondem. Se a
Documentação do portal disser outra coisa, não é mudança de código — as linhas
51-54 já leem `CELCOIN_HOST_ONBOARD`, `CELCOIN_HOST_SMARTKEYS`,
`CELCOIN_HOST_OPENKEYS` e `CELCOIN_HOST_DATA` do ambiente antes do padrão.

**Como refazer esta medição** (leva 30s, não precisa de credencial):

```bash
getent hosts api-smartkeys.celcoin.sandbox.fsapps.app       # curinga: resolve mesmo sem serviço
openssl s_client -connect api-smartkeys.celcoin.sandbox.fsapps.app:443 \
  -servername api-smartkeys.celcoin.sandbox.fsapps.app </dev/null 2>/dev/null \
  | openssl x509 -noout -subject                            # "Fake Certificate" = nada publicado
curl -s -o /dev/null -w '%{http_code}\n' https://api-smartkeys.celcoin.production.fsapps.app/
```

Regra que fica: **DNS resolver não prova que o serviço existe.** Com DNS curinga,
o certificado apresentado é que diz a verdade.

# Open Finance / Celcoin — conciliação bancária

Substitui a Pluggy, que parou de sincronizar em **18/03/2026**. Primeira conexão
real autorizada em **18/08/2026** (Banco Inter PJ, Prudencio Capital).

## Onde vive

`supabase/functions/celcoin-open-finance/` no Supabase **Externo**
(`kmedldlepwiityjsdahz`). **Não** no Railway: a borda da Celcoin barra tráfego de
fora do Brasil, e o Railway sai por Santa Clara/US — toma 403 com corpo HTML de
WAF, a requisição nem chega na aplicação. A edge sai de São Paulo. Isso também
mantém CPF/CNPJ, saldo e extrato em território nacional (LGPD).

O `functionRouter` roteia `'celcoin-open-finance': 'external'` e é o único alvo
externo que repassa o JWT do Cloud em `x-cloud-jwt` — `callExternal` manda só a
anon key, que é pública e não identifica ninguém.

## A stack é smartkeys/openkeys, não a doc pública

A doc aberta da Celcoin descreve a BaaS, outra coisa. A referência real é o
`celcoin-data-gateway` do **Quitepay** (`~/Projetos/Quitepay`), que roda contra
esta mesma stack em produção. Antes de mexer em endpoint, conferir lá.

Dois tokens, hosts diferentes, não se substituem:

| token | endpoint | como | vida | serve pra |
|---|---|---|---|---|
| admin | `POST {onboard}/api/portal/onboard/v2/token` | Basic auth, sem body | ~1h | criar/ler consentimento |
| rpt | `POST {data}/api/open-keys/token` | form-urlencoded, `scope=consent:<id>` | ~5min | ler dados |

O consentimento não viaja em header: está embutido no escopo do rpt_token.

## Caminhos de dados são VERSIONADOS

Custou meia hora de diagnóstico errado em 18/08/2026. Path sem versão devolve
404, e 404 é tratado como "recurso não consentido" — vira `[]`, e a resposta sai
`{"success":true,"accounts":[]}` com cara de sucesso.

```
resources/v3/resources
accounts/v2/accounts
accounts/v2/accounts/{accountId}/transactions
credit-cards-accounts/v2/accounts
credit-cards-accounts/v2/accounts/{cardId}/bills
credit-cards-accounts/v2/accounts/{cardId}/bills/{billId}/transactions
```

**Vazio nunca é prova de que não há dado.** Se vier `[]`, conferir o log da edge
antes de concluir qualquer coisa — o 404 engolido agora sai como `console.warn`.

## As duas pontas da janela são obrigatórias

O detentor recusa a janela pela metade: `422 OPFDA010 — DATA INICIAL OU DATA
FINAL NÃO INFORMADAS`. Vale pra conta (`fromBookingDate`/`toBookingDate`) e pra
fatura (`fromDueDate`/`toDueDate`). Sem `to` no body, o teto é hoje em Brasília;
data UTC adiantaria um dia depois das 21h e viraria data futura pro detentor.

## O horário vem em UTC e ninguém avisa

`transactionDateTime` chega em UTC. Fatiar a string ISO grava data e hora de
Londres. Medido contra o extrato do Inter em 18/08/2026: **38 dos 298 lançamentos
(12,8% — os de 21h em diante) caíam no dia seguinte**, e as 298 horas vinham 3h
adiantadas. Os totais batiam perfeitamente; só o dia a dia mentia. Converter pra
`America/Sao_Paulo` antes de fatiar (`emBrasilia()`).

Cuidado: `bookingDate` e a coluna `transaction_date` já vêm sem hora. Converter
esses desloca pra TRÁS — meia-noite UTC é 21h do dia anterior aqui. Data pura
passa intacta.

Sintoma pra reconhecer de novo: histograma por hora com pico entre 00h e 03h e
buraco entre 05h e 08h. Ninguém movimenta conta de madrugada e para de manhã.

## Convivência com a Pluggy

Mesmas tabelas (`bank_transactions`, `credit_card_transactions`), separadas pela
coluna `provider`. A UNIQUE é `(provider, pluggy_transaction_id)` e a tela de
conciliação **não filtra por provider** — se as janelas se sobrepusessem, a mesma
despesa apareceria duas vezes. Quem evita isso é o `syncFloor` — ver abaixo.

Rollback do sync: `DELETE FROM bank_transactions WHERE provider = 'celcoin'`.

## syncFloor combina duas perguntas, não uma

O piso da janela responde **duas** perguntas diferentes, e confundi-las gera
duplicata num sentido e buraco no outro:

| pergunta | filtro | o que faz |
|---|---|---|
| até onde a **Celcoin** já foi? | `provider = 'celcoin'` | volta `DIAS_DE_REPROCESSO` (3) por cima |
| até onde a **Pluggy** foi? | sem filtro | piso intransponível: a tela não filtra por provider |

O reprocesso de 3 dias não é folga: **o dia corrente não fecha**. A versão
original começava no dia seguinte ao último lançamento gravado, o que é correto
num backfill único e destrói dado num sync recorrente — a rodada das 06h grava a
madrugada, a próxima começa amanhã, e tudo o que o banco lançar hoje das 06h em
diante nunca é buscado.

Não é hipótese. Em 19/08/2026, a primeira rodada com o piso novo trouxe um Pix de
R$ 250,00 **do dia 18/08 às 18:43** — o backfill de 18/08 tinha rodado às 16:12 e
não podia tê-lo visto. Com o piso antigo aquela linha estava perdida para sempre,
calada. Bancos também lançam retroativo; 3 dias é a margem.

Reprocessar é de graça em termos de dado: a UNIQUE `(provider, pluggy_transaction_id)`
faz o upsert sobrescrever a mesma linha. Medido na mesma rodada: 10 linhas tocadas
na janela, **0 duplicatas**, +1 linha nova.

## O sync recorrente mora no Railway, não em pg_cron

`runCelcoinSync` em `railway-server/src/index.ts` chama a ação `sync_all` da edge
às **06h, 12h e 19h** de Brasília (`CELCOIN_SYNC_HOURS_BRT`), com trava por
data+hora e `setInterval` de 10 min — intervalo de 24h não sobrevive a restart do
Railway, cada deploy adiaria o disparo (mesma razão do `sync-hearings`).

**Por que não pg_cron**, que é o padrão da casa para agendamento: a edge exige
`service_role` no `Authorization` (ela cria consentimento e lê extrato com a
credencial da firma). Em 19/08/2026 os **13** jobs de `cron.job` que mandam Bearer
carregam **todos a anon key** — nenhum tem service_role. Copiar o Bearer de um job
existente, que é o padrão documentado em `20260812020000_...`, daria **401 calado
todo dia**. A alternativa seria gravar a service_role em texto puro dentro de
`cron.job.command`, e daí dentro da migration no repo. No Railway a chave já
existe em `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` e nenhum segredo novo circula.
O bloqueio geográfico da Celcoin não atrapalha: quem fala com a Celcoin é a edge,
de São Paulo; o Railway só fala com o Supabase.

`sync_all` percorre **todo consentimento AUTHORISED** em vez de receber um
`consent_id`: agendamento com id fixo quebra calado no dia da renovação. Uma
conexão que falha não derruba as outras, e `falhas > 0` sai como `console.error`
com o nome do banco — grep `[cron:celcoin-sync]` no log do Railway.

## Grafia do status: AUTHORISED vs AUTHORIZED

A Celcoin devolve com **Z**; o Open Finance Brasil e o nosso código usam **S**.
Normalizar na leitura e na escrita (`normalizarStatus`). Cuidado com substring:
`AWAITING_AUTHORIZATION` contém `AUTHORIZ` e não pode virar autorizado.

## Consentimento PJ

- `loggedUser` é **sempre o CPF do representante legal**, mesmo em conta PJ.
- O CNPJ vai em `businessEntity`.
- `CUSTOMERS_PERSONAL_*` tem que virar `CUSTOMERS_BUSINESS_*`, senão 422.
- `expirationDateTime`: RFC3339 **sem milissegundos**, via `setUTCMonth`, e
  recuado 1 minuto — senão 400 DADOS_INVALIDOS.

### O CNPJ tem que ser o da conta, não o do contrato

Erro real em 18/08/2026: usamos 47.737.984/0001-51 achando que era
"Raymsandreson Prudêncio Advogados". É **PRUDENCIO CAPITAL LTDA** — o CNPJ do
*contrato da Celcoin*. A firma tem duas contas Inter Empresas distintas
(`Inter R.P.Adv` e `Inter P.CAP`, ver `pluggy_connections.custom_name`), cada uma
exigindo seu próprio consentimento.

Sintoma de CNPJ que o titular não representa: o Inter aceita o consentimento,
emite o `urn:bancointer:...`, e **quebra na tela de autorização** com
"Não foi possível exibir as informações". Não confundir com `invalid_request_uri`,
que é só link expirado.

CNPJs conhecidos: PRUDENCIO CAPITAL `47.737.984/0001-51`; WHATSJUD TECNOLOGIA EM
SOFTWARE `48.628.348/0001-54` (`TermsOfServicePage.tsx`). O da R.P.Advogados não
está em lugar nenhum do repo.

## O link de autorização expira em poucos minutos

O `request_uri` do PAR dura pouco — a autorização de 18/08 aconteceu 84s depois
de gerada. Não adianta gerar e mandar depois: gerar com o titular já com o
celular na mão. `scratchpad/of-link.sh` gera um em ~2s e aceita o CNPJ como
argumento.

## Estado em 18/08/2026

| item | estado |
|---|---|
| Inter PJ / Prudencio Capital | **AUTHORISED** até 2027-08-18. 298 lançamentos de 19/03 a 18/08, **conferidos contra o extrato em PDF: diferença zero** em data e valor, os 6 meses fechando individualmente. |
| Inter PJ / R.P.Advogados | pendente — falta o CNPJ |
| Santander | pendente — é conta **pessoal** (`PERSONAL_BANK`), consentimento PF sem CNPJ |
| Cartão de crédito | `list_accounts` devolve o CDPRO e `resources` mostra 1 CREDIT_CARD_ACCOUNT AVAILABLE, mas o sync trouxe **0** transações. **Não verificado** se é ausência real de fatura na janela ou defeito. |
| Pluggy | **não aposentada.** Parou de trazer dado em 18/03/2026 mas as 3 conexões ainda dizem `status: UPDATED` (rótulo velho — o medidor é `last_sync_at`). O hook `useCreditCardTransactions` ainda tem 7 ações vivas apontando pra edge `pluggy-integration` no Cloud. As 2.583 + 5.524 linhas históricas são tudo que existe antes de 19/03. |
| **Sync recorrente** | **Existe desde 19/08/2026**: `runCelcoinSync` no Railway, 06h/12h/19h BRT, chamando `sync_all`. Verificado à mão na mesma data: 1 consentimento, 0 falhas, janela `2026-08-15 → 2026-08-19`. Falta **alerta de obsolescência** — nada avisa quando o último lançamento envelhece; o rótulo de status não serve de medidor, serve a data do último lançamento. Foi assim que a Pluggy morreu calada por 5 meses. |

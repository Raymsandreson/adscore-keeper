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
| até onde **esta conexão** já foi? | `provider='celcoin'` + `pluggy_item_id in (irmãs)` | volta `DIAS_DE_REPROCESSO` (3) por cima |
| até onde a **Pluggy** foi? | `provider is null or provider <> 'celcoin'` | piso intransponível: a tela não filtra por provider |

O escopo da primeira linha é **por conexão, não por usuário** (v13, 19/08/2026).
Não é refinamento: com o Inter já tendo gravado até 18/08, um consentimento novo
do Santander nasceria com piso 15/08, e de 19/03 a 14/08 nunca seria buscado —
calado. Simulado contra o banco real antes de subir: Inter continua em 15/08
(sem regressão), Santander nasceria em 19/03, exatamente onde a Pluggy parou.

"Irmãs" são todos os `consent_id` do mesmo `brand_id` e do mesmo usuário,
**inclusive os `ABANDONED`**. Reautorizar o banco emite um `consent_id` novo, e o
extrato que o anterior trouxe continua sendo dessa conexão; sem isso a
reautorização reimportaria o histórico inteiro, porque o transmissor não promete
`transactionId` estável entre consentimentos. O Inter já tem 7 consentimentos
irmãos (6 `ABANDONED` + 1 `AUTHORISED`).

O `.or('provider.is.null,provider.neq.celcoin')` da segunda linha é guarda
deliberada: no PostgREST, `.neq()` **exclui NULL** (`NULL <> 'celcoin'` é NULL, e
NULL é filtrado). Medido: hoje `provider` nunca é NULL nas duas tabelas, mas a
coluna admite.

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

## Obsolescência: `last_sync_at` é medidor morto

São duas perguntas, e a tela media a errada:

| campo | responde | quando envelhece |
|---|---|---|
| `last_sync_at` | a **rodada** aconteceu | nunca, enquanto o cron rodar |
| último `transaction_date` da conexão | chegou **dado** | assim que a fonte silencia |

A edge carimba `last_sync_at` no fim de todo sync que termina sem erro,
**inclusive trazendo zero linha**. Com o cron do Railway rodando 3x/dia, o
alerta de "sem sincronizar há N dias" que existia no `consentHealth` era um
alarme sem badalo: não podia tocar. É o formato exato da falha da Pluggy — as 3
conexões dizem `status: UPDATED` até hoje, sem um lançamento desde 18/03/2026.

Desde **20/08/2026** `list_connections` devolve `last_transaction_date` por
conexão (maior `transaction_date` entre as duas tabelas, filtrando
`provider='celcoin'` e `pluggy_item_id=<consent>`), e o `consentHealth` decide
por ele. O cálculo é na edge porque `bank_transactions` e
`credit_card_transactions` são das poucas tabelas do Externo com RLS de verdade
(`user_id = auth.uid()`) — ver a seção abaixo.

**Limiares, medidos e não chutados.** Sobre os 5 meses que a Celcoin já trouxe
do Inter PJ (300 lançamentos, 113 dias com movimento entre 19/03 e 20/08):

- maior silêncio real: **3 dias** (08/07 → 12/07)
- buracos de 2 dias: 8, todos fim de semana
- buracos de 4 dias ou mais: **nenhum**

Daí `atenção` a partir de **5 dias** e `parado` a partir de **10** — zero falsos
positivos em todo o histórico disponível, e ainda cobre o pior caso que a janela
medida não contém (Carnaval encadeia 4 dias sem lançamento entre a sexta e a
quarta). O medidor de "o sync parou" continua existindo, separado, em 2 dias:
causa diferente, conserto diferente, rótulo diferente.

Testes: `src/hooks/__tests__/celcoinConsentStatus.test.ts`.

## As telas de conciliação leem o Cloud; a Celcoin grava no Externo

**Descoberto em 20/08/2026, não corrigido.** Os quatro pontos do front que leem
transação apontam para o cliente `supabase` — que é o **Cloud**
(`gliigkupoebmlbwyvijp`):

- `src/components/finance/BankTransactionsView.tsx`
- `src/components/finance/AccountPermissionsManager.tsx`
- `src/hooks/useCreditCardTransactions.ts`
- `src/hooks/useCardPermissions.ts`

A edge grava com `Deno.env.get('SUPABASE_URL')`, e ela roda no **Externo**.
Nenhum caminho escreve linha da Celcoin no Cloud — `celcoin_consents` nem existe
lá (PostgREST devolve `PGRST205`). Medido: o `bank_transactions` do Cloud **não
tem a coluna `provider`** (erro `42703`), ou seja, nunca recebeu a migration
`20260810201123`. São dois objetos homônimos em bancos diferentes.

Consequência: **os 300 lançamentos do Inter não aparecem em tela nenhuma.**

O conserto não é trocar o cliente para `externalSupabase`. A RLS do Externo
nessas tabelas é `user_id = auth.uid()`, e a sessão que o front mantém lá é
`signInAnonymously()` (`external-client.ts`) — um uid anônimo que nunca casa com
o dono das linhas (`21924f81…`, 2.883 linhas, todas dele). A leitura voltaria
**vazia, não com erro**, que é a forma cara de errar. As saídas reais são ler
via edge com service role (como `list_connections` já faz) ou dar identidade de
verdade ao front no Externo. Decisão pendente.

Isso não afeta o dado gravado: a sucessão Pluggy → Celcoin no Externo está
contígua e sem sobreposição — pluggy 2.583 linhas de 13/02/2025 a 18/03/2026,
celcoin 300 de 19/03/2026 a 20/08/2026.

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

## Consentimento não autorizado não se revoga, e não caduca

Medido em 19/08/2026 contra os seis órfãos criados no dia anterior:

- **Não caduca.** Os seis seguiam `AWAITING_AUTHORIZATION` 21h depois, com
  `expirationDateTime` em **2027-08-18** — que é a expiração do consentimento
  pedido, não uma janela de autorização. Eu supunha o contrário (o Open Finance
  manda rejeitar em 60 min); a Celcoin/Inter não faz essa transição.
- **Não se revoga.** `DELETE {smartkeys}/…/consents/:id` devolve
  `422 Unprocessable Entity`, sem código no corpo, para consentimento que nunca
  foi autorizado. Faz sentido: não há acesso a encerrar. O `celcoin-data-gateway`
  do Quitepay, na mesma stack, também não os revoga — filtra `AUTHORISED` na
  leitura e ignora o resto.

Daí `descartar()` ter **dois desfechos**, e o banco guardar qual foi:

| status local | significado |
|---|---|
| `REVOKED` | a Celcoin aceitou o DELETE (ou respondeu 404) — acesso encerrado |
| `ABANDONED` | a Celcoin recusou — **continua existindo lá**, inerte, até expirar |

Chamar os dois de `REVOKED` seria mentira no banco. A tela mostra a diferença no
cartão descartado, em vez de escondê-la.

**A causa raiz era o acúmulo, não a existência.** Cada tentativa de link gera um
consentimento novo, e o `request_uri` do PAR dura poucos minutos — foi assim que
18/08 acumulou seis do mesmo banco em cinco horas. Desde 19/08 o `create_consent`
descarta os `AWAITING` anteriores **do mesmo banco e do mesmo usuário** antes de
criar o novo (best-effort, nunca bloqueia a conexão; desligável com
`revogar_anteriores: false`). Gerar link novo *é* abandonar o anterior.

`revoke_consent` recusa com **409** um consentimento `AUTHORISED`, salvo
`force: true`: na tela todos os cartões mostram o mesmo nome de banco, e o clique
errado mataria a conexão que sustenta a conciliação.

## O link de autorização expira em poucos minutos

O `request_uri` do PAR dura pouco — a autorização de 18/08 aconteceu 84s depois
de gerada. Não adianta gerar e mandar depois: gerar com o titular já com o
celular na mão. `scratchpad/of-link.sh` gera um em ~2s e aceita o CNPJ como
argumento.

## Estado em 20/08/2026

| item | estado |
|---|---|
| Inter PJ / Prudencio Capital | **AUTHORISED** até 2027-08-18. 298 lançamentos de 19/03 a 18/08, **conferidos contra o extrato em PDF: diferença zero** em data e valor, os 6 meses fechando individualmente. |
| Inter PJ / R.P.Advogados | pendente — falta o CNPJ |
| Santander | pendente — é conta **pessoal** (`PERSONAL_BANK`), consentimento PF sem CNPJ |
| Cartão de crédito | A conta existe (`40b9d9e8…`) e `/bills` responde 200 — com **lista vazia**. Instrumentado em 19/08: não é o nome do campo `billId`, é a lista mesmo. Corroborado pela Pluggy, que em 14 meses nunca viu fatura nas 2 conexões do Inter (os 5.524 lançamentos de cartão são **todos** do Santander). Resta desempatar "não há fatura" de "a janela `fromDueDate/toDueDate` não vale neste transmissor": o retry sem janela está escrito e **aguarda deploy**. |
| Consentimentos órfãos | **Resolvidos em 19/08/2026.** Os 6 `AWAITING` viraram `ABANDONED` (a Celcoin recusou revogar, 422) e saíram da tela. Seguem existindo na Celcoin, sem acesso a nada, até 18/08/2027. |
| Pluggy | **não aposentada.** Parou de trazer dado em 18/03/2026 mas as 3 conexões ainda dizem `status: UPDATED` (rótulo velho — o medidor é `last_sync_at`). O hook `useCreditCardTransactions` ainda tem 7 ações vivas apontando pra edge `pluggy-integration` no Cloud. As 2.583 + 5.524 linhas históricas são tudo que existe antes de 19/03. |
| Piso da janela | **Por conexão desde 19/08/2026** (v13). Antes era por usuário, e um consentimento novo do Santander nasceria com piso 15/08 — de 19/03 a 14/08 nunca seria buscado, calado. Simulado contra dado real: Inter segue em 15/08 (sem regressão), Santander nasceria em 19/03, exatamente onde a Pluggy parou. |
| Alerta de obsolescência | **Front pronto em 20/08/2026** (`consentHealth` + 6 testes). O campo que ele consome (`last_transaction_date` em `list_connections`) **aguarda o mesmo deploy**. Falta ainda o aviso fora do painel de conexões — hoje é preciso abrir a aba para ver. |
| Conciliação em tela | **Quebrada, e não era conhecido.** As telas leem o Cloud, a Celcoin grava no Externo. Ver seção própria. |
| **Sync recorrente** | **Existe desde 19/08/2026**: `runCelcoinSync` no Railway, 06h/12h/19h BRT, chamando `sync_all`. Verificado à mão na mesma data: 1 consentimento, 0 falhas, janela `2026-08-15 → 2026-08-19`. O alerta de obsolescência saiu da lista em 20/08 — ver seção própria. |

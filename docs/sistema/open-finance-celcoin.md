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
| até onde **esta conta** já foi? | `provider='celcoin'` + `pluggy_account_id = <conta>` | volta `DIAS_DE_REPROCESSO` (3) por cima |
| até onde a **Pluggy** foi? | `provider is null or provider <> 'celcoin'` | piso intransponível: a tela não filtra por provider |

O escopo da primeira linha é **por conta** — não por usuário, não por
consentimento, não por banco (v16, 24/08/2026). Ele já foi as três coisas
erradas, e cada correção veio de um buraco encontrado depois:

| versão | escopo | como falhava |
|---|---|---|
| até v12 | usuário | consentimento novo de outro banco nascia com o piso do banco já sincronizado |
| v13 (19/08) | consentimento + irmãs por `brand_id` | **duas contas no mesmo banco viram irmãs** |
| v16 (24/08) | conta (`pluggy_account_id`) | — |

O caso da v13 não é hipotético: em 24/08/2026 a conta da R.P.Advogados foi
conectada no mesmo `brand_id` da P.CAP (ambas Inter PJ, mesmo usuário). A
primeira rodada nasceu com o piso da P.CAP, trouxe **81 linhas de 6 dias** e
respondeu `success: true`. Os **1.641** lançamentos de 19/03 a 18/08 não seriam
buscados nunca — o cron só anda para a frente. O que denunciou foi o campo
`janela` na resposta: `bank_from: 2026-08-19` onde deveria ser `2026-03-19`.
Sem esse campo o sync teria passado por bem-sucedido.

Corrigido rodando `sync_transactions` com `from` explícito: 1.722 lançamentos,
19/03→24/08, R$ 4.894.999,07 de crédito. Zero `pluggy_transaction_id` repetido e
zero linha Celcoin antes de 19/03 — o encaixe com a Pluggy ficou exato.

**O que sobrou de risco.** Uma conta sem lançamento próprio é ambígua: ou é conta
nova, ou é a mesma conta reautorizada num consentimento que trocou o
`accountId` — o padrão não promete id estável entre consentimentos. Os dois casos
pedem coisas opostas e dali não dá para distinguir. A escolha foi **puxar o
histórico e avisar**: se houver consentimento irmão com dado, sai um
`console.warn` nomeando a conta e até onde o irmão gravou. Duplicata aparece na
tela de conciliação e se conserta; buraco não aparece e ninguém volta para
buscar. No Inter o `accountId` é o próprio número da conta com o dígito
(`210193930` para a conta terminada em `93-0`), então lá o caso não deve ocorrer.

"Irmãs" continuam sendo todos os `consent_id` do mesmo `brand_id` e do mesmo
usuário, **inclusive os `ABANDONED`** — mas agora servem só para emitir esse
aviso, não para calcular o piso.

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

Desde a **v14 (20/08/2026)** `list_connections` devolve `last_transaction_date` por
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

## As telas de conciliação liam o Cloud; a Celcoin grava no Externo

**Descoberto em 20/08/2026, corrigido em 24/08/2026 (v17).** Os quatro pontos do front que leem
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

Consequência enquanto durou: **os lançamentos da Celcoin não apareciam em tela
nenhuma.**

**Por que trocar o cliente para `externalSupabase` não resolveria.** Duas razões
independentes, e a segunda é a que quase ninguém vê:

1. A RLS do Externo nessas tabelas é `user_id = auth.uid()` (mais
   `can_view_pluggy_account`/`can_view_card`), e a sessão que o front mantém lá é
   `signInAnonymously()` (`external-client.ts`). Uid anônimo nunca casa com o dono
   das linhas. A leitura voltaria **vazia, não com erro**.
2. **Os uuids não são os mesmos nos dois bancos.** Medido em 24/08/2026: dos 52
   usuários em `auth_uuid_mapping`, **26 têm uuid diferente** no Cloud e no
   Externo — e o dono de 100% dos lançamentos é um deles (`79c5c9d1…` no Cloud,
   `21924f81…` no Externo). Os 7 usuários das tabelas de permissão são **todos**
   uuids do Externo; **zero** batem como uuid do Cloud. Mesmo com sessão
   autenticada de verdade, comparar o uid do Cloud com `user_id` daria vazio.

**Como ficou (v17).** A edge ganhou `list_transactions`: resolve a identidade
pelo JWT do Cloud, traduz pelo `auth_uuid_mapping`, reproduz a regra das policies
(`user_id = eu` OR conta/cartão permitido — as duas funções são `EXISTS` numa
tabela de permissão e nada mais, conferido com `pg_get_functiondef`) e lê com
service role. `BankTransactionsView` e `useCreditCardTransactions` passaram a ler
por ela. A identidade vem do JWT e **nunca** do corpo: aceitar `user_id` do body
deixaria qualquer sessão válida ler o extrato de qualquer colega.

Pagina de mil em mil com chave estável (`transaction_date` + `id`). O teto de
1.000 linhas do PostgREST cortava a lista **calado** na versão que lia o Cloud —
lista financeira truncada em silêncio é conciliação errada, não lista incompleta.
A resposta devolve `truncado` e `identidade` para que "não apareceu nada" seja
diagnosticável de fora: sem isso, uuid não mapeado e conta sem movimento são a
mesma tela vazia.

Conferido contra gabarito calculado no banco com as próprias funções
`can_view_*`: dono 4.609 banco / 5.524 cartão, e cada um dos outros com o seu
subconjunto — todos batendo linha a linha.

**A terceira leitura, achada por print da tela (v18).** Corrigir as transações
não bastou: a tela de Gastos do Cartão esconde **tudo** quando `connections` vem
vazia (`FinancePage.tsx`, `connections.length === 0`), e essa lista vinha da edge
`pluggy-integration` do **Cloud**. As 3 conexões existem no Externo, todas de
`21924f81`. O gate da lista vem antes do gate do dado — com o extrato já legível,
a tela continuava dizendo "Nenhuma conta conectada". Resolvido com
`list_pluggy_connections`, que reproduz a policy da tabela como ela é: `user_id =
eu OR EXISTS (user_card_permissions where user_id = eu)` — mais frouxa que a das
transações e **não** por conexão (quem tem qualquer cartão vê todas). Reproduzida,
não apertada; apertar é decisão de produto.

Lição que vale além daqui: numa tela com estado vazio, **corrigir a fonte do dado
não adianta se o gate do render lê outra fonte.** Procurar todos os `length === 0`
que escondem a tela, não só as queries do dado.

**Três botões desligados de propósito** (`ACOES_PLUGGY_INDISPONIVEIS`): renomear,
gerar link e excluir conexão. Eles só passaram a aparecer porque a lista voltou a
ter linhas, e os três escrevem na cópia do **Cloud** — o clique sumiria sem erro e
a linha continuaria lá. Botão que mente é pior que botão que falta. Voltam com a
etapa 2.

**Ainda leem o Cloud** (etapa 2): `AccountPermissionsManager.tsx` e
`useCardPermissions.ts`, que administram as permissões, mais as 6 ações de
escrita da Pluggy em `useCreditCardTransactions` (import, connect token, save,
sync, delete, rename). Enquanto isso, a fonte da verdade das permissões é a cópia
do Externo — que é a que a leitura consulta.

Isso não afeta o dado gravado: a sucessão Pluggy → Celcoin no Externo está
contígua e sem sobreposição — pluggy 2.583 linhas de 13/02/2025 a 18/03/2026,
celcoin 2.026 de 19/03/2026 em diante.

## Quem vê a aba "Conta"

A aba aparece para quem **é dono de lançamento OU tem permissão concedida** —
regra derivada do dado, respondida pela ação `my_finance_access` e consumida pelo
hook `useFinanceAccess`. Deliberadamente **não existe lista de nomes no código**:
pessoa hardcoded em fonte não sai quando sai da firma, e ninguém lembra de
procurar por ela depois. Falha de rede fecha a aba em vez de abrir — erro não é
autorização.

Em 24/08/2026 o acesso foi restrito a duas pessoas a pedido do usuário: Alexandre
Medeiros Cavalcante (`cfab247e…`, 5 contas concedidas) e raymsandresonadv
(`21924f81…`, que enxerga por ser dono das linhas). Foram revogadas as 7 linhas de
João Pedro, luisralves7 e Juliana Clara — **só de conta**; as permissões de cartão
dos três ficaram intactas. Rollback em
`scratchpad/rollback-permissoes-conta-20260824.sql`.

No mesmo dia Alexandre recebeu também os **10 cartões** (mesmo conjunto do
raymsandresonadv), porque a policy de `pluggy_connections` exige permissão de
cartão para ver a lista de conexões — sem isso a tela de Gastos do Cartão
continuaria vazia para ele. Alcance conferido: 4.609 de banco e 5.510 de cartão
(os 14 restantes até 5.524 são cartões fora das permissões, que só o dono vê).
Rollback em `scratchpad/rollback-cartoes-alexandre-20260824.sql`.

**Pegadinha achada ao aplicar:** `user_account_permissions.granted_by` tem FK para
o `auth.users` do **Externo**, mas as 7 linhas que já existiam guardam
`79c5c9d1…`, que é uuid do **Cloud**. Elas só existem porque a constraint foi
criada `NOT VALID` — inserir esse mesmo valor hoje toma `23503`. Linhas novas
precisam do uuid do Externo.

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

## Estado em 24/08/2026

| item | estado |
|---|---|
| Inter PJ / Prudencio Capital | **AUTHORISED** até 2027-08-18. 298 lançamentos de 19/03 a 18/08, **conferidos contra o extrato em PDF: diferença zero** em data e valor, os 6 meses fechando individualmente. |
| Inter PJ / R.P.Advogados | **AUTHORISED** em 24/08/2026 (CNPJ 32.965.023/0001-27). 1.722 lançamentos de 19/03 a 24/08, R$ 4.894.999,07 de crédito. É a conta principal: 5,7× a P.CAP em lançamentos e 6,6× em dinheiro. Sem conta de cartão exposta. |
| Santander | pendente. É conta **pessoal** (`PERSONAL_BANK` em `pluggy_connections`), consentimento PF sem CNPJ — a marca está certa. Três tentativas (19/08 e duas em 24/08) e nenhuma autorizou: a página de autorização do Santander **trava carregando** depois de receber o `request_uri`. Não é link vencido — link vencido devolve na hora `400 invalid_request_uri`, que é o que a sondagem mostra *depois* do clique consumir o `request_uri`. Causa desconhecida; próximo passo é tentar pelo celular com o app instalado e registrar o que aparece antes de travar. |
| Cartão de crédito | A conta existe (`40b9d9e8…`) e `/bills` responde 200 — com **lista vazia**. Instrumentado em 19/08: não é o nome do campo `billId`, é a lista mesmo. Corroborado pela Pluggy, que em 14 meses nunca viu fatura nas 2 conexões do Inter (os 5.524 lançamentos de cartão são **todos** do Santander). **Desempatado em 20/08/2026** (v14): o `/bills` foi chamado duas vezes, com janela (729b) e sem (597b), e as duas voltaram vazias — `0 faturas, com e sem janela`. A janela não está engolindo resultado; o Inter não tem fatura mesmo. Fica a ressalva de que isso **não prova** que `fromDueDate/toDueDate` sejam os nomes certos num transmissor que TENHA fatura — as duas hipóteses dão vazio aqui. O retry cobre esse caso quando aparecer: se vier 0 com janela e N sem, ele usa as N e o log diz que o par de parâmetros não vale. |
| Consentimentos órfãos | **Resolvidos em 19/08/2026.** Os 6 `AWAITING` viraram `ABANDONED` (a Celcoin recusou revogar, 422) e saíram da tela. Seguem existindo na Celcoin, sem acesso a nada, até 18/08/2027. |
| Contas ainda de fora | A Pluggy via **três** contas; hoje duas estão na Celcoin. Identificadas em `pluggy_connections`: `0a7772c8` = Inter R.P.Adv (conectada 24/08), `899a397c` = Inter P.CAP (conectada 18/08), `e23e8530` = Santander PF (pendente). A do Santander é a única fonte de cartão que já existiu: os 5.524 lançamentos de cartão são todos dela. |
| Pluggy | **não aposentada.** Parou de trazer dado em 18/03/2026 mas as 3 conexões ainda dizem `status: UPDATED` (rótulo velho — o medidor é `last_sync_at`). O hook `useCreditCardTransactions` ainda tem 7 ações vivas apontando pra edge `pluggy-integration` no Cloud. As 2.583 + 5.524 linhas históricas são tudo que existe antes de 19/03. |
| Piso da janela | **Por conta desde 24/08/2026** (v16). Foi por usuário (até v12) e por marca (v13); a segunda fez a conta nova da R.P.Adv herdar o piso da P.CAP e pular 1.641 lançamentos dizendo `success: true`. Verificado após o deploy: R.P.Adv usa 21/08 e P.CAP 19/08, cada uma com o seu. |
| Alerta de obsolescência | **Front pronto em 20/08/2026** (`consentHealth` + 6 testes). O campo que ele consome (`last_transaction_date` em `list_connections`) subiu na v14 e foi conferido: o Inter devolve `2026-08-20`, as demais conexões `null`. Falta o aviso **fora** do painel de conexões — hoje é preciso abrir a aba para ver, e o alerta que exige ser procurado não é alerta. |
| Conciliação em tela | **Corrigida em 24/08/2026** (v17). Extrato de conta e de cartão passam a vir do Externo pela ação `list_transactions`, com tradução de uuid e a mesma regra de visibilidade das policies. Conferido contra gabarito: 4.609/5.524 para o dono. Faltam os dois gerenciadores de permissão, que ainda escrevem no Cloud. |
| Quem vê a aba "Conta" | **Alexandre Medeiros e raymsandresonadv**, desde 24/08/2026. Regra derivada do dado (`my_finance_access`), sem nome hardcoded. |
| Tela de Gastos do Cartão | **Corrigida em 24/08/2026** (v18). Mostrava "Nenhuma conta conectada" porque a lista de conexões vinha do Cloud; agora vem do Externo por `list_pluggy_connections`. Renomear/gerar link/excluir ficaram desligados — ainda escrevem no Cloud. |
| **Sync recorrente** | **Existe desde 19/08/2026**: `runCelcoinSync` no Railway, 06h/12h/19h BRT, chamando `sync_all`. Verificado à mão na mesma data: 1 consentimento, 0 falhas, janela `2026-08-15 → 2026-08-19`. O alerta de obsolescência saiu da lista em 20/08 — ver seção própria. |

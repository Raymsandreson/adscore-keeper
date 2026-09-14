# Meta Conversions API — conversões do CRM para os anúncios

Como um lead fechado no CRM vira uma conversão atribuída à campanha que o
trouxe. Escrito em 02/09/2026, quando a integração foi reconstruída em cima de
uma fila.

---

## O problema que motivou a reconstrução

Em 02/09/2026 um ping na edge `facebook-capi` devolveu:

```
HTTP 400 {"error":{"message":"Error validating application.
Application has been deleted.","type":"OAuthException","code":190}}
```

O app da Meta que emitia o token de System User tinha sido apagado. A
integração estava parada — e o carimbo `leads.capi_purchase_sent_at` mostrou
desde quando: **12 linhas, todas entre 30 e 31/07/2026**. Mais de um mês de
conversões perdidas.

O que permitiu o silêncio não foi o token. Foi o desenho: quatro caminhos
chamavam a edge e jogavam a falha num `console.warn`. Não havia tabela, fila,
nem tela — nenhum lugar onde alguém pudesse olhar e ver que nada saía.

Três defeitos apareceram junto no levantamento:

| O que se mediu | Número |
|---|---|
| Leads fechados (`became_client_date`) | 3.992 |
| ...com `conversion_value > 0` | **0** — todo Purchase ia com valor zero |
| ...com e-mail ou telefone | 2.654 (66%) |
| Fechados nos últimos 30 dias | 206 |
| ...com e-mail ou telefone | **35 (17%)** |

Evento sem e-mail nem telefone é descartado pela Meta: não há como casar a
pessoa. Evento com valor zero impede otimização por retorno. E o disparador do
`auto-enrich-lead` mandava `{lead_id, event_name}` onde a edge exige
`{events:[...]}` — respondia 400 em 100% das vezes, engolido por
`.catch(()=>{})`.

---

## Desenho atual

```
  meta-capi-reconcile  ← cron 15 min: "fechado na janela sem evento?"
        │                 CAMINHO PRINCIPAL (156 das 171 linhas da fila)
        │
  Kanban / Pipeline / ZapSign / auto-enrich  ← gatilhos de tela (rede de segurança)
        │  (só lead_id — PII não trafega)
        ▼
  meta-capi-enqueue (Railway, service role)
        │  resolve contato, hasheia, resolve valor, decide skip
        ▼  upsert por event_id (ignoreDuplicates) — enfileirar 2x grava 1 linha
  meta_capi_events  ← fila e log, no Externo
        │
        ▼  cron 5 min
  meta-capi-dispatch (Railway) ──► Graph API v25.0 ──► dataset 28837100409207964
        │
        ▼  carimba resultado, fbtrace_id, erro da Meta
  meta_capi_status  ← saúde da credencial (probe de hora em hora)
        │
        ▼
  Configurações → Conversões (painel)  +  /metricas
```

**Enfileirar não é enviar.** Fechar um lead grava uma linha e volta na hora; a
Meta nunca segura o salvamento, e falha da Meta nunca some.

**O reconciliador é o caminho principal, não o reforço.** Ele pergunta pelo
*estado* ("existe fechado sem evento?") em vez de depender de quem fechou, e por
isso cobre os caminhos de backend, o caminho que alguém criar amanhã e o
fechamento feito por SQL na mão. Os gatilhos de tela ficam porque entregam o
evento na hora, mas medido em 14/09 eles respondem por 12 das 171 linhas — ver
"Estado da fila".

### Por que no Railway e não numa edge

O despachante precisa de cron e de service role. `pg_cron` do Externo só manda
anon key, então uma edge com gate de service role não se agenda sem gravar
segredo no vault. O Railway já tem cron in-process com `LOOPBACK_TOKEN`.

---

## Arquivos

| Arquivo | Papel |
|---|---|
| `supabase/migrations/20260902120000_meta_capi_fila_e_log.sql` | `meta_capi_events`, `meta_capi_status`, `vw_meta_capi_saude` |
| `railway-server/src/lib/metaCapiNormalize.ts` | normalização e hash (puro, **com teste**) |
| `railway-server/src/lib/metaCapi.ts` | valor, envio à Graph API, status da credencial |
| `railway-server/src/functions/meta-capi-enqueue.ts` | grava a intenção na fila |
| `railway-server/src/functions/meta-capi-dispatch.ts` | drena a fila; `dry_run`; **15 modos de diagnóstico** |
| `railway-server/src/functions/meta-capi-reconcile.ts` | acha fechado sem evento e enfileira — o caminho principal |
| `railway-server/src/functions/meta-capi-status.ts` | leitura do painel |
| `src/services/metaCapiQueue.ts` | `registrarFechamentoDeLead()` / `enfileiraConversao()` — o que o front chama |
| `src/services/__tests__/fechamento-enfileira-conversao.test.ts` | teste-guarda: quem grava `closed` enfileira ou se explica |
| `src/components/settings/MetaCapiPanel.tsx` | painel (Configurações → Conversões) |
| `railway-server/src/functions/metricas-painel.ts` | aba `/metricas` — ver `docs/sistema/aba-metricas.md` |

Crons, todos in-process no Railway com `LOOPBACK_TOKEN` (`railway-server/src/index.ts`):
drenagem a cada **5 min**, reconciliação a cada **15 min**, probe da credencial a
cada **1 h**. Estado observável em `/health` → `capi_reconcile` e `meta_dataset`.

O legado `src/services/facebookCAPI.ts`, `src/utils/metaConversionTracking.ts` e
a edge `supabase/functions/facebook-capi/` **continuam no repo** e não são mais
chamados pelos caminhos de fechamento. Reverter = voltar os chamadores.

---

## Privacidade (LGPD)

A fila **nunca** guarda e-mail ou telefone em claro. `user_data_hash` recebe o
SHA-256 que a Meta receberia, e o retry usa o hash — o original não é
necessário depois. `match_keys` registra *quais* chaves existiam (`em`, `ph`,
`fn`, `ln`) para medir qualidade de correspondência sem expor ninguém.

`meta_capi_events` tem RLS **sem policy**: só service role alcança. O painel lê
pelo Railway, que devolve agregado e linhas sem dado pessoal.

`external_id` (o UUID do lead) entra no hash porque ajuda a Meta a deduplicar,
mas fica **fora** de `match_keys`: é id do nosso CRM, que a Meta não conhece, e
não pode contar como identificação de pessoa na hora de decidir se vale enviar.

---

## Regras de negócio

**Só desfecho positivo vira evento.** `Purchase` no fechamento; `Lead` na
entrada; `CompleteRegistration` na qualificação. Desfecho negativo
(`refused`/`inviavel`/`cancelled`) **não** gera evento: ensinar a Meta a buscar
mais gente parecida com quem foi recusado é o oposto do que se quer. O
`auto-enrich-lead` fazia exatamente isso e foi corrigido.

**Fechar lead tem ponto único: `registrarFechamentoDeLead`.** Fechar acontece
em várias telas — arrastar o card para ✅ Fechado, o menu "marcar como fechado",
salvar a ficha com o desfecho — e cada uma grava `lead_status` do seu jeito.
Todas chamam a mesma função de `src/services/metaCapiQueue.ts`; nenhuma monta
evento na mão. O teste `src/services/__tests__/fechamento-enfileira-conversao.test.ts`
cobra isso: arquivo que grava `lead_status: 'closed'` ou chama a função, ou
explica por que não com um comentário `capi:sem-conversao`.

**Lead sem e-mail nem telefone não é enviado** — vira `skipped` com o motivo
registrado. Não é perda: é o buraco virando número no painel.

**Valor tem procedência.** `valor_origem` diz de onde saiu:

| valor_origem | significado |
|---|---|
| `informado` | valor digitado no fechamento ou `leads.conversion_value` |
| `faixa_produto` | média de `products_services.price_range_min/max` (cobre 71% dos fechados) |
| `padrao` | `META_CAPI_VALOR_PADRAO` do ambiente |
| `ausente` | sem valor |

O painel nunca mostra estimativa como se fosse receita apurada.

**Idempotência em duas camadas:** `event_id = "<lead_id>:<evento>"` é UNIQUE na
fila (enfileirar 2x grava 1 linha) e é a chave de dedup da própria Meta. Os dois
funis (Kanban `closed` e Pipeline `converted`) podem disparar o mesmo
fechamento sem cobrar duas vezes.

**Janela de 7 dias:** a Meta rejeita evento mais velho que isso. Fila parada
traria data vencida, então o despachante gruda o `event_time` no limite em vez
de perder o evento.

---

## Configuração

Variáveis no **Railway**:

| Variável | O que é |
|---|---|
| `META_CAPI_ACCESS_TOKEN` | token da CAPI (Gerenciador de Eventos → Configurações → Gerar token) |
| `META_CAPI_DATASET_ID` | id do conjunto de dados — hoje **`28837100409207964`** ("Conversões CRM — Casos Fechados"), ver seção abaixo |
| `META_CAPI_VALOR_PADRAO` | opcional; fallback quando não há valor nem faixa |

Aceita também os nomes antigos (`FACEBOOK_CAPI_ACCESS_TOKEN`,
`FACEBOOK_PIXEL_ID`) como fallback. **`META_CAPI_DATASET_ID` tem precedência**:
quem editar o legado achando que trocou o destino não troca nada, e a falha é
calada. `/health` → `meta_dataset` mostra o id em uso **e de qual variável ele
veio**, justamente para essa dúvida não depender de leitura de código.

O `auto-enrich-lead` (edge do Externo) precisa de `RAILWAY_API_KEY` para
enfileirar; sem ela, registra aviso no log em vez de falhar calado. **Criada em
03/09/2026** (34 secrets no projeto) e a edge foi publicada na **versão 44** —
deploy multi-arquivo, porque ela importa `_shared/gemini.ts`. Rollback pelo git
(`c46520106`), não pelo `/body`, que devolve ESZIP binário. Script:
`_deploy_auto_enrich_lead.mjs` (local, o `.gitignore` cobre `_deploy_*.mjs`).

> **Frente de segurança aberta, anterior a esta entrega.** A `auto-enrich-lead`
> roda com `verify_jwt: false` e **não tem gate de autenticação no código**,
> usando `SERVICE_ROLE_KEY`. O parâmetro `apply_fields` grava os campos recebidos
> no `lead_id` que vem do corpo, então quem tem a anon key (pública, está no
> bundle) sobrescreve campo de qualquer lead e gasta token de IA. Consertar exige
> mapear antes os chamadores legítimos (webhook, front, ZapSign) — pôr trava sem
> isso quebra o enriquecimento. Mesmo padrão já catalogado no
> `create-whatsapp-group`.

> **Trocar de portfólio empresarial invalida o pixel.** O pixel
> `4333420420303120` vivia na BM "Mais esperto que a Dor". Com a mudança para o
> portfólio **WhatsJudd** (contas Matern Prev 3 e MATERN PREV 2), é preciso
> conjunto de dados e token novos, de dentro do WhatsJudd.

---

## Diagnóstico

**A credencial está viva?** Painel → *Verificar credencial*, ou:

```
POST /functions/meta-capi-dispatch  { "modo": "probe" }
```

Distingue os dois modos de morte: token inválido (`code 190`) e token válido
**sem acesso ao conjunto de dados** (o `subcode 33` que custou caro em julho —
acesso à conta de anúncios não é acesso ao pixel; atribui-se no painel da Meta
em Usuários do sistema → Adicionar ativos → Fontes de dados).

**O que sairia agora, sem enviar:**

```
POST /functions/meta-capi-dispatch  { "dry_run": true }
```

**Qual pixel as campanhas usam de verdade:**

```
POST /functions/meta-capi-dispatch  { "modo": "inventario" }
```

Lê os conjuntos de anúncios ativos das contas atribuídas ao token e agrupa por
`pixel_id`. É o detector da próxima troca de pixel ou portfólio — sem ele, a
fila alimenta dataset órfão sem ninguém notar. `{ "modo": "probe",
"dataset_id": "..." }` sonda um candidato sem trocar env var nem sobrescrever o
status oficial.

**Enviar sem sujar a otimização:** `{ "test_event_code": "TESTxxxxx" }` — aparece
em Gerenciador de Eventos → Testar eventos e não entra na otimização.

**Erro sem volta congela a linha** em vez de queimar tentativas: credencial
inválida (`190`/`200`/`803`) e recusa de conteúdo (400 com erro da Meta, ex.
subcode `2804009` — *Purchase sem value*) esgotam `tentativas` e gravam o motivo
em `motivo_skip`. Depois de corrigir a causa:

```
POST /functions/meta-capi-dispatch  { "modo": "religar" }
```

> Corrigido em 03/09/2026: antes o congelamento setava `proxima_tentativa_em =
> null`, mas o filtro da fila trata `null` como **elegível** (é o estado de quem
> acabou de entrar) — então a linha voltava na rodada seguinte, o oposto do que
> esta seção dizia. Congelar é esgotar `tentativas`, que é o que
> `.lt('tentativas', MAX_TENTATIVAS)` exclui.

**`Purchase` exige `value`.** Medido contra a Meta em 03/09/2026: evento sem
`value` recebe `400` / `2804009` / *"Missing Value for Purchase Event"*. Não é
degradação da otimização, é recusa — o evento não entra.

---

## Qual conjunto de dados recebe

**Hoje: `28837100409207964` — "Conversões CRM — Casos Fechados".** Criado em
09/09/2026 20:53 dentro do portfólio WhatsJudd, exclusivo para o CRM. Conferido
ao vivo em 14/09 com `{ "modo": "dono_do_dataset" }`: só recebe `Purchase`, e só
o nosso — 49 em 09/09, 1 em 10/09, 4 em 11/09, 2 em 14/09.

Chegar nele custou um erro que vale documentar inteiro.

### O primeiro alvo era o pixel do checkout de um curso (09/09/2026)

Em 03/09 o alvo escolhido foi `1782109342966504`. O método parecia sólido: não
decidir pelo nome, e sim pelo `promoted_object.pixel_id` dos conjuntos de
anúncios *ativos*, levantado com `{ "modo": "inventario" }`. Ele pertencia ao
Business WhatsJudd, o mesmo dono das contas de anúncio, e era o único pixel com
campanha ativa otimizando `PURCHASE`.

Em 09/09 mandamos 39 conversões para lá. **Era o pixel de site do checkout de um
curso.** Os eventos denunciavam, e ninguém os tinha listado:

```
teste_integração_cakto_facebook · InitiateCheckout · PageView · pix · Purchase
08/09 20:46 → Purchase: 17, PageView: 12   (nada nosso nesse dia)
```

O `Purchase` do curso e o `Purchase` de caso fechado dividiam o mesmo balde.
Otimizar por ele faria a Meta procurar uma mistura de quem compra curso com quem
fecha contrato.

**A regra que ficou: "pertence ao negócio certo" ≠ "é o ativo certo".** Antes de
apontar conversão para um dataset, **listar os eventos dele** —
`GET /{dataset_id}/stats?aggregation=event`, hoje embutido em
`{ "modo": "dono_do_dataset" }`. Estava a uma chamada de distância o dia inteiro.
O `last_fired_time` também entregava: marcava um dia em que o CRM não enviara
nada.

Dois estragos colaterais do mesmo episódio:

- **Renomear ativo compartilhado não é cosmético.** O pixel do curso chegou a ser
  renomeado para "Conversões CRM" a pedido, e outra equipe dependia daquele nome.
  Foi devolvido ao original.
- As 39 conversões já aceitas ficaram no dataset errado. Daí o
  `{ "modo": "reenviar" }`: a Meta deduplica por `event_id` **dentro de cada
  dataset**, então a mesma conversão reenviada ao dataset novo não duplica.
  Respeita a janela de 7 dias.

`1782109342966504` — pixel do curso. **Não usar.**

### Nenhuma campanha ativa usa pixel — medido em 14/09/2026

O método de 03/09 (olhar `promoted_object.pixel_id` dos conjuntos ativos) **não
decide mais nada**, e isso precisa estar escrito para não se perder tempo
rodando o inventário à espera de uma resposta que ele não dá mais:

| Conta | Conjuntos | Ativos | Ativos com pixel |
|---|---|---|---|
| Matern Prev 3 (`act_2459028114566447`) | 66 | 6 | **0** |
| MATERN PREV 2 (`act_1473452273941428`) | 23 | 2 | **0** |

`uso_por_dataset: {}` — vazio. Os 8 conjuntos ativos são todos `ON_AD`
(formulário dentro do anúncio, não no site):

```
Matern Prev 3   ->  LEAD_GENERATION x 3  +  QUALITY_LEAD x 1  +  PROFILE_VISIT x 2
MATERN PREV 2   ->  LEAD_GENERATION x 1  +  QUALITY_LEAD x 1
```

`LEAD_GENERATION` otimiza por volume de lead e não consome evento de site.
`QUALITY_LEAD` é a otimização **Conversion Leads**, que *espera* receber os
estágios do funil do CRM de volta — é ela que consome o que esta integração
manda, e desde 10/09 há dois conjuntos nela.

**A ligação entre o dataset e a campanha não é o `promoted_object`.** Anexar
`pixel_id` ali devolve `Promoted Object Invalid` (subcode 1885014) — o
`promoted_object` fica só com a página. A ligação vive no nível do negócio, na
configuração de Conversion Leads. Consequência prática: **não existe inventário
que prove que o dataset está certo**; o que prova é o conteúdo dele
(`dono_do_dataset`) mais os conjuntos em `QUALITY_LEAD` (`modo: 'conjuntos'`).

### Valor da conversão — decidido em 03/09/2026

`Purchase` **exige** `value` (a Meta recusa com `400`/`2804009`), então o valor
deixou de ser opcional. Honorário médio que o escritório recebe, gravado em
`products_services.price_range_min/max` — a coluna que a tela do app rotula
"Preço Mín/Máx (R$)", lida só pelo `ProductFormDialog`:

| Produto | ID | Faixa | Valor enviado | Fechados |
|---|---|---|---|---|
| BPC/LOAS Autista | `a1000003…` | 12.000–30.000 | **21.000** | 905 |
| Salário Maternidade | `a1000001…` | 1.945 | 1.945 | 883 |
| Indenização por Acidente de Trabalho | `a1000004…` | 250.000 | 250.000 | 379 |
| Auxílio Acidente | `a1000002…` | 27.500 | 27.500 | 73 |

O BPC usa faixa porque **o banco não sabe separar judicial (30.000) de
administrativo (12.000)**: `case_type` tem 570 de 905 nulos e é texto livre sem
menção a esfera; `legal_cases` × `inss_admin_processes` não é partição (184 leads
têm os dois, que é o caminho normal ADM→JUD); `assigned_to_judicial` está
preenchido em 44 de 905. A média de min/max resolve sem fingir precisão. Para
enviar o valor certo por caso seria preciso primeiro marcar a esfera no CRM.

`conversion_value` do lead tem prioridade sobre a faixa, e `valor_origem`
distingue `informado` de `faixa_produto` — dá para auditar quanto do valor
reportado é real e quanto é estimativa. Hoje: **0 leads** com valor apurado.

**Fechado sem produto não vai à rede.** 536 fechados têm contato mas nenhum
valor; o enqueue os grava `skipped` com o motivo apontando o conserto (produto no
lead, ou preço no cadastro do produto) em vez de deixar a Meta recusar.

---

### Cobertura da fila (03/09/2026)

- fechados vivos: **3.165**
- com telefone ou e-mail (correspondência possível): **2.118 (67%)**
- os outros 1.047 viram `skipped` com motivo no painel, em vez de serem enviados
  e descartados calados pela Meta, como antes

### O gatilho estava furado — medido e corrigido em 04/09/2026

A fila funcionava; o que quase não chegava nela era evento. Entre 03/09 e 04/09
houve **84 fechamentos no CRM e 3 eventos**. Motivo, por caminho:

| Onde se fecha um lead | Antes | Agora |
|---|---|---|
| Arrastar o card para ✅ Fechado | não enfileirava | `registrarFechamentoDeLead` |
| Menu "marcar como fechado" | não enfileirava | `registrarFechamentoDeLead` |
| `useLeads.updateLead` | observava `status === 'converted'` | observa `lead_status === 'closed'` |
| Salvar a ficha com o desfecho | enfileirava | `registrarFechamentoDeLead` |

O terceiro é o mais instrutivo: o `if` observava uma **etapa de funil** chamada
`converted`, que não existe em board nenhum. No banco: 0 leads em `converted`,
3 em `qualified`, **1.491 em `closed`**. Nunca rodou, em nenhum momento.

`CompleteRegistration` ficou de propósito sem gatilho: não existe estado de
"qualificado" no lead, e inventar um mandaria evento por gente que ainda não é
cliente.

Efeito colateral esperado ao ligar: dos 3.173 fechados, **928 (29%) não têm
produto**, logo não têm valor, e `Purchase` sem `value` é recusado pela Meta
(subcode 2804009). Esses aparecem na fila com o motivo à vista. O conserto é
preencher o produto no lead — não inventar valor no código.

### O caminho antigo saiu (04/09/2026)

`src/utils/metaConversionTracking.ts` chamava a edge `facebook-capi`, do app da
Meta apagado em 31/07/2026, e engolia todo erro num `console.error`. Ficou mais
de um mês "enviando" para lugar nenhum. As três chamadas em `LeadEditDialog`
foram removidas; o arquivo continua no repo marcado como morto.

Ele também mapeava errado: `refused`, `inviavel` e `cancelled` viravam evento
`Lead`, que a Meta conta como **conversão**. Se tivesse funcionado, estaria
ensinando a Meta a buscar mais gente parecida com quem o escritório recusou.
Sinal negativo de qualidade precisa de outro mecanismo, não deste.

---

## O gatilho da tela não bastava — medido em 04/09/2026

Depois de ligar a conversão nos caminhos da interface, a fila continuou vazia:
**69 leads fechados em 7 dias, ZERO eventos**. A causa não era o gatilho estar
errado, era estar no lugar errado.

Quem fecha lead nesta operação é **backend**, não tela:

| Caminho | Arquivo |
|---|---|
| Etiqueta do WhatsApp | `railway-server/src/functions/whatsapp-webhook.ts:957` |
| Assinatura da procuração | `railway-server/src/functions/zapsign-webhook.ts:347` |
| Checkpoint de onboarding | `railway-server/src/functions/onboarding-checkpoint-execute.ts:503` |
| Sync do funil por planilha | `railway-server/src/functions/sync-funnel-status-from-sheet.ts:300` |

O teste-guarda de fechamento (`src/services/__tests__/`) varria só `src/` — era
estruturalmente cego para `railway-server/` e `supabase/functions/`, que é
justamente onde o volume mora.

### A saída foi não perguntar quem fechou

`meta-capi-reconcile` pergunta outra coisa: **"existe lead fechado dentro da
janela da Meta sem evento de Purchase?"** Se existe, enfileira. Isso cobre os
quatro caminhos de hoje, o quinto que alguém criar amanhã, e fechamento feito
por SQL na mão — sem precisar tocar em nenhum deles.

É seguro rodar junto com o gatilho da tela porque `meta-capi-enqueue` faz upsert
com `onConflict: event_id, ignoreDuplicates`: quem já foi enfileirado volta como
`ja_existia`. Cron a cada 15 min, janela de 7 dias (o `event_time` do evento é o
`became_client_date`, e a Meta descarta evento mais velho que isso).

Estado observável em `/health` → `capi_reconcile`.

### Primeira execução real (04/09/2026, 20:02)

```
fechados_na_janela: 69   sem_evento: 69
enfileirados: 12   ignorados: 57   erros: 0
resultado na fila: status=sent, http=200, events_received=12
```

Primeira conversão entregue à Meta desde 31/07/2026.

**Os 57 ignorados não são falha do envio.** São leads fechados sem telefone nem
e-mail — a Meta descartaria. O recorte por origem explica: 59 dos 69 vieram de
`whatsapp` (orgânico) e só 3 desses têm contato; os **9 de origem paga têm
contato em 9/9**. Para o propósito da CAPI, que é atribuir conversão de anúncio,
a cobertura é boa; o buraco eram os eventos nunca enfileirados.

### `became_client_date` é a auditoria de fechamento

3.150 de 3.182 fechados têm a data. `converted_at` existe na tabela e **nunca foi
escrita** (0 de 3.182) — não usar. `closed_at` **não existe**, e
`zapsign-webhook.ts:347` tenta gravá-la ao criar lead órfão de assinatura: o
PostgREST recusa o insert inteiro, e por isso há **0 leads com
`source='zapsign_manual'`**. Esse caminho nunca funcionou.

## O que ficou de fora

- **Backfill dos fechados anteriores.** A Meta só usa ~7 dias para otimização,
  então reenviar meses de histórico não melhora entrega — serve no máximo para
  relatório. Decisão adiada de propósito.
- **`meta_ad_accounts` com token morto** (`code 190, subcode 467 — user logged
  out`). É outra integração (leitura de campanhas), fora do escopo desta.
- **Backfill do *Meta Lead ID* nos leads antigos.** O import passou a gravar o
  id, mas quem entrou antes segue sem ele — possível pela planilha de Lead Ads,
  não feito.
- **CTWA / `business_messaging`.** Morto de fato: 400 leads com `ctwa_context` e
  **zero** com `ctwa_clid` preenchido, o mais recente de 28/04/2026. Os leads
  vêm de formulário (Lead Ads), então o caminho é Pixel/CAPI. `meta_capi_config`
  nem existe no Externo e `waba_id` é nulo na única conta.

---

## Conversion Leads: o que o evento leva — ligado em 10/09/2026

`QUALITY_LEAD` é a única otimização que consome o que esta integração manda (ver
"Nenhuma campanha ativa usa pixel"). Para a Meta reconhecer o evento como vindo
de um CRM e casá-lo com o formulário que gerou o lead, o corpo precisa de três
coisas além do contato:

| Campo | Valor | Onde |
|---|---|---|
| `custom_data.event_source` | `crm` | `meta-capi-dispatch` |
| `custom_data.lead_event_source` | `WhatsJud` (`META_CAPI_LEAD_SOURCE`) | `meta-capi-dispatch` |
| `user_data.lead_id` | o *Meta Lead ID*, **em claro** | `metaCapiNormalize` |

**Sem `event_source`/`lead_event_source` a Meta ACEITA o evento assim mesmo** —
`http 200`, contador subindo, e nada acontecendo do lado da otimização. É o
mesmo modo de falha do dataset errado: sucesso aparente.

O `lead_id` é a única chave que vai **sem hash**, de propósito: é um id que a
própria Meta emitiu e só ela sabe ligar a uma pessoa. Só entra se casar
`/^[0-9]{15,17}$/` — id fora desse formato é lixo de importação e seria
descartado do outro lado.

**Estado em 14/09/2026:** `leads.facebook_lead_id` saiu de **0 em 19.420** (04/09)
para **4.168 preenchidos**, e **30 dos últimos 32 eventos enviados** carregam o
id. A origem do dado é o import de Lead Ads — ver `docs/sistema/planilhas-lead-ads.md`
e `docs/sistema/meta-leads-direto.md`. Documentação da Meta:
`conversions-api/conversion-leads-integration`.

Trocar o `optimization_goal` do conjunto é ação na Meta, feita pela API com
`{ "modo": "trocar_otimizacao" }` — que devolve o comando inverso no campo
`rollback`. **Os dois JSON diferem em uma palavra**, e rodar o errado por engano
é o modo de falha esperado deste caminho: em 10/09 o de rollback foi executado
duas vezes e gerou o diagnóstico errado de que a Meta teria desfeito o piloto
sozinha.

---

## Quem mexeu no conjunto — auditoria a partir de 11/09/2026

`updated_time` só diz que **algo** mudou. Não diz o quê, nem por ordem de quem —
e num piloto de otimização isso é a diferença entre "a Meta desfez" e "alguém
rodou o comando de volta". O log de atividades da Meta é a única fonte que
carrega o autor:

```
POST /functions/meta-capi-dispatch  { "modo": "historico_conjunto", "adset_id": "...", "dias": 7 }
```

Lê o log do conjunto **e** o da conta (alguns eventos só aparecem no da conta),
junta sem repetir, converte a hora — a Meta devolve no fuso da conta — e traz
`de → para` por evento. `modo: 'conjunto'` passou a trazer junto o orçamento
diário e os posicionamentos, que mudam a entrega sem mudar a otimização.

**Dois atores aparecem no log, e eles não se confundem:**

| Autor | Quem é |
|---|---|
| `WhatsJud Backend` | nossos comandos via API (o usuário do sistema) |
| nome de pessoa | alteração feita à mão no Gerenciador de Anúncios |

### O que a auditoria corrigiu sobre o piloto

A leitura de 10/09 foi de que o piloto "voltou sozinho" para `LEAD_GENERATION`
dois minutos depois de ligado. **Não voltou sozinho.** O log mostra a sequência
inteira, toda ela com autor `WhatsJud Backend`:

```
10/09 14:54:43   Leads → Conversion leads          (a troca)
10/09 14:57:21   Conversion leads → Leads          (o comando de rollback, rodado de novo)
10/09 14:59:11   Leads → Conversion leads          (a troca, agora de vez)
```

O comando de reversão e o de troca são quase idênticos — muda uma palavra no
JSON. Rodar o errado por engano é o modo de falha esperado deste caminho, não um
comportamento da plataforma.

### Orçamento nivelado em 11/09

Entre 08:17 e 08:26 de 11/09, **Luiz Ricardo** (à mão, no Gerenciador) baixou
cinco dos seis conjuntos ativos para **R$ 70,00/dia**: 300→70, 300→70, 180→70
(o do piloto), 150→70 e 180→70. O sexto (`CONJUNTO 4 KAROL — Cópia`) ficou em
R$ 10,00/dia desde 10/09.

Isso **ajuda** a comparação do piloto — piloto e controle passam a gastar o
mesmo —, mas o `CONJUNTO - KAROLYNE` levou dois choques em dois dias: troca de
otimização (que zera o aprendizado) e corte de 61% do orçamento. Os primeiros
dias de custo por lead dele não medem a otimização; medem o reinício.

### O posicionamento mexeu junto com a otimização

No mesmo segundo da troca (10/09 14:54:43), a Meta registrou um
`update_ad_set_target_spec` no conjunto: saiu *Lead Gen Multi Submit Ads on
Instagram* dos posicionamentos. Ninguém pediu — veio junto com `QUALITY_LEAD`.

Conferido em 11/09: **piloto e controle têm hoje a mesma lista** —
`facebook: feed, story, facebook_reels, profile_feed` e `instagram: stream,
story, reels, profile_feed`. Então a comparação não está enviesada por
posicionamento. Fica o registro de que trocar a otimização pode mexer no
targeting sem aviso: conferir os dois lados depois de cada troca.

## Piloto de Leads com Conversão: leitura de 14/09/2026

Dois conjuntos em `QUALITY_LEAD`, e eles estão em **campanhas diferentes** — o
que invalida a comparação direta entre eles:

| Campanha | Conjunto | Gasto 5d | Leads | CPL | Fech |
|---|---|---:|---:|---:|---:|
| BPC-LOAS | **CONJUNTO 7 - TAFFAREL** (piloto) | R$ 369,40 | 54 | **R$ 6,84** | 0 |
| BPC-LOAS | CONJUNTO 6 - MATEUS | R$ 511,02 | 94 | R$ 5,44 | 1 |
| BPC-LOAS | CONJUNTO 3 - ISRAEL | R$ 461,82 | 62 | R$ 7,45 | 1 |
| BPC-LOAS | CONJUNTO 4 KAROL | R$ 319,15 | 52 | R$ 6,14 | 0 |
| [AUXÍLIO-ACIDENTE] | **CONJUNTO - KAROLYNE** (piloto) | R$ 289,49 | 24 | **R$ 12,06** | 0 |
| [AUXÍLIO-ACIDENTE] | CONJUNTO - [MATEUS] | R$ 251,14 | 17 | R$ 14,77 | 0 |

**Lead de Auxílio Acidente custa cerca do dobro do de BPC.** Comparar a KAROLYNE
(R$ 12,06) com os conjuntos de BPC (R$ 5–7) é comparar produtos diferentes — foi
o erro da primeira leitura, em 11/09. Dentro da própria campanha, ela está **mais
barata** que o único controle.

### Por que ainda não dá para concluir

**Não existe "antes".** Os dois conjuntos gastaram **R$ 0** no período anterior à
troca (05–09/09): são conjuntos novos, não conjuntos que mudaram de otimização.
Não há comparação antes/depois, e CPL de conjunto em aprendizado não se compara
com o de conjunto maduro.

**Fechamento não tem amostra.** Zero nos pilotos, 2 nos controles em 5 dias. E o
que o piloto existe para melhorar é justamente fechamento, não CPL.

**A medição válida começa agora**, e por um motivo concreto: até 14/09 o funil de
Auxílio Acidente não reportava fechamento nenhum ao CRM (a coluna de status tinha
outro nome e nunca era lida). O piloto da KAROLYNE está nesse funil — antes de
hoje, ele era impossível de avaliar pelo critério que importa.

---

## Estado da fila — medido em 14/09/2026

Credencial viva (`token_valido: true`, probe 16:18, último sucesso 14:28).
Deploy no ar: `4e417cfce`. `meta_capi_events` desde 02/09:

| status | linhas |
|---|---:|
| `sent` | 46 |
| `skipped` | 124 |
| `failed` | 1 |

O único `failed` é de 03/09, origem `manual`, congelado com *Missing Value for
Purchase Event* — anterior à barreira de valor no enqueue, que passou a
transformar esse caso em `skipped` com o conserto escrito.

**Quem alimenta a fila é o reconciliador, não a tela:**

| origem | linhas |
|---|---:|
| `reconcile` | 156 |
| `pipeline` | 11 |
| `manual` | 3 |
| `kanban` | 1 |

Isso confirma o diagnóstico de 04/09 em vez de contrariá-lo: fechamento nesta
operação é evento de backend. Os gatilhos de tela ficam como rede de segurança e
para o caso em que alguém fecha pela interface — não são o caminho principal.

### Cobertura na janela de 7 dias (07→14/09)

| | leads |
|---|---:|
| fechados (`lead_status=closed`, `became_client_date` na janela) | **79** |
| com telefone ou e-mail (correspondência possível) | 30 (38%) |
| com produto (logo, com valor) | **78 (99%)** |
| com `conversion_value > 0` (valor apurado) | **0** |
| de origem paga | 28 — **28/28 com contato** |

Duas leituras que não se confundem:

- **O valor deixou de ser o gargalo.** Em 04/09, 29% dos fechados não tinham
  produto e por isso nem podiam virar `Purchase`. Agora são 1%.
- **O contato é o gargalo, e ele é do funil orgânico.** Os 49 fechados sem
  contato são quase todos `whatsapp`; os 28 de origem paga têm contato em 28/28.
  Como a CAPI existe para atribuir conversão **de anúncio**, a cobertura no que
  importa é integral. Os `skipped` restantes medem a qualidade do cadastro
  orgânico, não uma falha do envio.

`/health` → `capi_reconcile` fecha a conta: `fechados=79 sem_evento=0`. Não há
fechamento na janela sem linha na fila.

### Todo valor enviado é estimativa

Os 46 eventos somam **R$ 979.890**, e **100% deles têm `valor_origem =
faixa_produto`**. `conversion_value` continua em 0 de 3.269 fechados vivos —
nunca foi preenchido por ninguém. Nenhum retorno calculado a partir daí é receita
apurada, e é para isso que a coluna `valor_origem` existe. Enquanto o fechamento
não gravar valor real, a Meta otimiza por uma média de faixa de honorário.

### E-mail nunca entrou como chave de correspondência

Das 171 linhas da fila, **`com_email = 0` em todas**. As chaves usadas:

```
["fn","ln"]        114   (só nome — não identifica, vira skipped)
["ph","fn","ln"]    43
["fn"]              10
["ph","fn"]          3
["ph"]               1
```

Telefone e nome carregam a integração inteira. E-mail é a segunda chave de maior
peso na correspondência da Meta e está 100% ausente — vale medir quantos fechados
têm `lead_email` preenchido antes de concluir se o buraco é de cadastro ou de
leitura.

### O endpoint devolvia o próprio token — corrigido em 14/09/2026

`{ "modo": "dono_do_dataset" }` devolvia a resposta crua da Graph API, e as URLs
de paginação **que a Meta monta** (`paging.next` / `paging.previous`) embutem o
`access_token` em claro. Quem chamasse o endpoint — com `x-api-key`, portanto já
autenticado — recebia o token da CAPI de volta no corpo, e qualquer log dessa
resposta o persistia. Medido nos 6 modos antes do conserto: só o
`dono_do_dataset` vazava, porque era o único que repassava `paging`.

O conserto **não** foi limpar `paging` naquele modo. São 25 saídas HTTP no
`meta-capi-dispatch`, e o modo 26 nasceria vazando igual — foi exatamente assim
que este defeito apareceu. `railway-server/src/lib/semSegredo.ts` (puro, com
teste) limpa credencial de qualquer estrutura, e o handler passa **toda** saída
por ele:

```ts
const jsonCru = res.json.bind(res);
res.json = (corpo: unknown) => jsonCru(semSegredo(corpo));
```

Quem escrever um modo novo fica coberto sem precisar saber que isso existe.

O que o filtro preserva de propósito: o resto da URL de paginação (saber qual
borda foi chamada, e com que cursor, é o que torna o diagnóstico útil) e
booleanos derivados como `tem_token_de_pagina`, que são informação e não segredo.
O uso **interno** do token de página continua intacto — `me/accounts` devolve um
token por página e ele é necessário para ler `leadgen_forms`; a limpeza acontece
na saída, não na leitura.

> Isto é rede de segurança, não substituto de minimização: o certo continua
> sendo não colocar segredo no corpo. Serve para o caso em que o segredo vem de
> fora — a própria Meta devolvendo o token dela — e ninguém reparou.

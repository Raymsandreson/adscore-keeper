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
Kanban / Pipeline / Planilha / auto-enrich
        │  (só lead_id — PII não trafega)
        ▼
  meta-capi-enqueue (Railway, service role)
        │  resolve contato, hasheia, resolve valor
        ▼
  meta_capi_events  ← fila e log, no Externo
        │
        ▼  cron 5 min
  meta-capi-dispatch (Railway) ──► Graph API v25.0
        │
        ▼  carimba resultado, fbtrace_id, erro da Meta
  meta_capi_status  ← saúde da credencial (probe de hora em hora)
        │
        ▼
  Configurações → Conversões  (painel)
```

**Enfileirar não é enviar.** Fechar um lead grava uma linha e volta na hora; a
Meta nunca segura o salvamento, e falha da Meta nunca some.

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
| `railway-server/src/functions/meta-capi-dispatch.ts` | drena a fila; modo `probe`; `dry_run` |
| `railway-server/src/functions/meta-capi-status.ts` | leitura do painel |
| `src/services/metaCapiQueue.ts` | `enfileiraConversao()` — o que o front chama |
| `src/components/settings/MetaCapiPanel.tsx` | painel (Configurações → Conversões) |

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

**Lead sem e-mail nem telefone não é enviado** — vira `skipped` com o motivo
registrado. Não é perda: é o buraco virando número no painel.

**Valor tem procedência.** `valor_origem` diz de onde saiu:

| valor_origem | significado |
|---|---|
| `informado` | valor digitado no fechamento ou `leads.conversion_value` |
| `faixa_produto` | média de `products_services.price_range_min/max` (cobre 77% dos fechados) |
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
| `META_CAPI_DATASET_ID` | id do conjunto de dados/pixel — hoje `1782109342966504`, ver seção abaixo |
| `META_CAPI_VALOR_PADRAO` | opcional; fallback quando não há valor nem faixa |

Aceita também os nomes antigos (`FACEBOOK_CAPI_ACCESS_TOKEN`,
`FACEBOOK_PIXEL_ID`) como fallback.

O `auto-enrich-lead` (edge do Externo) precisa de `RAILWAY_API_KEY` para
enfileirar; sem ela, registra aviso no log em vez de falhar calado.

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

## Qual conjunto de dados recebe — medido em 03/09/2026

Havia dois candidatos no portfólio WhatsJudd, ambos recebendo Pixel + CAPI e
ambos acessíveis pelo token. **O nome não decide**: quem decide é o
`promoted_object.pixel_id` dos conjuntos de anúncios *ativos*. Levantado com
`{ "modo": "inventario" }`:

| Conta | Conjuntos | Ativos | Ativos com pixel |
|---|---|---|---|
| Matern Prev 3 (`act_2459028114566447`) | 57 | 5 | **1** |
| MATERN PREV 2 (`act_1473452273941428`) | 19 | 4 | **0** |

```
1782109342966504  (COMPRA GUIA MÃES ATÍPICAS)  -> 1 anúncio, Matern Prev 3, PURCHASE
1570540998104531  (NOVO PIXEL GUIA MÃES ATÍPICAS) -> nenhuma campanha ativa
```

Logo o alvo é **`1782109342966504`**, e não o "NOVO PIXEL" que o nome sugeria —
apontar para o outro seria alimentar dataset órfão: eventos entrando, painel
verde, zero efeito em campanha. O evento que aquele conjunto otimiza (`PURCHASE`)
é justamente o que o fechamento de lead dispara aqui.

### O alcance real é 1 conjunto de anúncios, não 9

Os outros 8 conjuntos ativos **não usam pixel**, e isso não é defeito:

```
Matern Prev 3  ->  LEAD_GENERATION x 4
MATERN PREV 2  ->  LEAD_GENERATION x 3  +  QUALITY_LEAD x 1
```

`LEAD_GENERATION` otimiza por volume de lead e não consome evento de site.
`QUALITY_LEAD` é a otimização **Conversion Leads**, que *espera* receber os
estágios do funil do CRM de volta — e nunca recebeu nada nosso.

### Cobertura da fila (03/09/2026)

- fechados vivos: **3.165**
- com telefone ou e-mail (correspondência possível): **2.118 (67%)**
- os outros 1.047 viram `skipped` com motivo no painel, em vez de serem enviados
  e descartados calados pela Meta, como antes

---

## O que ficou de fora

- **Backfill dos fechados anteriores.** A Meta só usa ~7 dias para otimização,
  então reenviar meses de histórico não melhora entrega — serve no máximo para
  relatório. Decisão adiada de propósito.
- **`meta_ad_accounts` com token morto** (`code 190, subcode 467 — user logged
  out`). É outra integração (leitura de campanhas), fora do escopo desta.
- **Conversion Leads (`QUALITY_LEAD`).** Frente real, não viável hoje: a Meta
  pede o *Meta Lead ID* de 15-17 dígitos guardado no CRM (telefone/e-mail como
  alternativa), e a coluna `leads.facebook_lead_id` existe com **0 preenchidos em
  23.426**; `adset_id` também zerado, `campaign_id` tem 714 e secou em
  11/05/2026. Para destravar seria preciso capturar o `leadgen_id` do webhook de
  Lead Ads na entrada. Só depois faz sentido mandar estágio de funil.
  Documentação: `conversions-api/conversion-leads-integration`.
- **CTWA / `business_messaging`.** Morto de fato: 400 leads com `ctwa_context` e
  **zero** com `ctwa_clid` preenchido, o mais recente de 28/04/2026. Os leads
  vêm de formulário (Lead Ads), então o caminho é Pixel/CAPI. `meta_capi_config`
  nem existe no Externo e `waba_id` é nulo na única conta.

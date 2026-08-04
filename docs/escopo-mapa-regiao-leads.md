# Escopo — Mapa de região do lead e distância até a base mais próxima

**Status**: **Fases 1 e 2 entregues** em 04/08/2026 (`src/lib/geo/` + miniatura no kanban e na lista, 95 testes). Fases 3 e 4 pendentes. Levantamento feito em 04/08/2026 contra o Supabase Externo `kmedldlepwiityjsdahz`.

**Resumo em uma frase**: dado um lead com cidade/UF (ex.: Piauí), exibir a silhueta do estado com o município destacado, calcular a distância até a capital ou base mais próxima e enquadrar a pré-visualização em **um** estado quando a capital mais próxima é a do próprio estado, ou em **dois** quando a mais próxima é de outro estado.

---

## 1. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Métrica de distância | Haversine (linha reta) sempre, calculado local e grátis; rota rodoviária real só sob demanda, por botão, com resultado gravado em cache |
| Alvos da comparação | As 27 capitais **+ bases/escritórios nossos** (cadastro novo) |
| Onde vive | Aba "Local" da ficha do lead (`LeadEditDialog`) e miniatura no card do kanban/lista |
| Fora do escopo agora | A página `/mapa-leads` (ver §9) |

---

## 2. Estado atual — o que já existe e o que está quebrado

### 2.1 A página de mapa existente está morta

`src/pages/LeadsMapPage.tsx:74` consulta `lead_city` e `lead_state`. **Essas colunas não existem** na tabela `leads`; os nomes corretos são `city` e `state`. Confirmado com request real ao PostgREST:

```
HTTP 400 — {"code":"42703","message":"column leads.lead_city does not exist"}
```

Como o `catch` da página faz `setLeads([])`, a tela sempre mostra "0 de 0 leads" sem erro visível. `docs/sistema/leads-crm.md:117` documenta essa página como se funcionasse. Não é o alvo deste escopo, mas o helper de resolução criado aqui conserta a página com uma linha (§9).

### 2.2 Infraestrutura aproveitável

- **Leaflet + react-leaflet** já são dependências do projeto (usados na página acima).
- **Geocoding**: `supabase/functions/backfill-lead-geocode/index.ts` usa Google Geocoding via gateway Lovable (`LOVABLE_API_KEY` + `GOOGLE_MAPS_API_KEY`). Rodou **uma única vez**, em 06/06/2026, gravando 3.446 leads. Não roda para leads novos.
- **Padrão de proxy Google Maps** já montado em `supabase/functions/nearby-establishments/` e `railway-server/src/functions/nearby-establishments.ts` — é o molde para a chamada de rota rodoviária.
- **IBGE** já é usado para listas de UF/município (`src/hooks/useBrazilianLocations.ts`, `ExpenseFormPage`).
- **Campos do card são configuráveis** via `src/hooks/useCardFieldsSettings.ts` (`CardFieldsConfig`), que já tem toggles `city` e `state`. A miniatura entra como novo toggle.
- **Aba "Local" já existe**: `src/components/kanban/LeadEditDialog.tsx:3403` (`TabsContent value="location"`), com CEP/estado/cidade/endereço da visita.
- `stateToRegion` (mapa UF→região) já existe no `LeadEditDialog`.

### 2.3 Cobertura dos dados — o gargalo real

De **16.074 leads vivos**:

| Campo | Preenchidos | % |
|---|---|---|
| `state` | 6.233 | 38,8% |
| `city` | 6.095 | 37,9% |
| `city` **ou** `visit_city` | 6.380 | 39,7% |
| `lead_lat`/`lead_lng` | 3.388 | 21,1% |
| `cep` | 343 | 2,1% |

**Consequência de escopo**: a feature fica inerte para ~60% dos leads. O estado "sem localização" não é exceção — é o caso mais comum e precisa de tratamento de primeira classe (§6.1).

### 2.4 Qualidade do dado de cidade

Testei os 6.095 leads com cidade contra os 5.571 municípios do IBGE (`/api/v1/localidades/municipios`), casando por nome normalizado (sem acento, minúsculo):

| Resultado | Leads |
|---|---|
| Par UF+cidade coerente | 5.397 (96,7%) |
| UF provavelmente errada — a cidade existe, mas em outra UF | 47 |
| Não é município — bairro, sigla ou lixo | 139 |
| Cidade sem UF, nome único no país (resolvível) | 392 |
| Cidade sem UF, nome ambíguo | 49 |

Exemplos de UF errada: `MA/Colíder` (existe em MT), `PR/Parnaguá` (PI), `RR/Vilhena` (RO), `MA/Araguaína` (TO).
Exemplos de não-município: `RJ/Rio` (11x), `MG/BH` (3x), `RJ/Botafogo`, `RJ/Cidade de Deus`, `MS/Noroeste`, `SC/BR-163`.

Só **8 leads** têm `state` fora do padrão de sigla de 2 letras (`São Paulo`, `Espírito Santo`, `MG, PA`, `Não informado`). Problema pequeno, mas a normalização precisa cobrir.

**Caso especial DF**: o IBGE tem apenas *Brasília* como município do DF. Taguatinga, Ceilândia, Itapoã e Planaltina são regiões administrativas e caem como "não é município" ou "UF errada". Regra: qualquer cidade com `state = 'DF'` resolve para Brasília (5300108).

### 2.5 A regra dos dois estados — com que frequência dispara

Rodei Haversine contra as 27 capitais nos 3.371 leads que têm coordenada **e** UF:

| Situação | Leads | Enquadramento |
|---|---|---|
| Já está na capital (< 5 km) | 2.951 (87,5%) | Nem se aplica — ver §6.2 |
| Interior, capital do próprio estado é a mais próxima | 327 | **1 estado** |
| Interior, capital de outro estado é a mais próxima | 93 | **2 estados** |

Entre os leads de interior, **22,1% caem no modo de dois estados** — a regra que você pediu se justifica. Distância média no interior: 193 km.

Casos reais onde a diferença é gritante:

| Lead | Capital mais próxima | Distância | Até a capital do próprio estado |
|---|---|---|---|
| PA / Santana do Araguaia | TO — Palmas | 238 km | 900 km (Belém) |
| PA / Terra Santa | AM — Manaus | 408 km | 892 km (Belém) |
| BA / Formosa do Rio Preto | TO — Palmas | 357 km | 759 km (Salvador) |
| AM / Tabatinga | AC — Rio Branco | 680 km | 1.107 km (Manaus) |
| PA / Itaituba | AM — Manaus | 465 km | 890 km (Belém) |

**Ressalva honesta**: 61,3% de todos os leads com cidade estão na própria capital, e a base geocodificada é ainda mais enviesada (87,5% em capital). O valor prático da feature se concentra em ~2.360 leads de interior. Isso não invalida a feature, mas define a expectativa: para a maioria dos leads o widget vai dizer "está na capital".

---

## 3. A regra de enquadramento (o coração do pedido)

```
1. Resolver a localização do lead     → { uf, municipioIbge, lat, lng, confianca }
2. Calcular Haversine para todos os alvos (27 capitais + bases nossas)
3. alvoMaisProximo = menor distância
4. Decidir o enquadramento:
     mesmo município do alvo, ou < 5 km → AT_REFERENCE (1 estado, sem distância)
     alvo.uf === lead.uf                → ONE_STATE    (só a malha do estado do lead)
     alvo.uf !== lead.uf                → TWO_STATES   (malha do lead + malha do alvo)
     UF conhecida, sem ponto            → STATE_ONLY   (desenha o estado, sem linha)
     sem UF                             → NO_DATA      (placeholder + CTA)
```

> **Ajustes feitos na implementação (Fase 1), contra a proposta original:**
>
> 1. **Cinco modos, não quatro.** Faltava o caso "UF conhecida, sem ponto" —
>    cidade não reconhecida (bairro, sigla) ou lead que só tem `state`. São 772
>    leads: dá para desenhar o estado, não para medir distância. Sem um modo
>    próprio, isso seria empurrado para `NO_DATA` (perdendo o estado que se
>    conhece) ou para `ONE_STATE` (com distância inventada).
> 2. **"Está na capital" compara código IBGE, não distância.** O ponto do lead
>    vem do geocoder (centro urbano) e o da capital é o centroide da *área* do
>    município, que é o que o IBGE publica: em Teresina são ~7 km, em São Paulo
>    ~11 km. Só com o raio de 5 km, quem mora na capital era classificado como
>    interior — na aferição contra os leads reais, 2.966 casos viravam 635.
>    O raio continua valendo para quem está perto de uma referência sem estar
>    no mesmo município.
> 3. **Nomes em inglês** nos identificadores (`AT_REFERENCE`, `computeFraming`),
>    seguindo o resto do código; comentários e mensagens em português.

**Modo UM_ESTADO**: desenha a malha do estado do lead, preenche o polígono do município do lead, marca o pin da capital, traça a linha entre os dois e rotula a distância. `fitBounds` no estado.

**Modo DOIS_ESTADOS**: desenha as duas malhas de UF, o estado do lead com destaque e o vizinho em tom neutro. Pin no município do lead, pin na capital do vizinho, linha entre eles. `fitBounds` na união das duas malhas. Rótulo comparativo obrigatório — o usuário precisa ver *por que* apareceu um segundo estado:

> **Palmas/TO — 238 km** · a capital do próprio estado (Belém) fica a 900 km

**Modo NA_CAPITAL**: silhueta do estado com o município preenchido e o selo "Está na capital". Sem linha, sem número de km. Cobre 87,5% dos casos geocodificados — precisa ser o layout mais bem resolvido dos quatro, não um caso degenerado.

**Empate**: se o segundo alvo está a menos de 10% de diferença do primeiro, listar os dois no detalhe (§5.2). Não mudar o enquadramento por causa disso — a preview segue o vencedor.

---

## 4. Modelo de dados

### 4.1 Resolução da localização (lib pura, sem I/O)

`src/lib/geo/resolveLeadLocation.ts` — entrada: o lead; saída: localização resolvida com nível de confiança.

Precedência dos campos, nesta ordem:

1. `lead_lat`/`lead_lng` quando existirem → confiança `coordenada` (3.388 leads)
2. `city` + `state` → casa com IBGE → centroide do município → confiança `municipio`
3. `visit_city` + `visit_state` (só quando `city` vazio; +285 leads) → confiança `municipio`
4. `city` sem UF, nome único no país → confiança `inferida` (392 leads)
5. Nada disso → `null`, modo SEM_DADO

**58 leads têm `city` e `visit_city` divergentes.** A regra acima escolhe `city` e ignora o conflito. Se a divergência importar juridicamente (endereço do cliente × local da visita/acidente), isso precisa virar decisão explícita antes da implementação — hoje o `LeadEditDialog` só grava `visit_*`, e `city`/`state` vêm de outra origem (OCR/enriquecimento). **Ponto em aberto para você decidir.**

### 4.2 Alvos de referência

- **Capitais**: constante estática `src/lib/geo/capitais.ts` (27 registros com UF, nome, código IBGE, lat/lng). Não mudam; não justificam tabela.
- **Bases/escritórios nossos**: tabela nova no Externo — **não existe nada equivalente hoje** (varri `information_schema`; só apareceu `adset_geo_rules`, que é de anúncios).

```sql
create table public.geo_reference_points (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('escritorio','base','parceiro')),
  uf text not null,
  municipio_ibge integer,
  lat double precision not null,
  lng double precision not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.geo_reference_points enable row level security;
-- policies: leitura para autenticados; escrita restrita a admin
```

RLS obrigatório (princípio 4 do CLAUDE.md). Sem dado de cliente aqui, mas a tabela não pode ficar aberta a `anon` para escrita.

### 4.3 Cache de rota rodoviária

Chave do cache é o **par (município de origem → alvo)**, nunca o lead. Só existem 1.127 pares UF+cidade distintos na base inteira, contra 16k leads — a mesma rota serve todos os leads da cidade.

```sql
create table public.geo_route_cache (
  municipio_ibge integer not null,
  reference_key text not null,          -- 'capital:PI' | 'ref:<uuid>'
  km numeric not null,
  minutos integer,
  provider text not null default 'google',
  calculado_em timestamptz not null default now(),
  primary key (municipio_ibge, reference_key)
);
```

Índice: a PK composta já cobre o lookup. RLS habilitado, leitura para autenticados.

### 4.4 Malhas geográficas

API v3 do IBGE, em GeoJSON, medida hoje:

| Recurso | Tamanho |
|---|---|
| UF, qualidade mínima | ~5 KB (média de 5 UFs medidas) |
| **27 UFs, qualidade mínima** | **~131 KB** (~40 KB gzip) |
| UF, qualidade intermediária (PI) | 11,8 KB |
| Município isolado (Teresina) | 5,5 KB |
| UF subdividida em municípios (PI, mínima) | 126 KB |

**Decisão de performance**: embarcar as 27 malhas de UF em qualidade mínima como asset do bundle (`src/assets/geo/uf-min.json`, ~131 KB). O kanban renderiza 100+ cards; buscar malha por card seriam 100+ requests ao IBGE a cada scroll — inaceitável (princípio 1 e 2 de escalabilidade). Com o asset embarcado, a miniatura resolve tudo em memória, sem rede.

A malha do **município** (mais pesada e específica) só é buscada na aba "Local", sob demanda, com cache em `sessionStorage`.

---

## 5. Interface

### 5.1 Miniatura no card do kanban/lista

- **Sem Leaflet e sem tiles.** SVG inline gerado do GeoJSON: silhueta do estado + ponto do município. ~48×48px.
- Renderizada por um componente memoizado (`React.memo` + `useMemo` na projeção), pelo mesmo motivo de performance do §4.4.
- Novo toggle `regionMap` em `CardFieldsConfig` (`src/hooks/useCardFieldsSettings.ts`), **desligado por padrão** — coerente com `city`/`state`, que também nascem `false`.
- Ao lado, badge textual curto: `PI · 312 km de Teresina` ou `PI · na capital`.

### 5.2 Painel na aba "Local" da ficha

Entra em `LeadEditDialog.tsx:3403`, acima dos campos de CEP/estado/cidade da visita.

- Mapa Leaflet com as camadas do §3 (uma ou duas malhas de UF, município preenchido, pins, linha).
- Cabeçalho: município/UF resolvido + selo de confiança (`coordenada` / `município` / `inferida`).
- Linha da distância em reta até o alvo vencedor.
- **Top 3 alvos** em lista, com distância — assim o usuário vê o segundo colocado e o critério não parece mágico.
- Botão **"Calcular rota real"**: chama o proxy, grava em `geo_route_cache`, exibe `km por estrada · tempo estimado`. Se já houver cache para o par, mostra direto com a data do cálculo, sem botão.
- Quando a resolução é `inferida` ou há conflito UF×cidade: aviso explícito e link para corrigir o cadastro (§6.4).

---

## 6. Casos de borda — todos com comportamento definido

| # | Caso | Leads | Comportamento |
|---|---|---|---|
| 6.1 | Sem cidade nem UF | ~9.700 | Placeholder "Sem localização cadastrada" + CTA "Preencher". Nunca mostrar mapa vazio nem chutar |
| 6.2 | Lead na própria capital (< 5 km) | 2.951 dos geocodificados | Modo NA_CAPITAL: selo "Está na capital", sem distância |
| 6.3 | Cidade sem UF | 513 | Nome único no país → resolve como `inferida`; ambíguo (49) → pede a UF, não escolhe sozinho |
| 6.4 | UF × cidade incoerentes | 47 | Mostrar conflito ("Colíder consta em MT, não em MA") e **não** escolher — só o usuário corrige |
| 6.5 | Cidade não é município | 139 | Bairro/sigla. Cair na malha da UF sozinha e sinalizar "cidade não reconhecida". Dicionário de apelidos comuns (`Rio`→Rio de Janeiro, `BH`→Belo Horizonte) cobre 14 dos 139 |
| 6.6 | Regiões administrativas do DF | 7+ | `state='DF'` sempre resolve para Brasília (5300108) |
| 6.7 | `state` por extenso | 8 | Normalizar nome→sigla antes de resolver |
| 6.8 | IBGE fora do ar | — | Malhas de UF vêm do bundle e continuam funcionando; malha de município degrada para a silhueta da UF |
| 6.9 | Empate entre alvos (<10%) | — | Preview segue o vencedor; a lista top-3 do §5.2 mostra o empate |

---

## 7. Custos

| Item | Custo |
|---|---|
| Haversine, malhas do IBGE, miniatura SVG | **R$ 0** — cálculo local e API pública |
| Rota rodoviária (Google Directions) | US$ 5 / 1.000 consultas |
| Preenchimento total do cache | ≤ 1.127 pares distintos → **~US$ 6, uma vez**. Depois, só cidade nova |
| Geocoding de leads novos (se ativarmos) | US$ 5 / 1.000 |

O cache por município (§4.3) é o que segura o custo: sem ele, 16k leads × cliques repetidos vira consulta recorrente.

---

## 8. Segurança, LGPD e escalabilidade

- **Nenhum dado pessoal sai do ambiente**: as chamadas ao IBGE levam código de município, nunca nome, CPF ou telefone. As duas tabelas novas guardam só geografia.
- **Chave do Google não vai ao browser**: a rota rodoviária passa pelo proxy (edge `nearby-establishments` ou `railway-server`), como já é feito hoje. Existe `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` no `.env`, sem nenhum uso no código — **não** usar como atalho: `VITE_*` é embutido no bundle e fica público.
- **RLS obrigatório** nas duas tabelas novas, antes de qualquer dado entrar.
- **Sem logar endereço** em `console.log` de produção.
- **Escalabilidade**: malhas no bundle (não N requests), miniatura memoizada, cache de rota por município e não por lead, `geo_route_cache` com PK composta cobrindo o lookup.

---

## 9. Fases de entrega

| Fase | Entrega | Depende de |
|---|---|---|
| **1 ✅** | `src/lib/geo/`: `resolveLeadLocation`, `haversineKm`, `nearestReference`, `computeFraming`, `capitals.ts`, apelidos e normalização de UF. Lib pura, sem UI, 67 testes | — |
| **2 ✅** | Asset `uf-malhas.json` (85 KB) + `<LeadRegionThumb>` e `<LeadDistanceSuffix>` (SVG) no card do kanban e na lista | Fase 1 |
| **3** | Painel na aba "Local" com Leaflet, camadas, top-3 e enquadramento de 1 ou 2 estados | Fase 1 |
| **4** | Migration `geo_reference_points` + `geo_route_cache` com RLS; tela de cadastro de bases; botão "Calcular rota real" via proxy | Fase 3 |

Fases 2 e 3 são paralelas depois da 1. A Fase 1 sozinha já é útil: entrega o número da distância sem nenhum mapa.

### 9.1 O que a Fase 1 entregou (04/08/2026)

| Arquivo | Papel |
|---|---|
| `scripts/build-geo-dataset.mjs` | Gera o dataset a partir de duas APIs públicas do IBGE. Rodar de novo só quando o IBGE mexer na malha municipal |
| `src/lib/geo/data/municipios.json` | 5.571 municípios com **centroide oficial** do IBGE, 275 KB |
| `src/lib/geo/uf.ts` | `normalizeUf` (sigla, nome por extenso, lixo → null) e `normalizeName` |
| `src/lib/geo/municipalities.ts` | Índice e `findMunicipality`: casamento exato, apelidos, regra do DF, homônimos, UF incoerente |
| `src/lib/geo/capitals.ts` | Os 27 códigos IBGE das capitais → pontos de referência |
| `src/lib/geo/resolveLeadLocation.ts` | Precedência dos campos e todos os avisos do §6 |
| `src/lib/geo/haversine.ts`, `nearestReference.ts`, `framingMode.ts` | Distância, ranking e a decisão de enquadramento |
| `src/lib/geo/index.ts` | API pública + `loadMunicipalityIndex()` (import dinâmico, mantém os 275 KB fora do bundle principal) |

**Coordenadas dos municípios**: vêm de `/api/v3/malhas/estados/{uf}/metadados?intrarregiao=municipio`, que devolve o centroide oficial de todos os municípios da UF — 27 requests para o país inteiro, em vez de 5.571. Um único município (Boa Esperança do Norte/MT, novo) ainda não tem malha publicada: entra no índice sem coordenada, para ser reconhecido como município válido em vez de "cidade inexistente".

**Aferição contra os 16.076 leads vivos** (não só contra os testes):

| Modo | Leads | |
|---|---|---|
| `NO_DATA` | 9.162 | sem UF — o caso mais comum, como previsto no §2.3 |
| `ONE_STATE` | 4.113 | |
| `AT_REFERENCE` | 1.596 | |
| `STATE_ONLY` | 772 | UF sem ponto |
| `TWO_STATES` | **433** | a regra dos dois estados |

No recorte comparável ao SQL do §2.5 (leads com coordenada **e** UF): 2.966 / 313 / 92, contra 2.951 / 327 / 93 medidos direto no banco. As diferenças são os leads entre 5 e 20 km do centro da capital, que a regra do código IBGE classifica melhor.

Avisos emitidos na base real: 189 `unknown_city`, 55 `city_visit_divergence`, 49 `ambiguous_city`, 37 `uf_mismatch`, 3 `municipality_without_center`.

### 9.2 O que a Fase 2 entregou (04/08/2026)

| Arquivo | Papel |
|---|---|
| `scripts/build-geo-malhas.mjs` | Baixa a silhueta das 27 UFs do IBGE (qualidade mínima) |
| `src/lib/geo/data/uf-malhas.json` | 85 KB — só anéis externos, 3 casas decimais (~110 m) |
| `src/lib/geo/shapes.ts` | `projectUfs` (equirretangular corrigida pelo cosseno da latitude) e `projectUfsCached` |
| `src/lib/geo/describeFraming.ts` | Rótulo curto do badge e texto explicativo do tooltip |
| `src/hooks/useGeoIndex.ts` | Carrega os dois assets uma vez por sessão, compartilhado por todos os cards |
| `src/hooks/useLeadFraming.ts` | Resolve localização + enquadramento, memoizado por lead |
| `src/components/leads/LeadRegionThumb.tsx` | `<LeadRegionThumb>` (silhueta) e `<LeadDistanceSuffix>` (distância) |

**Onde aparece**: `DynamicKanbanBoard.tsx:1109` (silhueta de 24 px no lugar do pino, com a distância ao fim da linha) e `LeadListView.tsx` (coluna "Local", 20 px). A resolução usa `prefer: 'visit'` no kanban, porque o texto ao lado já mostrava `visit_city || city` — sem isso, o desenho apontaria uma cidade e o texto outra nos 55 leads divergentes.

**Decisões da fase**:

- **Sempre visível, sem toggle.** O `CardFieldsConfig` previsto no §5.1 não serviria: `LeadManager.tsx` e `LeadsPipeline.tsx` (e com eles `useCardFieldsSettings` e `CardFieldsSettings`) **não são importados em lugar nenhum** — são código morto. O card real é o do `DynamicKanbanBoard`, que não tem infraestrutura de configuração de campos.
- **Fallback para o pino.** Enquanto os assets carregam, e para lead sem cidade reconhecida, o componente devolve o `<MapPin>` de antes. O card nunca perde altura nem pisca.
- **Sem Leaflet e sem tile.** SVG puro a partir do asset embarcado. O board renderiza 100+ cards; qualquer coisa que fizesse requisição por card inviabilizaria a rolagem.

**Custo no bundle** (medido no `npm run build`): o principal continua em **3.285,42 kB**, exatamente como antes. Os dados viraram chunks sob demanda — `municipios` 262 kB (96 kB gzip) e `uf-malhas` 87 kB (27 kB gzip) —, baixados uma vez por sessão, só por quem abre uma tela com mapa.

**Item avulso** (fora das fases, 1 linha): trocar `lead_city,lead_state` por `city,state` em `LeadsMapPage.tsx:74` ressuscita a página `/mapa-leads`. Você não a incluiu no escopo; fica registrado porque hoje ela está quebrada em silêncio e a doc afirma que funciona.

---

## 10. Testes

Vitest já está configurado (`vitest.config.ts`, script `npm test`).

- `resolveLeadLocation`: um caso por linha da tabela do §6 — sem dado, sem UF, UF errada, bairro, DF, UF por extenso, divergência city×visit_city.
- `framingMode`: os quatro modos, usando os casos reais do §2.5 (Santana do Araguaia→Palmas deve dar DOIS_ESTADOS; Teresina→Teresina deve dar NA_CAPITAL).
- `haversine`: aferir contra distâncias conhecidas com tolerância de 1%.
- Snapshot do `<RegionThumb>` para PI em ambos os modos.

**Baseline antes de mexer** (Regra 4): `npm test` e `npm run lint` limpos; a aba "Local" abre e salva `visit_*` normalmente.

---

## 11. Fora do escopo

Para o escopo ficar sem ambiguidade, isto **não** entra:

- Redesenhar ou alterar `/mapa-leads` (só a correção de 1 linha do §9, se você autorizar).
- Alterar qualquer campo existente de `leads` ou o comportamento de salvamento da aba "Local".
- Geocodificar leads novos automaticamente (o backfill de junho continua sendo o único; ativar isso é decisão à parte, com custo por lead).
- Backfill ou correção em massa dos 47 leads com UF errada e 139 com bairro no lugar de cidade — a feature **sinaliza**, não corrige sozinha.
- Roteirização multiponto, cálculo de custo de deslocamento, agenda de visitas.

---

## 12. Riscos e rollback

| Risco | Mitigação |
|---|---|
| Feature parece "vazia" — 60% dos leads sem localização | Estado SEM_DADO bem resolvido com CTA; medir adoção antes de investir na Fase 4 |
| Miniatura degrada o kanban | Malhas no bundle + memoização; medir com 100+ cards antes de ligar o toggle por padrão (nasce `false`) |
| Mapa expõe dado sujo e gera desconfiança | Selo de confiança visível e aviso explícito de conflito (§6.4) — é achado, não defeito |
| Custo do Google escapa | Cache por município; botão sob demanda, nunca automático |
| IBGE muda/derruba a API v3 | Malhas de UF vivem no bundle; só a malha de município depende da API, e degrada para a silhueta da UF |

**Rollback**: Fases 1–3 são aditivas e ficam atrás de um toggle desligado por padrão — reverter é `git revert` do commit, sem migration envolvida. A Fase 4 cria duas tabelas novas, sem tocar em nada existente; o rollback é `drop table` das duas (< 5 min, sem perda de dado de negócio).

---

## 13. Pontos em aberto para você decidir

1. **`city` × `visit_city` divergentes (58 leads)**: qual é "a região do lead" — o endereço do cliente ou o local da visita/acidente? A §4.1 assume `city` com fallback para `visit_city`.
2. **Quais são as bases/escritórios** a cadastrar (nome, cidade, UF) — a Fase 4 precisa dessa lista.
3. **Raio do "está na capital"**: assumi 5 km. Numa região metropolitana talvez faça mais sentido 30 km ("é grande São Paulo"), o que mudaria a contagem do §2.5.

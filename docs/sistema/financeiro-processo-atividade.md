# Financeiro no Processo e na Atividade

Onde se registra dinheiro (despesa/receita) ligado a um cliente. Rótulos entre aspas são o texto exato exibido na interface.

---

## O que existia antes

Só a aba **"$ Financeiro"** da ficha do lead (`Editar Lead`). Para lançar uma custa de um processo, ou uma despesa gerada por uma atividade (deslocamento, cópia, perícia), era preciso sair do lugar onde o trabalho estava sendo feito, abrir a ficha do lead e lançar lá — sem nenhum vínculo com o processo ou com a atividade que originou o gasto.

E ela consultava o banco errado (Cloud em vez do Externo), então aparecia zerada mesmo quando havia lançamento. Ver "Banco — e uma correção de roteamento", abaixo.

## O que existe agora

Três pontos de entrada, **a mesma tabela** (`lead_financials`) e o mesmo formulário:

| Onde | Como abrir | O que grava |
|---|---|---|
| Ficha do lead | aba "$ Financeiro" | `lead_id` (+ `case_id` do caso vinculado) |
| Processo | `ProcessDetailSheet` → aba "Financeiro" (entre "Marcos" e "Status") | `process_id`, `case_id`, `lead_id` |
| Atividade | botão "Financeiro" no cabeçalho — na tela cheia (`ActivitiesPage`) e no sheet (`ActivityFullSheet`) | `activity_id` + os vínculos do **destino escolhido** |

São duas telas diferentes para a mesma atividade e o botão existe nas duas, com o mesmo comportamento.

### O destino é escolhido, não assumido

Uma atividade pode estar vinculada a processo, caso e lead ao mesmo tempo — e nem toda despesa é do processo (deslocamento para conversar com o cliente é do lead). Por isso o formulário abre perguntando **"Registrar em"**, listando só os vínculos que aquela atividade tem, do mais específico ao menos:

- **Processo — `<nº>`** → grava `process_id` + `case_id` + `lead_id`
- **Caso — `<título>`** → grava `case_id` + `lead_id` (não entra no financeiro do processo)
- **Lead — `<nome>`** → grava só `lead_id`

Com um vínculo só, não pergunta: mostra "Registrando em: X" e segue. O botão nem aparece se a atividade não tiver nenhum vínculo.

`activity_id` é gravado sempre, qualquer que seja o destino — é o que a aba Financeiro da própria atividade lista.

### A regra que faz tudo se encaixar

O lançamento grava os vínculos do destino escolhido, não só o id da tela onde foi criado. Consequência prática:

- Despesa lançada numa atividade com destino "Processo X" **aparece sozinha** na aba Financeiro do processo X, na do caso e na do lead. Não há rollup por consulta extra nem job de sincronização — é o mesmo registro, encontrado por filtros diferentes.
- Na lista do processo (ou do lead), o lançamento vindo de atividade é marcado com "• via atividade".

### O que cada aba lista

- **Lead**: `lead_id` (ou `case_id`, quando há caso vinculado) — comportamento histórico, inalterado.
- **Processo**: `process_id` — inclui o que foi lançado nas atividades daquele processo.
- **Atividade**: `activity_id` — só o daquela atividade.

O botão "Financeiro" da atividade só aparece em atividade **já criada** (em modo criação ainda não existe `activity_id` para vincular).

---

## Implementação

- `src/components/finance/EntityFinancialsPanel.tsx` — implementação única, parametrizada por `scope` (`lead` | `case` | `process` | `activity`). Exporta `buildFinancialLinkOptions()`, que monta os destinos da atividade.
- `src/components/leads/LeadFinancialsTab.tsx` — wrapper fino, `scope="lead"`.
- `src/components/cases/ProcessDetailSheet.tsx` — aba `financeiro`.
- `src/pages/ActivitiesPage.tsx` e `src/components/activities/ActivityFullSheet.tsx` — botão "Financeiro" + dialog, ambos usando `buildFinancialLinkOptions()` para oferecer os mesmos destinos.
- Todo lançamento gravado continua disparando `trackFinanceEntry()` (cronômetro / bloco "Controle Financeiro" do dia), igual à aba do lead.

### Banco — e uma correção de roteamento

`lead_financials` vive no Supabase **Externo** (`kmedldlepwiityjsdahz`), com FK para `leads` e `legal_cases` de lá. A aba Financeiro do lead consultava a tabela pelo client **Cloud** — banco errado. Por isso ela aparecia sempre zerada. Corrigido: o painel usa `db` (Externo), com `ensureExternalSession()` e `created_by` passado por `remapToExternal()` (o usuário autentica no Cloud, a FK aponta para o auth do Externo). `lead_financials` entrou em `BUSINESS_TABLES` (`src/integrations/supabase/db-routing.ts`) para o guarda pegar qualquer reincidência.

Migration `20260805160000_lead_financials_processo_e_atividade.sql`:

```sql
ALTER TABLE public.lead_financials
  ADD COLUMN IF NOT EXISTS process_id  uuid,
  ADD COLUMN IF NOT EXISTS activity_id uuid;
-- + FK para lead_processes(id) e lead_activities(id), ambas ON DELETE SET NULL
-- + índices parciais em process_id e activity_id (os filtros novos das abas)
```

`ON DELETE SET NULL` segue o que `case_id` já fazia: apagar processo ou atividade não pode apagar dinheiro já lançado — o valor foi gasto de qualquer jeito e continua valendo para o caso e para o lead.

**Aplicada em 05/08/2026** no `kmedldlepwiityjsdahz`, com 0 linhas na tabela. Colunas, as duas FKs e os dois índices parciais conferidos no banco depois de rodar.

O painel mostra erro do banco em toast em vez de engolir a falha e exibir lista vazia — era assim que a aba do lead se comportava antes, e foi o que escondeu o roteamento errado.

Rollback (reversível em <1min, sem perda de dado pré-existente):

```sql
DROP INDEX IF EXISTS public.idx_lead_financials_process_id;
DROP INDEX IF EXISTS public.idx_lead_financials_activity_id;
ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS process_id;
ALTER TABLE public.lead_financials DROP COLUMN IF EXISTS activity_id;
```

### Não faz parte deste módulo

`financial_entries` / `FinancePage` / `FinancialEntryForm` — é o financeiro **da empresa** (centro de custo, regime de competência, NF, núcleo). Nada aqui mexe nele.

## Extrato do processo e a regra do PAGO (18/08/2026)

Caso 10 (`0000408-22.2017.5.22.0110`, acordo homologado e pago em 14/09/2017)
expôs três furos, todos corrigidos e verificados no banco real:

1. **Parcela recebida sem valor importado não contava como PAGO.** A planilha
   trouxe 344 de 703 parcelas recebidas (10 CNJs) com `data_recebida` e
   `status=RECEBIDA` mas `valor_pago NULL`. A régua era `sum(valor_pago) > 0`,
   então o cliente caía em A_RECEBER — e o front corrigia pela SELIC (×1,77)
   um dinheiro que já tinha caído na conta. Regra nova, na RPC
   `pop_carteira_marcos` (migração `20260818130000`, aplicada no Externo) e no
   `useConferenciaProcesso`: **todas as parcelas recebidas = estágio PAGO,
   mesmo sem valor digitado**. "Recebeu" e "quanto recebeu" são perguntas
   separadas.

2. **Parte PAGA não corrige.** SELIC/TCM atualizam o que está POR receber.
   `useCarteiraDoPop` e `useConferenciaProcesso` deixam a parte PAGA no
   nominal, e a conferência mostra "Pago em <data> — não corrige" no lugar da
   conta do coeficiente. Parcela sem valor exibe "sem valor", nunca "R$ 0,00".

3. **A aba Financeiro do processo virou o EXTRATO do processo.** O
   `EntityFinancialsPanel` com `scope='process'` + `processNumber` mescla, numa
   linha do tempo única: lançamentos manuais (`lead_financials`), parcelas da
   jurimetria (`jm_pagamentos`) e o extrato importado da planilha
   (`jm_lancamentos`, 4.742 linhas, nov/2020+). Cada linha tem titular
   (**escritório × cliente**, derivado da categoria: indenização/cota = do
   cliente; honorários/custas = nosso), badge previsto × realizado e origem.
   Os cards abrem por titular; parcela recebida no bruto (cliente + honorário
   juntos, sem separação na base) fica fora dos cards, somada à parte. As
   linhas de `jm_*` são só leitura. Categorias novas no form manual:
   Honorários Contratuais, Honorários Sucumbenciais, Cota do Cliente.

**O que continua faltando** (decidido em 18/08/2026): a separação
cliente × honorário das PARCELAS (`jm_pagamentos`, ex.: caso 10 = 20.000 cliente
+ 8.571,43 honorário por parte) não existe na base — as colunas L/M/N da
planilha "Tab. Aux" nunca foram importadas, e `jm_valores.hs_pct` está zerado.
O Raym optou por NÃO fazer backfill de `valor_pago` com o bruto da decisão
(12 parcelas únicas, R$ 440 mil): fica "sem valor" até vir importação correta
da planilha, com a separação de titular junto. **Isso vale só para as parcelas**
— em `jm_lancamentos` a separação existe e está em uso (ver abaixo).

## Vocabulário dos lançamentos (ditado pelo Raym em 18/08/2026)

Fonte da verdade em código: `src/lib/lancamentoCategorias.ts`, com teste em
`src/lib/__tests__/lancamentoCategorias.test.ts` (11 casos, os mesmos que
existem em `jm_lancamentos`). A mesma régua classifica o lançamento manual do
app e a linha importada da planilha.

| Categoria | Titular | É caixa? | O que é |
|---|---|---|---|
| **Honorários a receber** | escritório | não | acordo com pagamento em data futura |
| **Honorários** | escritório | sim | os que já foram recebidos |
| **Honorários Adiantados Oriz** | escritório | sim, mas **não do processo** | antecipado junto ao FIDC da Oriz; o processo continua em tramitação |
| **Indenização a receber** | cliente | não | mesma lógica do "honorários a receber", com a parte como beneficiária (líquido dela) |
| **Indenização** | cliente | sim | valor efetivamente pago ao cliente (a cota dele) |
| **Indenização comprada** | **escritório** | sim | o escritório comprou a indenização a receber da parte — comprado, o crédito é nosso |
| **Honorários Adv Parceiro** | **parceiro** | sim | honorário repassado ao advogado parceiro — sai da nossa mão |

Três regras que caem fora da tabela e são fáceis de errar:

1. **"a receber" e "recebido" são o MESMO lançamento em estados diferentes.**
   Quando a parcela é paga, a linha muda de categoria na planilha — não nasce
   uma linha nova. Somar os dois conta o dinheiro duas vezes. Por isso o extrato
   mostra "a receber" num card à parte, nunca junto do caixa.
2. **Adiantamento do FIDC não é o processo pagando.** Entra caixa, mas o
   recebível continua vivo. Fica fora do "recebido", com aviso próprio na tela.
3. **"Indenização comprada" é a exceção do prefixo "indenização"** — é a única
   categoria com "indeniza" no nome cujo titular é o escritório.
4. **O repasse ao parceiro NÃO abate do nosso honorário.** A planilha lança a
   metade do parceiro como LINHA PRÓPRIA, de valor igual à nossa: no CNJ
   0002701-92.2017.5.22.0003, cada parcela do acordo aparece duas vezes — uma
   com o nome do parceiro em `PESSOA` ("HC ITELVINA DR LUCIANO") e outra sem
   ("HC ITELVINA"). Descontar o repasse do nosso honorário tiraria o valor duas
   vezes. Por isso ele tem card/nota próprios e fica fora do resultado.

**Buraco conhecido (18/08/2026, não corrigido):** 2 linhas de R$ 19.466,29 no
CNJ 0002701-92.2017.5.22.0003 são a metade do parceiro mas foram lançadas com
categoria "Honorários" (o nome do parceiro só aparece em `PESSOA`) — a categoria
"Honorários Adv Parceiro" passou a ser usada depois. Essas 2 linhas contam como
nossas no extrato. Não foi aplicada heurística de "DR/DRA no PESSOA" para pegá-las:
seria palpite sobre dado de produção. A correção certa é reclassificar as linhas
na planilha e reimportar.

**HC × HS:** a coluna `PESSOA` da planilha carrega `HC` (contratual) ou `HS`
(sucumbencial) nas linhas de honorário — 657 HC e 104 HS em `jm_lancamentos`.
Quando `PESSOA` traz nome de pessoa (54 linhas de "Honorários a receber"), é de
qual parte o valor decorre; o titular continua sendo o escritório, como a
planilha marca em Beneficiário. O extrato do processo abre os cards em
contratual × sucumbencial por causa disso.

**Colunas da planilha que NÃO chegaram na base** (conferido em 18/08/2026):
`Beneficiário` ("Escritório" no PDF, mas na base só tem conta de despesa em
4.291 de 4.742 linhas nulas) e `Relação c/ Cliente` (o "30%" do contrato — só 7
linhas de 4.742). Se algum dia forem importadas, o titular passa a vir do dado
em vez da categoria.


## A coluna TIPO: entrada, saída e REPASSE (18/08/2026)

O Raym levantou a dúvida certa: *"não sei o que boto na parte do cliente e do
parceiro porque não é entrada nem saída"*. Ele está certo, e a base mostra a
confusão: das 1.302 linhas de indenização, 859 estavam sem tipo, 443 como
ENTRADA e 2 já tinham "Repasse" escrito à mão.

**A causa:** a coluna TIPO estava respondendo duas perguntas ao mesmo tempo —
"para que lado o dinheiro andou" e "de quem é o dinheiro". Entrada/Saída só
respondem a primeira. A cota do cliente que cai na conta do escritório *é* uma
entrada de dinheiro, mas não é receita: é dever de repasse.

**A régua combinada:**

| Tipo | Quando usar |
|---|---|
| `ENTRADA` | entrou e é **nosso** — honorário (recebido ou a receber), crédito comprado, adiantamento do FIDC |
| `SAIDA` | saiu e era **nosso** — custas, perícia, folha, imposto |
| `REPASSE` | dinheiro de **terceiro** passando pela conta — cota do cliente e repasse ao advogado parceiro. Não é receita nem despesa |

Detalhe que tira o peso da decisão: **o sistema não depende de acertar o TIPO.**
De quem é o dinheiro sai da CATEGORIA (ver a tabela do vocabulário acima), e é
assim que o extrato monta os totais. O TIPO é descritivo — ajuda a ler o
extrato, não sustenta a conta. Categoria ambígua (Movimentação conta, OUTROS)
fica sem tipo mesmo: sem régua confiável, o certo é não inventar.

### Importador da planilha

`scripts/import-lancamentos-planilha.mjs` — recarrega a aba Lançamentos a partir
de um CSV exportado do Google Sheets. Testes em
`src/lib/__tests__/importLancamentosPlanilha.test.ts` (10 casos).

```
node scripts/import-lancamentos-planilha.mjs --dry-run ~/Downloads/Lancamentos.csv
SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-lancamentos-planilha.mjs ~/Downloads/Lancamentos.csv
```

O que ele resolve, além de trazer a coluna `Relação c/ Cliente` (o percentual do
contrato) que faltava:

- **Chave `ordem_origem`** (número da linha na planilha). 4.676 das 4.742 linhas
  têm ordem única; 66 repetem porque duas cargas foram para a mesma tabela — o
  script pula essas e lista quais, em vez de adivinhar.
- **Nunca sobrescreve `parte_id` nem `parte_conciliacao`** (1.458 e 1.529 linhas):
  são da conciliação feita depois da importação e não existem na planilha.
- **Só ATUALIZA por padrão.** Inserir linha nova exige `--inserir`, para uma
  exportação parcial não injetar lixo.
- **Duas colunas "Natureza".** A planilha tem duas com o mesmo nome — a de
  recorrência e a do dano (última coluna). Mapear por nome pegava a primeira nas
  duas e o dano vinha nulo; o mapeamento agora escolhe a ocorrência certa.
- **Cabeçalho truncado** ("Valor (Regime de Caix") é aceito por prefixo.

`Beneficiário` continua fora de propósito: o Raym confirmou que o titular
deduzido da categoria está correto, então importar a coluna não acrescentaria.


## Honorários a receber: a vencer, vencido e condenação (18/08/2026)

O Raym perguntou quanto dá de honorários a receber e se havia data atrasada. O
total bruto era **R$ 5.816.833,01**, com **R$ 4.997.428,78 no passado** — parecia
inadimplência enorme. Não era.

**31 linhas (R$ 4.721.335,96, 15 processos) carregavam a data da DECISÃO**, não de
vencimento: observação "Condenação em 1º/2º grau", `n_parcela = 1`. Pela régua da
carteira isso é **CONDENAÇÃO** (valor certo, data incerta), e a régua é explícita:
nunca junte CONDENAÇÃO com A RECEBER na mesma coluna — superestima o descontável.
Aqui inflava o "a receber" em ~10x e ainda fazia tudo parecer vencido há anos.

Depois de separar (migração `20260818210000`, aplicada):

| Régua | Valor | Linhas |
|---|---|---|
| **A vencer** (valor e data, no prazo — é o descontável) | R$ 519.376,09 | 577 |
| **Vencido** (data passou de verdade) | R$ 576.120,96 | 71 |
| **Condenação** (fixado, sem data de pagamento) | R$ 4.721.335,96 | 31 |

Fonte da verdade do estágio: `estagioDoLancamento()` em
`src/lib/lancamentoCategorias.ts` — deriva CONDENACAO / A_RECEBER / VENCIDO /
REALIZADO de categoria + data + `tem_data_pagamento`, com `hoje` por parâmetro
para o teste não depender do relógio. A carteira do POP mostra os três em chips
próprios (`PopCarteiraSheet`), alimentados por `useCarteiraDoPop`, que respeita o
filtro da tela como o resto dos totais.

### Onde o "não tem data de pagamento" mora — e a tentativa errada antes dele

Primeira tentativa (migração `20260818210000`, **revertida no mesmo dia**): criar
a categoria `Honorários condenação` para essas 31 linhas. O Raym não comprou, e
com razão — no vocabulário do escritório **CATEGORIA diz que tipo de dinheiro é**
(honorário, indenização, custas) e **ESTÁGIO diz onde o dinheiro está** (a
receber, vencido, condenação). "Condenação" é estágio; pô-lo na categoria
misturou as duas gavetas. O sintoma de que estava errado apareceu sozinho: como
a categoria vem da planilha, a reclassificação só sobrevivia com um guarda no
importador para não ser desfeita a cada reimportação.

O fato que faltava nunca foi a categoria — era **o significado da data**. Em
quase toda linha `data` é o vencimento; nestas 31 é o dia da decisão. Virou a
coluna `jm_lancamentos.tem_data_pagamento` (migração `20260818230000`):

- `true` (padrão) — a `data` da linha é o vencimento;
- `false` — não há cronograma; a `data` é a da decisão. A régua lê CONDENAÇÃO.

A coluna **não existe na planilha de propósito**: assim o importador não a toca e
a marcação sobrevive a qualquer reimportação sozinha. O guarda `preservaCategoria`
saiu do script por ter deixado de ser necessário — bom sinal de que o desenho
novo é o certo.

**O que a base NÃO diz:** se as linhas vencidas são calote ou parcela paga sem
baixa na planilha. A tela afirma isso em vez de escolher um dos dois.

## Sincronização com as duas planilhas (18/08/2026)

São **duas** planilhas, e elas respondem perguntas diferentes:

| | **Jurimetria — aba Tab. Aux** | **Controle Financeiro — aba Lançamentos** |
|---|---|---|
| Uma linha é | uma **PARTE** | uma **PARCELA** |
| Responde | *quanto vale* (estoque) | *quando entra* (fluxo) |
| Traz | condenação, cota do cliente, HC à vista, HC parcelado, HS, status | data, valor, categoria, conta |
| Tamanho (18/08) | 1.028 partes · 287 processos | 4.713 lançamentos |
| Vai para | `jm_valores` (ainda sem as colunas de honorário) | `jm_lancamentos` |

**Nunca se somam** — uma é o patrimônio, a outra é o caixa.

A Tab. Aux tem a separação que faltava: no caso 10, cada parte aparece com
condenação R$ 28.571,43 = **cota R$ 20.000,00 + honorário contratual
R$ 8.571,43**. Importá-la é o passo seguinte (pede colunas novas em
`jm_valores`, ainda não feito).

### Três bugs do importador, pegos antes de rodar

1. **Casar por número de linha estava errado.** O Raym apagou linhas da planilha
   e tudo abaixo subiu: a `ordem_origem` 3000 no banco era "FELIPE ESTEFÂNIO
   R$ 105,21", na planilha virou "JONAS AIRES SILVA R$ 30.864,59". Rodar assim
   sobrescreveria milhares de registros com dados errados, em silêncio. A
   identidade passou a ser o CONTEÚDO (ver o cabeçalho do script).
2. **Data com um dígito.** O Sheets exporta `10/8/2023` ao lado de `30/11/2025`;
   o parser exigia dois dígitos e zerava a data de **34 linhas**, inflando o diff
   em 34 apagar + 34 inserir.
3. **Data que não existe.** A planilha tem `29/02/2022`, e 2022 não é bissexto.
   O formato passava e o Postgres recusava a carga inteira no insert. Agora o
   script valida no calendário e avisa quais linhas têm data impossível.

### Resultado da sincronização

4.542 inalteradas · 61 atualizadas · 71 inseridas · 100 apagadas → **4.713**,
exatamente o tamanho da planilha. Backup das apagadas em
`jm_lancamentos_removidas_20260818`.

Honorários a receber depois da sincronização: **R$ 560.905,04 a vencer**,
R$ 152.818,96 vencido, R$ 18.600,00 condenação (`tem_data_pagamento = false`).

**Conciliação sobrevive à reorganização.** Preservar `parte_id` linha a linha não
funciona — o Raym reorganiza as partes, e uma parcela que era "ADERALDO PIRES
CARVALHO" hoje é "KEILA CARVALHO SANTOS SOUSA". Mas `parte_id` é FUNÇÃO de
(processo, pessoa): 242 combinações, zero ambíguas. O script guarda esse mapa
antes de mexer e reaplica depois — 1.456 das 1.458 conciliações sobreviveram (as
2 restantes eram de linhas que a planilha apagou).

---

## Importação da Tab. Aux (18/08/2026)

Fechou o buraco que a tabela acima anunciava: a separação **cota × honorário**
agora existe por parte, em todo processo, e não só onde há lançamento.

Onde ficou: colunas novas em **`jm_partes`** (não em `jm_valores` — a granularidade
da Tab. Aux é a PARTE, e é `jm_partes` que tem essa chave):

| Coluna | O que é |
| --- | --- |
| `condenacao_cjcm` | total da condenação corrigida (CJCM) |
| `cota_parte_cjcm` | quanto disso é do CLIENTE |
| `cota_parte_vista_cjcm` | a parte do cliente paga à vista |
| `hc_vista` / `hc_parcelado` | honorário CONTRATUAL do escritório |
| `hs` | honorário SUCUMBENCIAL do escritório |
| `status_pagamento` | PROJETADO / A RECEBER / PAGO / PERDIDO |
| `fase_atual` | fase processual como está na planilha |
| `valores_importados_em` | carimbo da última importação |

Migration `20260818230500_jm_partes_valores_tab_aux.sql`, importador
`scripts/import-tab-aux.mjs`, testes em `src/lib/__tests__/importTabAux.test.ts`.

### Como o importador casa a parte

Por **(processo, cliente)**: CNJ reduzido a dígitos (a planilha e o banco pontuam
diferente) e nome normalizado sem acento, sem espaço duplo, em maiúscula. Parte que
não existe no banco **não é inventada** — sai na lista `semParte`. Parte que aparece
duas vezes com valores DIFERENTES sai em `ambiguas` e o script não escolhe por conta
própria.

O `VALUES` castea todo número para `numeric` e todo texto para `text`: sem isso o
Postgres infere `text` quando a primeira tupla traz `null` e a atribuição estoura.

### Resultado

997 partes atualizadas · 688 com valor de condenação (as demais 309 vêm da planilha
só com status/fase, sem valor). Totais no banco:

| | |
| --- | --- |
| Condenação | R$ 175.338.282,55 |
| Cota do cliente | R$ 63.992.976,45 |
| Honorário contratual | R$ 41.030.455,24 |
| Honorário sucumbencial | R$ 46.289.483,02 |

Prova no caso que originou tudo: as 7 partes com condenação R$ 28.571,43 somam
R$ 200.000,01 de condenação — **R$ 140.000,00 do cliente e R$ 60.000,01 do
escritório** (8.571,43 cada). A tela mostrava os 200k como se fossem do cliente.

### O que ficou de fora, de propósito

- **30 partes da Tab. Aux não têm linha correspondente em `jm_partes`** — nome ou
  processo que não existe no banco. Não foram criadas.
- **2 partes ambíguas** (mesma parte, dois conjuntos de valores na planilha).
- **9 partes não fecham em nenhuma leitura das colunas** (P0544-P0548, P0702, P0703,
  P0781, P0782 — em duas delas a cota vem MAIOR que a própria condenação). Vale
  conferir na origem.

> **Correção (18/08, mesma noite).** Registrei aqui antes que
> `condenação = cota + HC + HS` não fechava em 311 de 827 linhas "por fórmulas com
> datas de correção diferentes". Estava errado — era leitura errada das colunas, não
> defeito da planilha. A identidade certa está em `src/lib/valorProcesso.ts` e fecha
> em **679 das 688** partes com valor.

---

## "Quanto vale o processo" na ficha (18/08/2026)

Bloco novo no topo do painel financeiro do processo (`EntityFinancialsPanel`,
só quando `scope='process'` e há CNJ), alimentado por `jm_partes`. Mostra
condenação, quanto é do cliente e quanto é do escritório — aberto em contratual e
sucumbencial — mais os status das partes e a lista parte a parte.

**Fica separado do extrato de propósito.** Estoque e fluxo respondem perguntas
diferentes e o mesmo honorário aparece nos dois: aqui como direito, lá como parcela
quando entra. O bloco tem estado próprio (`partesValor`), não passa por
`totaisProcesso`, e a tela diz na cara "não some com o extrato abaixo".

Cobertura: **186 processos** ganham o bloco — e em **114 deles não existe um único
lançamento**, ou seja, a ficha era financeiramente vazia. Outros 168 processos têm
partes na Tab. Aux só com status/fase, sem valor: nesses o bloco não aparece.

### A identidade das colunas (medida, não suposta)

```
condenação = cota da parte + honorário contratual À VISTA + sucumbencial
```

Fecha em **679 das 688** partes com valor (98,7%). Duas armadilhas, as duas
verificadas no dado antes de virar código:

1. **`hc_parcelado` não é fatia a mais da condenação — está DENTRO da cota.** É o
   honorário que o cliente paga em prestações com o dinheiro que recebeu, enquanto o
   "à vista" é retido antes do repasse. Somá-lo ao lado da cota inflava o total em 55
   partes. Daí `cotaLiquida = cota − hc_parcelado`, e o parcelado continua contando
   como nosso. Confere por baixo: `cotaLiquida + escritório = condenação`.
2. **Em 251 partes "TOTAL PARTE CJCM" vem zerada** e o valor do cliente está só em
   "TOTAL À VISTA PARTE CJCM" — são as linhas ainda PROJETADAS. A cota cai para a
   coluna à vista e o resumo conta quantas (`cotaProjetada`), para a tela dizer que
   ali é projeção, não acordo fechado.

Sem a armadilha 2 o cliente sumia da conta em 251 partes; sem a 1, o processo era
contado a mais. Com as duas, os processos que fecham foram de 72 para 177 de 186.

Lógica pura em `src/lib/valorProcesso.ts` com 12 testes — o componente só desenha.

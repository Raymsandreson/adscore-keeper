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
REALIZADO de categoria + data, com `hoje` por parâmetro para o teste não depender
do relógio. A carteira do POP mostra os três em chips próprios
(`PopCarteiraSheet`), alimentados por `useCarteiraDoPop`, que respeita o filtro da
tela como o resto dos totais.

**O que a base NÃO diz:** se as 71 linhas vencidas são calote ou parcela paga sem
baixa na planilha. A tela afirma isso em vez de escolher um dos dois. As mais
antigas: R$ 185.426,38 (881 dias), R$ 112.549,15 (811 dias), R$ 60.750,00
(1.630 dias).

**Pendência conhecida:** a categoria "Honorários condenação" **não existe na
planilha** — foi criada só no banco. O importador tem guarda
(`preservaCategoria`) para não desfazer numa reimportação, e avisa quantas linhas
segurou, mas o certo é criar a categoria na planilha também.

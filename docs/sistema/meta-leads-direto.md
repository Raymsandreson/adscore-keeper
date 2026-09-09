# Lead da Meta direto no funil (sem planilha)

`meta-leads-sync` no Railway. Lê os formulários de Lead Ads pela Graph API e
cria o lead no board, dispensando a planilha do Google.

## Por que existe (medido em 09/09/2026)

A planilha era o único caminho entre o anúncio e o CRM — e ponto único de falha
silenciosa:

| | 30 dias |
|---|---:|
| Leads que a Meta gerou | **3.269** |
| Linhas na planilha | 574 |
| Leads pagos no CRM | 509 |
| Investido | R$ 27.641 |

**A campanha do BPC não tinha parado**, como a planilha fazia parecer: os 5
formulários estão `ACTIVE`, somam 2.641 leads e havia lead entrando no mesmo dia
da medição. Quem parou foi a integração Meta → Planilha, em agosto. A planilha
apenas deixou de crescer, sem erro em lugar nenhum.

## Token: não precisa gerar nada à mão

`leadgen_forms` recusa o token do sistema com **erro 190** ("must be called with
a Page Access Token"). O token de página sai de `me/accounts`, que devolve as
páginas alcançadas junto com o token de cada uma. O token de página **nunca sai**
da função nem vai para log.

Diagnósticos em `meta-capi-dispatch`: `modo: 'paginas'` (quais páginas e se há
token), `modo: 'formularios'` (formulários e contagem), `modo: 'escopos'` (o que
o token pode), `modo: 'amostra_formulario'` (nomes de campo, sem valor).

## Roteamento

Palavra-chave no nome do formulário → board, por **UUID explícito**: nome de
board é ambíguo (existem dois "Auxílio Acidente" e quatro com "BPC").
Formulário sem rota não é adivinhado — volta em `formularios_ignorados`, que é
onde aparecem "[REPRESENTANTE COMERCIAL-SP]" e "[CAPTAÇÃO][CORRETOR]"
(recrutamento, não cliente).

## As três armadilhas que já custaram caro aqui

**1. O mesmo formulário existe em duas línguas.** Israel usa
`nome_completo`/`telefone`/`cidade`; Mateus usa `full_name`/`phone_number`/`city`.
Procurar `"nome completo"` com espaço não casa nenhum dos dois (a Meta usa
underscore) — no primeiro teste isso descartou **817 leads em silêncio**.

**2. Casar frouxo é pior que não casar.** O formulário do BPC tem
`qual_o_nome_da_criança_?`. Um match por "nome" traz a criança no lugar do
responsável: dado errado, no campo certo, sem erro nenhum. Daí a lista
`NAO_E_O_TITULAR`.

**3. Formulário que lê linha e aproveita zero é bug, não ausência de lead.**
Quando isso acontece a resposta traz `ALERTA` e os nomes de campo vistos, e
`formularios_com_alerta` no topo. **Se vier > 0, não rodar para valer.**

## Dedup

Por telefone dentro do board, com a **mesma** `phoneKey` da planilha
(`lib/leadAdsSheet`, com teste). Se cada caminho normalizasse do seu jeito, um
não enxergaria o outro e a mesma pessoa entraria duas vezes. A busca dos
telefones existentes é **paginada** — o board BPC tem 6.745 chaves e o PostgREST
corta em 1000.

`telefone_divergente` conta quando o telefone pré-preenchido pela Meta e o
digitado na pergunta aberta diferem nos 8 últimos dígitos (~11% dos leads). A
função prefere o pré-preenchido, que é o que a planilha também gravava — por
isso 572 dos 577 do Auxílio Acidente deduplicaram corretamente contra o que a
planilha já tinha trazido.

## O que a planilha jogava fora

As respostas de qualificação (renda da família, CadÚnico, laudo médico, se já
tem advogado, quantas pessoas moram na casa) ficam em `details.meta_form`.

## Backlog de 30 dias ingerido (09/09/2026)

| | |
|---|---:|
| Leads pela API da Meta | **2.152** |
| Leads pela planilha | 912 |
| Board BPC | 8.000 → **10.147** |
| Meta ID no formato certo | 2.152 de 2.152 |
| Nome inválido | 0 |

Efeito no painel — o custo por lead pago era falso por falta de denominador:

```
custo por lead pago (30 dias):  R$ 50,74  ->  R$ 8,81
leads pagos em 30 dias:            509    ->    2.945
```

### Duas armadilhas da execução

**`leads` não tem coluna `details`.** As respostas do formulário iam para lá e o
insert falhou inteiro (`Could not find the 'details' column`), 0 criados. Eu
tinha copiado a suposição de `zapsign-webhook.ts`, que grava `details` **e**
`closed_at` — as duas inexistentes, e é por isso que aquele caminho nunca criou
um lead. Agora as respostas vão para `notes`, onde o atendente lê renda,
CadÚnico e laudo na própria ficha.

**Índice único GLOBAL de telefone.** `idx_leads_phone_normalized_unique` vale
para a tabela toda, não por board: lead cujo telefone já existe em outro funil é
recusado pelo banco. O dedup da função olha só o board, então essas linhas
aparecem como erro de insert — comportamento correto, mas o contador precisa
mostrar.

**Contador que parava em 5.** `erros` era `erros.length` com a amostra limitada a
5, então 195 falhas apareciam como "erros=5". Agora conta tudo e agrupa por
motivo em `erros_por_motivo`. Número de erro que mente na direção confortável é
pior que erro nenhum.

### Timeout da borda

Varrer todos os boards com janela de 30 dias em uma requisição só devolve
`upstream error` (timeout do Railway) — mas nada se perde, porque a função é
idempotente: basta rodar de novo, e por `board_id` para encurtar cada chamada.

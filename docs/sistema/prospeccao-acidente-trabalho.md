# Prospecção de processos de acidente de trabalho (alto valor)

Objetivo: achar processos com assunto de **acidente de trabalho** e **valor da
causa acima de um piso** (pedido original: R$ 500k), identificar o advogado do
**polo ativo** e abrir conversa comercial de antecipação/crédito.

Levantamento feito em 19/08/2026. Este documento separa o que foi **medido**
do que ainda é **hipótese não verificada** — não apagar essa distinção.

---

## 1. O que a API do Escavador NÃO faz (medido)

### 1.1 Não existe busca global por assunto nem filtro por valor da causa

Todas as rotas de busca da v2 são ancoradas numa **chave**:

| Rota | Chave exigida |
|---|---|
| `/processos/numero_cnj/{cnj}` | número CNJ |
| `/processos/buscar?nome=` | nome |
| `/processos/cpf/{cpf}` | CPF |
| `/processos/cnpj/{cnpj}` | CNPJ |
| `/advogado/processos?oab_numero=&oab_estado=` | OAB |

Evidência: `supabase/functions/search-escavador/index.ts:31-100` implementa as
11 ações em produção e todas exigem uma dessas chaves. O SDK oficial em Python
expõe o mesmo conjunto (`por_nome`, `por_cpf`, `por_cnpj`, `por_oab`).

**Consequência:** "todos os processos de acidente de trabalho do Brasil acima
de 500k" não é uma consulta que exista nessa API. É preciso partir de uma
**semente** (lista de OABs, ou CNPJs de empresas rés) e filtrar pela capa no
cliente — é o que `_shared/prospeccaoAcidenteTrabalho.ts` faz.

### 1.2 Não devolve e-mail nem telefone de advogado

`src/utils/escavadorPartyUtils.ts:6-19` — o tipo `EscavadorEnvolvido`, montado
contra respostas reais e em uso em produção, tem: `nome`, `nome_normalizado`,
`cpf`, `cnpj`, `tipo_pessoa`, `tipo`, `tipo_normalizado`, `polo`,
`quantidade_processos`, `oabs[]`, `advogados[]`. **Não há campo de contato.**

### 1.3 Custo por consulta

A consulta por OAB cobre até 200 itens; blocos de 200 além disso são cobrados à
parte. A paginação dessa rota carrega dois parâmetros (`cursor` + `li`, o id da
consulta para cobrança) — repassar só o cursor dá 422. Ver o comentário em
`search-escavador/index.ts:53-64`, que já documenta isso medido em 18/08/2026.

Ou seja: varrer OAB por OAB **custa dinheiro por varredura**. Vale medir o
rendimento (candidatos por consulta) antes de escalar.

---

## 2. De onde poderia vir o contato do advogado

### 2.1 Procuração nos autos — viável, com ressalva séria

Advogado com certificado digital pode acessar autos de processo **público**
mesmo sem procuração (prerrogativa do Estatuto da OAB, Lei 8.906/94 art. 7º).
O Escavador suporta: sobe-se o certificado A1 (`.pfx`) e usam-se as ações já
implementadas `buscar_autos`, `buscar_documentos`, `download_documento_pdf`
(`search-escavador/index.ts:72-90`). Há também `documentos_publicos=1` para
documentos públicos. O fluxo é **assíncrono**: pede → consulta status → baixa.

Requisitos: o titular do certificado precisa ser advogado com CPF já cadastrado
no tribunal consultado. Não funciona em processo em segredo de justiça.

**Ressalva que precisa de decisão do usuário, não do código:** a procuração
carrega CPF, RG e endereço **do cliente acidentado**, não só o contato do
advogado. Baixar e armazenar isso em escala, para finalidade comercial alheia
ao processo, é exposição de LGPD bem maior que o e-mail do advogado.

Mitigação implementável: extrair **apenas** o bloco de contato do advogado,
nunca persistir o PDF nem dado do cliente, descartar o binário na mesma
execução. Se for por esse caminho, isso é requisito, não melhoria.

### 2.2 Enriquecimento externo

Planilha própria, base do escritório, ou fornecedor pago por OAB/nome. Mais
simples e sem tocar em dado de cliente. Exige checar base brasileira (LGPD).

---

## 3. DataJud (CNJ) — hipótese NÃO verificada

O DataJud é a Base Nacional de Dados do Poder Judiciário. API pública gratuita,
baseada em **Elasticsearch**, com **um índice por tribunal**
(`api-publica.datajud.cnj.jus.br/api_publica_{tribunal}/_search`), consultada
por POST com query DSL — o que em tese permite `range` sobre valor da causa e
filtro por código de assunto, exatamente o recorte que falta no Escavador.

**Não foi possível verificar o schema nesta sessão.** O domínio responde 403 no
CONNECT do proxy de egress deste ambiente, e `datajud-wiki.cnj.jus.br`,
`www.cnj.jus.br` e o suporte do Escavador também estão bloqueados. As fontes
secundárias **se contradizem** sobre a API devolver ou não nome de partes e de
advogados: a Portaria CNJ 160/2020 fala em resguardo de dados das partes, mas
há material de terceiros afirmando que os nomes vêm.

**Antes de codar contra o DataJud, medir:** uma única query de sondagem num
tribunal trabalhista (ex.: `api_publica_trt2`) e listar as chaves reais do
`_source`. Confirmar em especial: existe `valorCausa`? existe `assuntos[]` com
`codigo`/`nome`? vêm partes/advogados? Sem isso, qualquer integração é chute.

Se o DataJud entregar assunto + valor, o desenho vira: **DataJud faz o recorte
global** (grátis) → **Escavador resolve as partes/advogados por CNJ** (pago,
só nos processos que passaram no filtro). Isso derruba muito o custo de API em
relação a varrer OAB por OAB.

---

## 4. Códigos de assunto da TPU/CNJ

`CODIGOS_ASSUNTO_ACIDENTE` em `_shared/prospeccaoAcidenteTrabalho.ts` está
**vazio de propósito**. Não foi possível consultar a tabela oficial nesta
sessão (egress bloqueado), e chutar código de assunto produz filtro
silenciosamente errado. O filtro atual é por texto normalizado.

Quando a tabela for confirmada, preencher a constante — o filtro por código é
mais preciso que por texto, e é o que o DataJud provavelmente exige.

---

## 5. O que já existe e está verde

`supabase/functions/_shared/prospeccaoAcidenteTrabalho.ts` — módulo puro, sem
I/O, testado por `src/lib/__tests__/prospeccaoAcidenteTrabalho.test.ts`:

- `isAssuntoAcidenteTrabalho()` — acidente de trabalho/do trabalho/trajeto,
  doença ocupacional/profissional. **Não** casa acidente de trânsito nem DPVAT,
  e assunto genérico trabalhista (horas extras, insalubridade) não entra.
- `parseValorCausa()` — aguenta os dois formatos que a API mistura no mesmo
  objeto: `valor: "1500000.00"` (ponto decimal) e
  `valor_formatado: "R$ 1.500.000,00"` (ponto de milhar). Parser ingênuo que só
  remove ponto transforma o primeiro em 150 milhões — 100x maior — e faz
  qualquer piso passar. Há teste travando exatamente isso.
  Valor ausente/ilegível vira `null`, nunca `0`.
- `extrairAdvogadosPoloAtivo()` — só o polo ativo (quem sofreu o acidente), com
  dedupe por OAB. O advogado da ré não interessa.
- `filtrarCandidatos()` — aplica assunto + piso de valor, e devolve os
  contadores `semValor` e `foraDoAssunto` para o descarte não sumir calado.

---

## 6. Pendências antes de disparar qualquer mensagem

Nada disso é opcional — os três primeiros são do próprio CLAUDE.md:

1. **Base legal LGPD** registrada por prospect (legítimo interesse em contato
   profissional B2B), com finalidade declarada.
2. **Descadastro em um clique** e lista de supressão respeitada no disparo.
3. **Remetente identificado** (razão social, CNPJ, endereço).
4. **CET declarado** — anunciar crédito só com a taxa ("Selic + 2% a.m.") não
   atende o CDC art. 52. Precisa do Custo Efetivo Total.
5. **Nada de afirmar crédito já aprovado** para quem não pediu e não passou por
   análise. Oferta é oferta: "linha de até R$ 10 mil, análise em 24h", sujeita
   a aprovação. Afirmar liberação prévia é publicidade enganosa (CDC art. 37).

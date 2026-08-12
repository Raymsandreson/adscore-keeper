---
name: marcos-pop-e-captura
description: Use SEMPRE que a tarefa envolver marcos processuais, fases de POP, jurimetria, valor de carteira, ou a captura automática (e-mail push, DataJud, Escavador). Guarda as três armadilhas que já custaram caro — número inflado 2,6x, estado virando fase e cron que falha em silêncio. Acione ao ouvir "marco", "fase do POP", "jurimetria", "carteira", "quanto vale", "Escavador", "DataJud", "push", "atualização de processo", "movimentação".
---

# Marcos, POP e captura automática

Metáfora: o **marco** é a placa de quilometragem da estrada — diz onde o processo está.
O **POP** é o manual de bordo — diz o que a equipe faz naquele trecho. Desde ago/2026 são
a mesma coisa: cada fase do POP É um marco. A **captura** é quem lê as placas por nós.

---

## 1. Marco é fase. Estado não é marco.

Regra do usuário, literal: *"marco pela etimologia da palavra não pode ser um estado"*.

| Isto é fase (marco) | Isto é estado (resultado) |
|---|---|
| Ajuizamento, Audiência inicial, Perícia, Sentença, Recurso, TST, Execução, Alvará, Arquivamento | **Acordo homologado**, **Suspensão** |

Estado ganha `atravessa_fases = true` e **nunca** entra no cálculo da fase atual.

```sql
-- certo: fase atual ignora quem atravessa
where not atravessa_fases
order by cnj_num, ordem desc, data_detectada desc
```

**Por que importa:** Acordo (ordem 26) e Suspensão (27) têm a maior ordem da régua. Como
"maior ordem vence", eles apareciam como fase atual de **61 processos**, escondendo onde
esses processos estavam de verdade. Acordo homologado no TST não põe o processo numa fase
"acordo" — ele continua no TST, com um acordo. Viraram coluna (`tem_acordo`, `suspenso`).

### O que mais mudou junto
- "Status possíveis do POP" → **"Resultados possíveis do POP"**, e cada resultado pode
  declarar `estagio` financeiro próprio. Sem isso, Indeferido/Extinto/Desistido eram
  carimbados como CONDENAÇÃO — os quatro compartilham trânsito em julgado.
- "Instrução e Julgamento" se parte em três: Perícia, Audiência de instrução, Sentença.
- Todas as fases ficam visíveis sempre.
- **Responsável em cascata** — `src/lib/popResponsavel.ts`: passo → objetivo → fase →
  processo. Definir no nível de cima vale para tudo abaixo sem responsável próprio.
- **Prazo por passo** — `src/lib/popPrazo.ts`: dias úteis, dias corridos ou meses.
  Feriado **não** é considerado; está declarado no arquivo.

Tabelas: `pop_marcos`, `pop_marco_sinais` (Externo). POP de referência: board
`Trabalhistas judicial — marcos (rascunho)`.

**Pendente:** migrar os 703 checklists com trabalho já feito para as fases-marco. Plano em
`supabase/migrations-external/PLANO_20260808_migrar_checklists_para_fase_marco.sql` — o
prefixo `PLANO_` existe para **não** rodar sozinho.

---

## 2. Nunca some `jm_valores` direto

`jm_valores` tem **uma linha por (decisão × cliente)**. Cada decisão que confirma o valor
cria linha nova para a mesma pessoa — MARIA aparece com R$ 550.000 na sentença e mais
R$ 550.000 nos embargos. É o mesmo dinheiro, dito duas vezes.

```
soma bruta ....................... R$ 83.228.467
última decisão de cada cliente ... R$ 31.622.209   ← o número certo
```

**2,6x inflado, e para cima** — o pior lado para número que vai a relatório de fundo.

```sql
-- sempre assim
select distinct on (v.processo_cnj, v.cliente) ...
  order by v.processo_cnj, v.cliente, d.data_decisao desc nulls last
```

O join com `lead_processes` duplica de novo (26 números repetidos, um deles 4×) — também
pede `DISTINCT ON`. Granularidade é **(processo × cliente)** por litisconsórcio: ao
agrupar, processos contam distintos e valores somam.

**Limite conhecido:** o número é "quanto o processo vale", **não** "quanto entra no caixa"
— não separa cota do cliente de honorário do escritório. Ao apresentar, diga isso.

Tela: `src/pages/CarteiraPorFasePage.tsx` · view: `vw_pop_carteira_por_fase`.

---

## 3. A cadeia de captura, na ordem

```
e-mail push  →  DataJud  →  Escavador
(quem mexeu)    (o que      (o documento,
                mudou, e     só de quem
                se tem doc)  tem)
```

| Fonte | Custo | Tempo real? | Traz |
|---|---|---|---|
| E-mail push (Gmail) | zero | sim | o **gatilho**: quem teve movimentação |
| DataJud (CNJ) | zero | **não** — piso de 8 dias | código TPU da movimentação |
| Escavador | R$ 0,20 público | sim | o documento em si |

Não são redundantes: o DataJud dá o código de graça, o Escavador dá o documento e o tempo
real. Roda **uma vez por dia à meia-noite BRT** = `0 3 * * *` no cron (o servidor é UTC).

### "O DataJud é necessário, se nem tempo real ele é?"

Pergunta recorrente do usuário. Resposta medida em 12/08/2026, para não responder de
memória na próxima vez:

```
atraso do DataJud (317 processos, último movimento de cada um)
  mínimo em toda a base ......  8 dias
  mediana ....................  64 dias
  com movimento de até 8 dias ... 1 de 317
```

Ele não está na cadeia para **avisar** — está para **classificar**. É a única fonte com o
código TPU: `jm_movimentos` tem 39.244 linhas, **100% `fonte='datajud'`**, 39.082 com
código. E-mail chega em texto livre; Escavador devolve documento e estado, nenhum dos dois
traz o código. Cruzando com a carteira de 344 processos:

| marco veio de | processos |
|---|---|
| código TPU (DataJud) | 317 |
| documento + IA (Escavador) | 27 (26 sobrepostos) |
| **só existe por causa do DataJud** | **291** |

Ressalva ao citar esse corte: o Escavador tem documento em 219 processos mas a IA só leu
71 (`pop_marco_extracoes`) — a rota do documento está subutilizada, não esgotada. Ainda
assim 125 processos não têm documento nenhum, e leitura por IA custa token por documento
enquanto o DataJud custa zero. **Desligar o DataJud não economiza nada e cega a régua.**

Painel: `CapturaStatusPanel` no sino, view `vw_jm_captura_status`. O gasto exibido não é
estimativa — vem de `jm_esc_solicitacoes.creditos`, o que a própria API devolve.

A ordem das barras é a da cadeia (e-mail → DataJud → Escavador), e quem manda nela é a
constante `ORDEM_DA_CADEIA` no componente: a view é `UNION ALL` **sem `ORDER BY`**, então
a ordem que ela devolve é a de escrita (o pago em cima) e não é garantida. Ler de cima
para baixo tem que ser ler o funil.

Desde 12/08/2026 o painel **vem recolhido**: as três barras comiam um terço da tela do
celular antes da primeira movimentação aparecer. Abre no clique do título e a escolha fica
salva em `localStorage['jm.captura-status.aberto']`, por navegador. Fechado, a barra ainda
diz `· N na fila` ou, havendo falha, `⚠ N com erro` em âmbar — esse resumo é o que impede
o painel de virar decoração: fila parada não avisa sozinha, foi o que custou o mês entre
09/07 e 11/08. Se um dia mexer nesse componente, mantenha o resumo da barra fechada.

### O que o card do sino escreve embaixo do processo

`process_updates.descricao` mistura duas naturezas, e quem for mexer no card precisa saber
separar (`resumoMovimentacao.ts`, com teste dos padrões reais):

| Natureza | Exemplo | No card |
|---|---|---|
| Teor do tribunal | `Distribuído por sorteio`, `Proferido despacho de mero expediente` | assunto, em destaque |
| Ruído do push por e-mail | `[TRT15] [PUSH] Atualizações de Informações Processuais do Processo <CNJ>` | `aviso por e-mail · TRT15`, miúdo |

Medido em 12/08/2026 sobre os 30 dias anteriores: **327 com teor (67%) contra 161 de ruído
(33%)**. O assunto já existia na maioria dos cards — estava só com o mesmo peso visual do
lixo que repetia o número do processo impresso duas linhas acima.

O que **não** dá para fazer: inventar assunto para as linhas de push. O texto TPU que teria
esse assunto está em `jm_movimentos.nome`, e em 12/08/2026 a tabela tinha 39.214 movimentos
mas o mais novo era de 03/08 — **nenhuma** das 73 atualizações da semana tinha movimento
casando com o dia. Antes de prometer "resumo da movimentação" a alguém, rode:

```sql
select max(data_hora)::date as movimento_mais_novo, count(distinct processo_cnj) as processos
from jm_movimentos;
```

### Armadilha: o feed do sino ordenado por `created_at`

`useProcessUpdates` busca as **100 mais recentes** (`FETCH_LIMIT`). Enquanto essa ordem foi
`created_at desc`, o backfill do Escavador/DataJud — que insere linha **nova** com
movimentação **velha** — tomava as 100 vagas e empurrava o que era do dia para fora.

Em 12/08/2026 o banco tinha 22 movimentações do dia e 26 do dia anterior; o sino carregava
**3 e 0**, e o filtro "Hoje" abria com 3 cards sem nenhum erro em log:

```sql
-- o que o sino REALMENTE carrega vs. o que existe: rode os dois e compare
with carregadas as (
  select coalesce(data_movimentacao::date, created_at::date) as dia
  from process_updates order by data_movimentacao desc nulls last, created_at desc limit 100
)
select count(*) filter (where dia = current_date) as hoje,
       count(*) filter (where dia = current_date - 1) as ontem from carregadas;

select count(*) filter (where coalesce(data_movimentacao::date, created_at::date) = current_date) as hoje,
       count(*) filter (where coalesce(data_movimentacao::date, created_at::date) = current_date - 1) as ontem
from process_updates;
```

A ordem agora é `data_movimentacao desc nulls last, created_at desc` — a mesma data que o
card mostra e que o filtro de período lê. Regra geral: **ordenar pela data do fato, não pela
data da linha**, sempre que houver backfill alimentando a tabela.

Consequência que fica: Hoje, Ontem e 7 dias cabem nas 100 e os chips são exatos; 30 dias
(488) e Tudo (2334) não cabem e aparecem como `100+`. Se um dia precisar do número exato
desses dois, é contagem agregada no servidor — não adianta subir o `FETCH_LIMIT`, que
engorda também as queries `in(ids)` de leitura e de notificação.

### Armadilha: cron que falha em silêncio

A URL certa do Railway é **`adscore-keeper-production.up.railway.app`**. Vários crons
antigos nasceram com `adscore-railway-production` (não existe) e levavam 404
`Application not found` a cada disparo — por duas semanas, sem uma linha de log.

Motivo: `net.http_post` só **enfileira** a chamada. Ninguém lê `net._http_response`. O
erro volta para o vazio.

```sql
-- diagnóstico: dispare na mão e LEIA a resposta pelo id retornado
select net.http_post(url := '...', headers := '...', body := '{}'::jsonb);  -- devolve id
select status_code, left(content::text, 400) from net._http_response where id = <id>;
```

Sintoma: painel do sino com **zero em todas as filas** enquanto o Gmail recebe dezenas de
push por dia. Antes de suspeitar de token vencido ou edge não deployada, cheque a URL.

`net._http_response` também **expira em ~6h** — resposta perdida trava a fila para sempre.

**Pendente:** a caixa administrativa (`inbox#3` — INSS, MPT, relatórios de investigação de
acidente) tem `body_text` preenchido, mas nenhuma IA lê esse texto. Nenhum POP
administrativo tem marco cadastrado; o tipo `'texto'` em `pop_marco_sinais` foi criado
para isso e está vazio.

---

## Checklist antes de entregar

- [ ] Marco novo que é estado ganhou `atravessa_fases = true`?
- [ ] Toda soma de valor passa por `distinct on (processo_cnj, cliente)`?
- [ ] Ao mostrar dinheiro, ficou claro que é valor do processo e não caixa do escritório?
- [ ] Cron novo: a URL foi conferida disparando e **lendo** `net._http_response`?
- [ ] Código TPU: 237/238/239 é provimento em 2º grau. 219/220/221 é procedência, **só G1**.
- [ ] Audiência só conta com complemento `realizada` — designada não é marco (840
      designadas vs 526 realizadas; contar designação dava mediana de 7 dias).

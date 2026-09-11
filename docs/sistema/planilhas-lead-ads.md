# Planilhas de Lead Ads → funil

Como o lead pago da Meta sai do formulário e vira card no Kanban.

## O caminho

```
Meta Lead Ads  →  Google Sheets (integração da Meta, 1 aba por atendente)
                        ↓  bpc-sheet-sync (Railway, cron 10 min)
                  leads no board, primeira etapa
```

Não há App Script nem webhook no meio: a Meta escreve direto na planilha, e o
Railway lê a planilha. Quem lê é `railway-server/src/functions/bpc-sheet-sync.ts`,
pelo gateway `connector-gateway.lovable.dev/google_sheets/v4`
(`LOVABLE_API_KEY` + `GOOGLE_SHEETS_API_KEY`, ambos só no Railway).

## Configuração: fica no board, não no código

Duas colunas de `kanban_boards` (Supabase Externo):

| Coluna | Papel |
|---|---|
| `sheet_source_url` | URL da planilha do Google. O id é extraído da própria URL. |
| `sheet_enabled` | Entra ou não na varredura do cron. |

Board novo passa a ser sincronizado **só de preencher essas duas colunas**. Não
se mexe em código para adicionar funil.

Até 04/09/2026 o id da planilha era uma constante no arquivo e o `board_id`
recebido só escolhia **onde gravar**: chamar a função com o board "Acidente de
Trabalho" lia a planilha do BPC assim mesmo, e teria criado centenas de leads no
funil errado. Fonte e destino agora saem da mesma linha do banco.

## Abas: match por palavra-chave

Cada aba é de um atendente. O vínculo é por **palavra-chave contida no nome**
(`OPERATOR_KEYWORDS`), não por nome exato — `EDILAN`, `EDILAN - 2` e
`LEADS EDILAN` caem todas em "Edilan". Renomear aba não quebra.

Aba cujo nome não contém nenhuma palavra-chave conhecida volta em
`abas_ignoradas` na resposta e vira `console.warn` no cron. **Atendente novo
precisa de palavra-chave nova**, senão os leads dele ficam de fora — e antes de
04/09/2026 ficavam em silêncio absoluto.

`linhas_por_aba` traz, por aba, quantas linhas ela tem, quantas caem na janela e
quantas virariam lead. É o que denuncia aba que voltou vazia por renome,
permissão ou range errado — o total geral sozinho não denuncia.

## Como chamar

```jsonc
// Um board (aceita spreadsheet_id para testar outra planilha sem gravar nada)
{"board_id": "...", "since_days": 30, "dry_run": true}

// Varredura: todo board com sheet_enabled = true, cada um na planilha dele.
// É como o cron chama. Aqui spreadsheet_id é recusado de propósito.
{"since_days": 7, "dry_run": false}
```

Endpoint: `POST /functions/bpc-sheet-sync` no Railway.

## O que o import grava

Além de nome e telefone, cada linha carrega a atribuição do anúncio, e ela vai
para as **colunas** de `leads`, não para o texto de `notes`:

| Coluna em `leads` | Coluna na planilha |
|---|---|
| `facebook_lead_id` | `id`, **sem o prefixo `l:`** (ver abaixo) |
| `campaign_id` / `campaign_name` | idem |
| `adset_id` / `adset_name` | idem |
| `ad_name` | idem |

Campo ausente na planilha entra como `NULL`, não como string vazia — senão "tem
valor" e "é vazio" viram a mesma coisa na hora de medir.

O `facebook_lead_id` é o que destrava otimizar por **lead qualificado**
(Conversion Leads): é por ele que a Meta casa o fechamento no CRM com o
formulário que originou o lead. Até 04/09/2026 essa coluna estava vazia em
19.420 de 19.420 leads, porque o import jogava o id dentro de `notes` como
texto solto.

**O `id` vem com prefixo.** A exportação de Lead Ads escreve
`l:1009263962139850`; a Conversion Leads API espera o número puro de 15-17
dígitos. Id com prefixo é o mesmo que id nenhum, e falha **do lado da Meta**,
sem erro deste lado. Quem tira é `normalizaLeadIdMeta`
(`railway-server/src/lib/leadAdsSheet.ts`, com teste). Descoberto em
04/09/2026 depois de 131 linhas já gravadas com prefixo — o que denunciou foi
olhar o dado no banco (`length = 18`), não o import, que não reclamou de nada.

`colunas_da_planilha` no `dry_run` lista os cabeçalhos vistos: é o que permite
afirmar de qual coluna veio cada campo, e denuncia renome de coluna pela Meta
antes de virar coluna nula no banco.

## Dedup

Duas camadas, ambas pelos **últimos 8 dígitos do telefone**:

1. dentro da planilha (o mesmo telefone aparece em abas diferentes);
2. contra os leads já existentes **naquele board**.

Por isso a função é idempotente: rodar de novo não duplica, e uma rodada perdida
é recuperada pela seguinte enquanto o lead estiver dentro da janela.

### A armadilha das 1000 linhas (corrigida em 04/09/2026)

A consulta dos leads já existentes **não paginava**. O PostgREST corta em 1000
linhas por request, e o board BPC tem **7.255 leads com telefone**: o dedup
conhecia 14% deles. Com o cron ligado, quem ficasse fora dessas 1000 seria
recriado a cada 10 minutos, para sempre — o lead novo também não entraria nas
primeiras 1000, então nem a rodada seguinte se corrigiria.

Nunca chegou a acontecer: a janela de 7 dias do BPC estava vazia quando o cron
foi ligado. Foi achado medindo, não por sintoma.

O conserto pagina com `.range()` e `.order('id')` — sem ordem estável a
paginação pula e repete linhas. A resposta agora traz `dedup_leads_lidos` e
`dedup_telefones_conhecidos`: **se `dedup_leads_lidos` vier redondo em 1000 num
board maior que isso, a paginação quebrou de novo.**

## O cron

`runSheetLeadSync` em `railway-server/src/index.ts`, a cada 10 min, janela de 7
dias, via loopback autenticado (`x-internal-key`).

**Ligado em 04/09/2026.** Conferir de fora, sem log do Railway:

```
curl -s https://adscore-keeper-production.up.railway.app/health | jq .sheet_lead_sync
{ "ligado": true, "execucoes": 3, "ultima_em": "...", "ultimo_resultado": "criados=0 boards=3 falhas=0", "criados_acumulado": 0 }
```

Esse bloco existe porque **o banco não prova que o cron está vivo**: com a janela
já importada, uma rodada correta cria zero leads e não deixa rastro nenhum.
"ligado" e "morto" ficavam indistinguíveis — foi assim que 4 jobs do pg_cron do
Externo rodaram para nada por meses. `ultima_em` é gravado antes do `await`, para
que uma rodada travada apareça como travada, e não como ausente.

**Sai desligado.** Ligar é `SHEET_LEAD_SYNC=on` nas env vars do Railway. O gate
existe porque a primeira rodada não importa "os leads novos" — importa tudo que
está na janela e nunca entrou, e isso é um lote grande caindo de uma vez num
funil ativo. Desligar de volta: tirar a env var e reiniciar; nada se perde.

## Por que isso existe (04/09/2026)

`bpc-sheet-sync` estava escrita e **nunca teve quem a chamasse** — não estava em
nenhum job do pg_cron do Externo nem em `setInterval` nenhum. Estado encontrado:

| Planilha | Linhas | Últimos 30 dias | Já no board |
|---|---:|---:|---:|
| BPC (`1euH1VO4…`) | 399 | 103 | **0** |
| Auxílio Acidente (`1nzKZsew…`) | 532 | 532 | **0** |

620 pessoas que preencheram formulário pago em 30 dias, nenhuma no CRM. Os
boards ainda apontavam para planilhas antigas, trocadas pelo gestor de tráfego
sem que o sistema soubesse.

Dois achados da primeira varredura:

- **BPC não recebe lead há mais de 7 dias** (399 linhas, 0 na janela de 7 dias).
  As 103 recentes são todas do começo de agosto. A campanha parou, ou a
  integração Meta→planilha parou daquele lado.
- **O board "Acidente de Trabalho" apontava para uma planilha que não é de Lead
  Ads**: `1tJkiZ133…`, com abas `C. PREV`, `Agenda Visitas`, `TRIAGEM`,
  `ASS SOCIAL`, `TRÁFEGO`, `FONE`, `Gasolina deslocamento`. Nenhuma casa com
  palavra-chave de atendente, então lê 0 linhas — mas basta uma aba passar a se
  chamar "MATEUS" para entrar lixo no funil.

## O import lia 379 de 3.297 linhas (09/09/2026)

Eu havia concluído que "a integração Meta → Planilha morreu em agosto", porque o
BPC lia **379 linhas e 0 recentes**. Estava errado: **a planilha sempre esteve
sendo alimentada**. Quem estava quebrado era o leitor.

| | antes | depois |
|---|---:|---:|
| Linhas lidas | 379 | **2.171** |
| Recentes (30 dias) | **0** | **1.733** |

Duas causas independentes, as duas silenciosas:

### 1. Nome e telefone trocados de coluna (1.828 linhas)

A mesma aba acumula exportações de **duas versões do formulário**, com a ordem
das colunas invertida entre elas. O cabeçalho é o da primeira versão, então as
linhas da segunda traziam o telefone na coluna que se lia como `full_name`. O
descarte aparecia como "nome inválido" — 1.851 linhas reprovadas pela regra
"não tem uma única letra". Eram telefones.

Dá para ver a olho na aba `MATEUS - 2`, cuja primeira linha de dados é lida como
cabeçalho: índice 19 = `4299685755`, índice 20 = `evelin iasmin castilho`.

**Conserto sem adivinhação:** o nome é o candidato **que tem letra**, o telefone
é o candidato **que tem dígito**. Se as duas células se desmentirem, a troca é
inequívoca; se nenhuma servir, a linha cai como antes. `recuperadas_por_troca`
por aba mostra quantas foram recuperadas.

### 2. Aba sem linha de cabeçalho (802 linhas, AINDA ABERTO)

`MATEUS - 2` (766 linhas) e `KAROLYNE` (36) **não têm linha de cabeçalho**: a
primeira linha já é dado, e vira "cabeçalho" com nomes como
`l:1086829373844173`. Todo o resto é lido deslocado e nada se aproveita.

Isso **não** se conserta por heurística: adivinhar qual coluna é o nome pode
trazer `qual_o_nome_da_criança_?` no lugar do responsável. O conserto é inserir a
linha de cabeçalho na planilha — ou ler esses formulários pela API da Meta
(`meta-leads-sync`), que não depende de formatação nenhuma.

### O que impedia de ver isso

`total_rows_in_sheet` contava linhas **depois** do descarte, e o descarte não
aparecia em lugar nenhum. Agora cada aba devolve `brutas`,
`descartadas_sem_nome`, `descartadas_sem_telefone`, `recuperadas_por_troca`, o
próprio `cabecalho` e um **ALERTA** quando lê linhas e aproveita zero.

**Regra que fica:** aba que lê linha e aproveita zero é bug, nunca "não tem lead
novo". Os dois números têm que ser mostrados juntos.

## Limites conhecidos

- **Cota do Sheets**: ler duas planilhas em sequência já devolveu HTTP 429
  ("Read requests per minute"). A varredura espaça 5s entre boards e 300ms entre
  trios de abas. Board que caiu no 429 volta na rodada seguinte.
- **Range fixo** `A1:Z5000` por aba: aba com mais de 5000 linhas é truncada em
  silêncio.
- **Linha sem telefone com 10+ dígitos ou com nome-lixo é descartada** sem
  aparecer em lugar nenhum da resposta.
- A planilha é a única fonte: se a integração Meta→Sheets cair, o CRM seca e
  nada aqui denuncia — só a comparação com o gasto no Gerenciador de Anúncios.

## O cabeçalho é procurado, não assumido (11/09/2026)

A exportação da Meta para o Sheets não garante que a primeira linha seja o
cabeçalho. Basta alguém inserir uma linha ou colar um registro no topo.

Medido na planilha do BPC:

| Aba | Defeito | Custo |
|---|---|---|
| `MATEUS - 2` | lead na linha 1, cabeçalho na linha 2 | 874 linhas descartadas |
| `KAROLYNE` | mesmo defeito | 36 linhas |
| `KAROL - 2` | cabeçalho na linha 1, mas célula A1 vazia | ids da Meta não carregavam, e o status escrito pela equipe não casava com lead nenhum |

Comparado com o que a Meta tem em 30 dias, isso deixava o BPC **893 leads atrás**
— 793 só do Mateus.

### Por que não foi resolvido pedindo para editar a planilha

Seria transferir para a pessoa um trabalho que o programa faz melhor, e falharia
calado de novo no dia em que ninguém lembrasse. `achaCabecalho`
(`lib/leadAdsSheet.ts`, puro e com teste) procura entre as primeiras linhas a que
mais parece cabeçalho — a que traz mais nomes de coluna conhecidos da Meta. Se
nenhuma parecer, cai na primeira linha, o comportamento antigo, para que aba com
nomes inesperados não fique pior do que já era.

**A linha acima do cabeçalho não é descartada.** Ela é um lead de verdade: o da
`MATEUS - 2` já estava no CRM pela leitura direta da Meta, mas o da `KAROLYNE`
(de 06/07) não estava em lugar nenhum — apagá-la para "consertar" a aba teria
perdido o registro.

**A primeira coluna sem rótulo vira `id`** quando as linhas de baixo guardam ids
da Meta (`l:1086829373844173` ou só os dígitos). É evidência, não chute: coluna
sem nome que guarda outra coisa continua sem nome.

O diagnóstico por aba agora informa `linha_do_cabecalho` e `id_recuperado`, então
dá para ver que alguém colou dado no topo sem abrir a planilha.

## A conta fechada: planilha × Meta (11/09/2026)

O diagnóstico por aba agora devolve `brutas_na_janela` — linhas cuja data cai no
período, contadas **antes** de qualquer descarte. Com ela a diferença para a Meta
se separa em duas causas que pedem conserto em lugares diferentes:

```
Meta − brutas_na_janela      = a planilha não recebeu   (conserto na Meta/export)
brutas_na_janela − recentes  = este leitor recusou      (conserto aqui)
```

BPC, 30 dias:

| | Meta | Planilha tem | Não recebeu | Leitor recusou | Entra |
|---|---:|---:|---:|---:|---:|
| Israel | 694 | 690 | 4 | 36 | 654 |
| Mateus | 793 | 782 | 11 | 27 | 755 |
| Karolyne | 619 | 616 | 3 | 28 | 588 |
| Edilan | 516 | 512 | 4 | 23 | 489 |
| **Total** | **2.623** | **2.600** | **23** | **114** | **2.486** |

Auxílio Acidente: 592 → 588 → 4 recusadas → 584.

**A planilha está de acordo com a Meta**: recebe 99,1% do que a Meta exporta. O
resíduo é quase todo do lado de cá.

### As 220 do Edilan eram antigas

A aba EDILAN tem 226 linhas descartadas por nome vazio na vida inteira, mas só
**8** caem na janela de 30 dias. Não é um problema corrente — é um lote velho.

### O que o leitor recusa é quase tudo "sem telefone"

E parte disso era nome de coluna. A planilha do Auxílio Acidente tem
`qual_o_seu_número_para_contato_?` e o leitor procurava
`qual_o_seu_número_de_contato_?`. Uma palavra, e a linha caía como sem telefone.

`celulaDeTelefone` (`lib/leadAdsSheet.ts`, com teste) passa a procurar por
**pedaço** do nome da coluna — `telefone`, `contato`, `whats`, `phone`,
`celular` — aceitando só valor com 10+ dígitos, para que "melhor horário de
contato" não entregue texto no lugar do número. É a mesma regra que o
`meta-leads-sync` já usava, e por isso ele não sofria do problema.

**O nome não ganhou busca por pedaço**, de propósito: o formulário do BPC
pergunta `qual_o_nome_da_criança_?`, e procurar "nome" por pedaço cadastraria o
dependente no lugar do titular. Trocar o cliente por outra pessoa é pior do que
não achar o campo.

## Telefone é exigência de criar, não de identificar (11/09/2026)

As 114 linhas que o leitor recusava por mês não eram lead perdido. O
`meta-leads-sync` lê as mesmas da Meta, onde o telefone pré-preenchido está
completo, e cria o lead. O que se perdia era o **status que a equipe escreveu**:
a linha morria no parse, antes da etapa que aplica status — carregando um
`facebook_lead_id` que identifica o lead com exatidão.

Agora a linha sem telefone usável **sobrevive marcada** (`sem_telefone_usavel`)
quando tem id da Meta. Sem o id, cai como antes: não há por onde reconhecê-la.

Três travas para que isso não vire outro problema:

1. **Nunca vira lead novo.** Sem telefone não há como falar com a pessoa, e o
   `phone_key` vazio não casa com nada em `existingKeys` — sem a trava explícita
   elas seriam criadas como leads mudos, duplicando quem já está no CRM.
2. **Dedup pelo id.** Com `phone_key` vazio, todas as linhas sem telefone
   colidiriam numa só e 113 sumiriam de novo, desta vez sem aparecer em contador
   nenhum.
3. **DDD não se inventa.** Os 45 casos de 9 dígitos são celular sem código de
   área; completar por conta própria mandaria mensagem de cliente para o número
   de outra pessoa (ver a skill `grupo-incerto-nao-manda-avisa`).

O diagnóstico por aba informa `recuperadas_para_status`, e o contador de descarte
passou a subir só quando a linha morre de verdade.

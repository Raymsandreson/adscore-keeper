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
| `facebook_lead_id` | `id` (o Meta Lead ID, 15-17 dígitos) |
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

`colunas_da_planilha` no `dry_run` lista os cabeçalhos vistos: é o que permite
afirmar de qual coluna veio cada campo, e denuncia renome de coluna pela Meta
antes de virar coluna nula no banco.

## Dedup

Duas camadas, ambas pelos **últimos 8 dígitos do telefone**:

1. dentro da planilha (o mesmo telefone aparece em abas diferentes);
2. contra os leads já existentes **naquele board**.

Por isso a função é idempotente: rodar de novo não duplica, e uma rodada perdida
é recuperada pela seguinte enquanto o lead estiver dentro da janela.

## O cron

`runSheetLeadSync` em `railway-server/src/index.ts`, a cada 10 min, janela de 7
dias, via loopback autenticado (`x-internal-key`).

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

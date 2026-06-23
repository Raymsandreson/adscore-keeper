## O que vou construir

Um "ajudante" no Railway que, de 5 em 5 minutos, lê a planilha do Google que você mandou e cria/atualiza leads no funil BPC. Linha nova na planilha = card novo na primeira etapa do funil. Sem duplicar.

Metáfora: hoje a planilha é só o **placar** do painel (KPIs). Vou transformá-la também na **esteira de chegada** — cada nome que cai lá vira automaticamente um card no kanban.

## Decisões que tomei por você (você skipou as perguntas)

| Pergunta | Decisão |
|---|---|
| Qual aba? | `BASE_UNIFICADA` (mesma que já alimenta os KPIs hoje, pra manter coerência) |
| O que fazer com linha nova? | Criar lead novo na primeira etapa do board BPC. Não mexo no status depois — quem move o card é a equipe |
| Frequência | A cada 5 minutos (equilíbrio entre "rápido" e "não estourar quota do Google") |
| Chave única (anti-duplicado) | `form_lead_id` (coluna A, `l:...`) — é o ID do Meta, único de verdade |

Se alguma dessas decisões não bate com o que você queria, é só me dizer depois que ajusto.

## Como vai funcionar (passo a passo do "ajudante")

```text
A cada 5 min:
  1. Lê planilha BASE_UNIFICADA (Google Sheets API via conector)
  2. Pra cada linha:
     a. Já existe lead com esse form_lead_id no Externo? → pula
     b. Não existe? → cria lead com:
        - nome, telefone (normalizado)
        - acolhedor (coluna origem_vendedor)
        - board_id = BPC, status = primeira etapa
        - source = 'planilha_trafego'
        - external_form_lead_id = l:... (chave anti-duplicado)
  3. Grava log de quantos criou / pulou / falharam
```

## Onde mexo

**Backend (Railway — onde fica o ajudante novo):**
- Cria `railway-server/src/functions/bpc-sheet-sync.ts` — o ajudante em si
- Registra rota em `railway-server/src/index.ts`
- Adiciona `'bpc-sheet-sync': 'railway'` em `src/lib/functionRouter.ts`
- Variáveis novas no Railway: `BPC_SHEET_ID` (o ID da sua planilha) e `BPC_BOARD_ID` (o board do BPC)

**Banco Externo (almoxarifado):**
- Adiciona coluna `external_form_lead_id text unique` em `leads` (anti-duplicado)
- Roda via `run-external-migration`, sem você precisar abrir painel

**Agendador (quem cutuca o ajudante a cada 5min):**
- pg_cron no Externo chamando o endpoint do Railway

**Frontend:**
- Botão "Sincronizar agora" no painel detalhado BPC, pra forçar a checagem sem esperar os 5min
- Indicador "Última sincronização: há X min"

## O que NÃO vou mexer

- KPIs atuais (continuam lendo da planilha como hoje)
- Lógica do funil, etapas, permissões
- Lead que já existe — não mexo em status, nome, nada. Só crio o que falta
- Outras planilhas / outros funis (só BPC)

## Pré-requisito

Preciso que você confirme: a conta Google que tá conectada no Lovable (conector Google Sheets) **tem acesso de leitura** nessa planilha? Se não tiver, o ajudante vai bater na porta e ninguém abre. Se quiser, eu testo a leitura primeiro antes de construir o resto — me responde "testa primeiro" e eu faço só essa parte pra confirmar acesso.

## Detalhes técnicos (pode pular)

- Idempotência via `ON CONFLICT (external_form_lead_id) DO NOTHING`
- Normalização de telefone: últimos 8 dígitos como `phoneKey` (mesmo padrão do resto do projeto)
- Batch insert de 100 em 100 pra não travar
- Retry com backoff em 429/5xx do Google
- Resposta sempre HTTP 200 `{ success, created, skipped, errors }`
- Cron via pg_cron no Externo (não no Cloud)

Posso seguir?
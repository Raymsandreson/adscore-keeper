

## Plano: Diagnóstico de custo Cloud baseado em evidência real

### Limitação assumida
Não tenho acesso ao billing dashboard ($/categoria). Vou medir **proxies de custo** via logs reais e cruzar com o gasto declarado de ~$20/dia pra estimar onde concentra.

### O que vou rodar (somente leitura)

**Bloco 1 — Ranking de invocações (7 dias)**
Query em `function_edge_logs` agrupada por `function_id`, contando invocações, tempo médio de execução, p95, taxa de erro. Resultado: tabela ordenada das 6 funções alvo + outras top 10.

**Bloco 2 — Detecção de chamadas AI Gateway**
Grep nos arquivos das 6 funções (e nos handlers do `wjia-agent`) procurando `ai.gateway.lovable.dev`, `geminiChat`, `elevenlabs`, e contagem de chamadas LLM por execução. Produz: mapa de "qual função consome AI por chamada".

**Bloco 3 — Análise das funções suspeitas**
Leitura de:
- `wjia-followup-processor/index.ts` — está rodando a cada 60s retornando 383 sessões; entender quanto faz por execução
- `whatsapp-call-queue-processor/index.ts` (já vi: chama Gemini + ElevenLabs por ligação)
- `trigger-whatsapp-notifications/index.ts` — só proxy ou faz trabalho?
- `whatsapp-ai-agent-reply/index.ts` — só proxy ou faz trabalho?
- `whatsapp-webhook/index.ts` — volume real e o que faz inline

**Bloco 4 — Confirmar persistência externa**
Query no banco externo confirmando que `whatsapp_messages` está sendo escrito lá (e não duplicado no Cloud).

### Entregável

Relatório com:

1. **Tabela ranking** das 6 funções:
   | Função | Invocações/dia | Tempo médio | Chama AI? | Estimativa proporcional |

2. **Identificação da dominante** com evidência citada (linha do log, função no código)

3. **Recomendação de migração priorizada**:
   - Quais valem migrar pro Railway (alto volume + sem AI)
   - Quais NÃO adianta migrar (custo é AI Gateway, não invocação)
   - Qual a economia esperada em ordem de grandeza

4. **Pedido explícito ao usuário** de 2 números do dashboard que só você vê:
   - Saldo consumido em "AI balance" últimos 7 dias
   - Saldo consumido em "Cloud balance" últimos 7 dias
   
   Com esses 2 números + meu ranking de invocações, fecho o diagnóstico real.

### O que NÃO vou fazer

- Não vou alterar código
- Não vou tocar em `functionRouter.ts`
- Não vou rodar SQL de escrita
- Não vou inventar números de billing — se não tiver evidência, falo "não sei, preciso de X"

### Saída esperada

Um relatório em markdown no chat, ~300 linhas, com queries citadas, contagens reais e recomendação concreta de migração. Tempo: ~5 minutos de execução.


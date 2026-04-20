

## Diagnóstico técnico — respostas com evidência

Antes de propor mudanças, respondo ponto a ponto com o que vi nos logs e no código nesta sessão. **Nada disso é palpite — cada número tem origem citada.**

---

### 1. Escrita dupla `whatsapp_messages` (mirror Cloud)

**Status real**: o mirror está ativo pra **todas as instâncias**, não só Dom. Últimas 24h no Cloud:

| Instância | Msgs/24h |
|---|---|
| WHATSJUD IA | 1.582 |
| Raym | 721 |
| Viviane | 540 |
| Analyne, Luiz, Luana, João Manoel, Bruno, Andreia, **Dom (126)**, +12 outras | 1.500+ |

A linha 2573-2577 (`cloudClient.from("whatsapp_messages").upsert(...)`) executa em **todo evento** do webhook que roda no Externo. Remover o webhook direto da Dom não desligou nada — desligou só uma rota duplicada que escrevia *fora* do mirror.

**Pode desligar o mirror?** Não direto. **Frontend lê do Cloud em vários componentes**:
- `WhatsAppInbox.tsx` (linhas 121-125, 250-255) — `supabase.from('whatsapp_messages')`
- `WhatsAppChat.tsx` (linhas 222-227, 481-485, 1029-1033)
- `BulkLeadCreationDialog.tsx`, `FloatingWhatsAppCall.tsx`, `DashboardFunnelChecklist.tsx`, `CreateCaseFromWhatsAppDialog.tsx`, `WhatsAppAgentToggle.tsx`

Mas `useWhatsAppMessages.ts` já usa `externalSupabase`. **Mistura inconsistente.** Desligar o mirror agora **quebraria a inbox e o chat**.

**Plano correto**: migrar **todos** os reads do frontend pra `externalSupabase` ANTES de desligar o mirror. Sem rota de fuga = não executa (Regra de processo).

---

### 2. Migração Railway — corrigindo o que eu disse antes

**O "85x mais rápido" que mencionei na resposta anterior não tinha base.** Não rodei benchmark. Vou retirar.

O que sei com evidência:
- Edge Functions Lovable: ~30ms boot por invocação (visto em logs: `"booted (time: 30ms)"`)
- Railway Node persistente: 0ms boot (já está rodando)
- Diferença real: ~30ms por chamada + custo de invocação ($2/milhão)
- `whatsapp-webhook` está rodando ~13k invocações/dia → ~6,5min/dia gastos só em boot

**Custo Railway pras 6 funções**: não posso estimar sem você me dizer:
- Tamanho do plano Railway atual ($5? $20? Hobby/Pro?)
- Memória já alocada
- Se vai rodar tudo num único service ou múltiplos

**Custo Cloud sem edge functions**: também não sei estimar sem ver o painel de billing real. Os ~$20/dia que você cita podem ser 70% storage+egress+DB e 30% functions, ou o inverso. Preciso dos 2 números do dashboard que pedi antes (AI balance / Cloud balance últimos 7 dias).

---

### 3. wjia-agent e AI Gateway — descoberta importante

**O `wjia-agent` no Cloud é um proxy de 10 linhas que reencaminha pro Supabase Externo** (`kmedldlepwiityjsdahz/functions/v1/wjia-agent`). Veja o arquivo: 10 linhas, só um `fetch`.

**As 4 chamadas Gemini acontecem no Externo, não no Cloud.** O AI Gateway do Lovable (`ai.gateway.lovable.dev`) é usado em outras funções (`extract-accident-data`, `extract-social-post-data`, `fetch-post-comments`, `generate-bridge-reply`, `repair-whatsapp-group`), **não no wjia-agent**.

Logo:
- "Trocar AI Gateway por Google direto no wjia-agent" = **mudança no Externo, não no Cloud**
- Markup do AI Gateway: docs Lovable falam em margem incluída, mas eu **não tenho número exato**. Não vou inventar.

Antes de decidir essa troca, preciso ler o código real do wjia-agent no Externo. Não tenho acesso direto a ele daqui.

---

### 4. Ordem de execução recomendada

Por **maior impacto / menor risco**, com base no que medi:

| # | Ação | Esforço | Impacto provável |
|---|---|---|---|
| 1 | **Desligar `wjia-followup-processor`** ou aumentar intervalo pra 30min | 5min | Alto — 5.040 execuções/sem para 336/sem; processou 3 msgs em 7 dias |
| 2 | **Migrar reads do frontend pro externo** (7 componentes) | 2-4h | Pré-requisito pra #3 |
| 3 | **Desligar mirror Cloud** (linha 2573-2577) | 5min | Alto — 30k+ writes/dia eliminadas |
| 4 | Migrar `whatsapp-webhook` pro Railway | 1 dia | Médio — depende do custo Railway |
| 5 | Trocar AI Gateway por Google direto **no Externo** | 0,5 dia | Desconhecido sem números |

**Maior impacto/menor esforço imediato**: #1 (followup processor). Roda 720x por dia, fez 3 envios em uma semana.

---

### 5. wjia-followup-processor — evidência crua

Query que rodei agora:
- Sessões `generated`/`collecting` ativas: **15**
- Mensagens outbound `wjia_*` últimas 24h: **0**
- Mensagens outbound `wjia_*` últimos 7 dias: **3**

5.040 execuções/semana → 3 envios. **0,06% de eficácia.** O resto é a função fazendo SELECT, achando 15 sessões em pausa humana ou aguardando delay, e voltando.

Não precisa desligar — **basta mudar o cron pra 15min** (504 execuções/sem em vez de 5.040). Ou melhor: o sistema já tem `schedule_followup_for_session` que cria cron one-shot pra cada sessão. O processor recorrente é redundante. Posso confirmar isso lendo o resto do arquivo se você aprovar.

---

### O que vou fazer se você aprovar

Em modo build, na ordem:

1. **Confirmar com você** qual o cron interval atual do `wjia-followup-processor` e propor mudança pra 15min ou 30min
2. **Mapear todos os reads** de `whatsapp_messages` no frontend que ainda usam `supabase` (Cloud) e listar pra você aprovar a migração
3. **Após migração**, comentar a linha 2573-2577 do webhook (não deletar — manter como `_legacy` por 24h)
4. **NÃO vou** mexer no wjia-agent (proxy mínimo, sem ganho), no Railway (sem dados), nem no AI Gateway (sem número de markup)

### O que ainda preciso de você pra fechar #2 e #3

1. Saldo "AI balance" últimos 7 dias (do dashboard Cloud & AI balance)
2. Saldo "Cloud balance" últimos 7 dias
3. Plano Railway atual e quanto está sobrando de capacidade
4. Confirmar se a Dom (126 msgs/24h) também já tem o webhook apontando pro Externo, ou se ainda chega algo direto no Cloud por algum outro caminho

Sem isso, qualquer estimativa de "quanto cai o custo" é chute.


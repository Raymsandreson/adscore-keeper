

# Migrar `whatsapp-call-queue-processor` pro Railway

## Objetivo
Tirar a função "discadora automática" do Lovable Cloud (que roda 1x/min = 1.440 invocações/dia) e colocá-la no `railway-server/`, mantendo **comportamento idêntico**.

## O que vai mudar (e o que NÃO vai mudar)

| Item | Antes | Depois |
|------|-------|--------|
| Onde roda | Lovable Cloud Edge Function | Railway (`railway-server/`) |
| Frequência | 1x/min via `pg_cron` | 1x/min via `pg_cron` (mesmo CRON, só muda a URL chamada) |
| Comportamento | Discadora pega próximo da fila, liga via UazAPI, gera áudio de follow-up | **Idêntico** |
| Custo Lovable | ~1.440 invocações/dia desta função | **0** invocações desta função |
| Custo Railway | Já pago fixo, sem aumento perceptível | Mesmo |

## Arquivos que vou criar/alterar

1. **`railway-server/src/functions/call-queue-processor.ts`** (novo) — porta exata da lógica da edge function. Mesma fila, mesma UazAPI, mesmo Gemini, mesmo ElevenLabs, mesmo upload pro Storage do Supabase externo.
2. **`railway-server/src/index.ts`** — registrar a rota `POST /functions/call-queue-processor` no `functionHandlers`.
3. **`railway-server/package.json`** — sem mudança (todas as deps já existem: `@supabase/supabase-js`, `express`).
4. **Migration SQL** (`supabase/migrations/...`) — atualizar o `pg_cron` job no Lovable Cloud:
   - **Desativar** o job atual que chama a edge function `whatsapp-call-queue-processor`.
   - **Criar** novo job (mesma frequência: `* * * * *`) que faz `net.http_post` para `https://[seu-railway].up.railway.app/functions/call-queue-processor` com header `x-api-key`.
5. **`supabase/functions/whatsapp-call-queue-processor/index.ts`** — manter por 24h como `_legacy` (rota dorminhoca que retorna 200 sem fazer nada) pra rollback rápido. **Não deletar agora** (Regra 4 do projeto).

## Variáveis de ambiente no Railway

Você precisa garantir que o Railway tem (provavelmente já tem, mas vou confirmar no momento da implementação):
- `EXTERNAL_SUPABASE_URL` ✅ (já configurado)
- `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` ✅ (já configurado)
- `LOVABLE_API_KEY` — pra chamar Gemini via `ai.gateway.lovable.dev` (talvez precise adicionar, te aviso)
- `ELEVENLABS_API_KEY` — pra gerar áudio de follow-up (talvez precise adicionar, te aviso)
- `RAILWAY_API_KEY` ✅ (já configurado, será usado pelo `pg_cron` no header)

Se faltar alguma, vou pedir pra você adicionar antes de ativar o CRON novo.

## Plano de rollback (Regra 1 do projeto)

Se algo quebrar:
1. Reverter a migration que troca o CRON (volto a apontar pra edge function antiga, que ainda existe intacta).
2. Tempo de rollback: <2 min via SQL.

## Validação pós-deploy

1. Aguardar 1 ciclo do CRON (~60s).
2. Conferir logs do Railway pra ver "Initiating call to..." aparecer.
3. Conferir tabela `whatsapp_call_queue` no Supabase externo: status mudando de `pending` → `calling` → `completed`.
4. Conferir 1 ligação real chegando no WhatsApp do contato de teste.
5. Conferir áudio de follow-up sendo enviado.

Só depois de validar essas 5 coisas, considero a migração concluída e te peço autorização pra deletar a edge function antiga (em 24h).

## O que você precisa fazer

1. **Aprovar este plano** (clicar em "Approve plan").
2. Quando eu terminar o código, fazer `git push` (Railway redeploya sozinho).
3. Se eu pedir, adicionar 1-2 env vars no painel do Railway (te dou o passo a passo).
4. Acompanhar comigo a validação pós-deploy.


## O que vai ser feito

Criar uma "secretária" que abre o Gmail conectado, lê só os e-mails do `noreply@inss.gov.br`, extrai **nº do protocolo, status, data do protocolo e beneficiário**, e preenche os processos em `lead_processes` na aba **INSS Administrativos** (`src/components/processes/InssAdminProcessesTab.tsx`).

Roda de dois jeitos: botão "Sincronizar Gmail" na própria aba + cron de hora em hora.

## Arquitetura (em metáfora)

```text
[Sua caixa Gmail] ──▶ [Ajudante no Railway] ──▶ [Tabela lead_processes no Externo]
       ▲                       │
       │                       ├── botão "Sincronizar" (aba INSS Adm)
       │                       └── relógio (pg_cron de hora em hora chama o ajudante)
       │
   conector Google Mail
   (já tá ligado, GOOGLE_MAIL_API_KEY)
```

## Passos

### 1. Ajudante Railway: `sync-inss-emails`
Arquivo `railway-server/src/functions/sync-inss-emails.ts` + registro em `index.ts` e `functionRouter.ts`.

O que faz:
1. Chama Gmail API via gateway Lovable (`connector-gateway.lovable.dev/google_mail/gmail/v1`) com query `from:noreply@inss.gov.br newer_than:30d` (configurável).
2. Para cada mensagem, baixa o corpo e roda extração:
   - **Regex primeiro** (padrões fixos: "Protocolo nº", "Beneficiário:", "Status:", "Data:"). Rápido e grátis.
   - **Fallback IA** (Lovable AI Gateway, `google/gemini-2.5-flash`) só se regex falhar — passa o texto e pede JSON estruturado.
3. Dedupe por `process_number` (chave natural do INSS).
4. UPSERT em `lead_processes`:
   - Se `process_number` já existe → atualiza `status`, `data_ultima_movimentacao`, `notes` (anexa snapshot do e-mail).
   - Se não existe → cria com `process_type='inss_administrativo'`, tenta vincular ao `lead_id` por nome do beneficiário (match em `leads.lead_name` por similaridade, `pg_trgm` já está instalado).
   - Se nenhum lead bater → cria com `lead_id=NULL` e aparece na aba como "órfão" pra você vincular manual.
5. Loga cada sync em nova tabela `inss_email_sync_log` (id, started_at, finished_at, emails_processed, processes_upserted, errors jsonb, triggered_by).
6. Retorna `{success: true, summary: {...}}` (regra do projeto: sempre HTTP 200).

### 2. Tabela de log + migration Externo
Via `run-external-migration`:
```sql
CREATE TABLE inss_email_sync_log (...);
GRANT SELECT, INSERT ON inss_email_sync_log TO authenticated;
GRANT ALL TO service_role;
ALTER TABLE ... ENABLE RLS;
CREATE POLICY "auth pode ler" ...;
```

### 3. pg_cron de hora em hora
No Externo (única coisa que precisa rodar no Postgres):
```sql
SELECT cron.schedule('sync-inss-emails-hourly', '0 * * * *',
  $$ SELECT net.http_post(url:='https://<railway>/sync-inss-emails',
       body:='{"triggered_by":"cron"}'::jsonb) $$);
```

### 4. UI na aba INSS Administrativos
Editar `src/components/processes/InssAdminProcessesTab.tsx`:
- Botão "🔄 Sincronizar Gmail" no topo (chama o ajudante via `cloudFunctions.invoke('sync-inss-emails')`).
- Toast com resumo: "X e-mails lidos, Y processos atualizados, Z novos, W órfãos".
- Linha pequena abaixo: "Última sync: há 12 min" (lê de `inss_email_sync_log`).
- Filtro novo "Apenas órfãos (sem lead)" pra você vincular manual.

### 5. Validação
- Testar com curl no Railway: `curl -X POST https://<railway>/sync-inss-emails -d '{"limit":5}'` e ver se volta JSON com extração.
- Conferir no banco: `SELECT * FROM inss_email_sync_log ORDER BY started_at DESC LIMIT 1;` e `SELECT process_number, status, polo_ativo FROM lead_processes WHERE process_type='inss_administrativo' ORDER BY updated_at DESC LIMIT 10;`.
- Clicar o botão na UI e ver toast.

## O que NÃO vai mudar

- Não cria caixa de Gmail visual (lista de e-mails, envio, etc.). Só extração focada em INSS.
- Não mexe nas outras abas de Processos.
- Não cria edge function no Cloud nem no Externo (só migration SQL no Externo). Lógica fica no Railway.
- Não duplica conector Google: usa o `GOOGLE_MAIL_API_KEY` que já está ligado.
- Não pede credenciais novas pro Google Cloud: o conector já tem o escopo `gmail.readonly`.

## Risco / rollback

- Se a extração regex pegar campo errado, o cron pode poluir `lead_processes`. Mitigação: primeiro PR sai **sem cron**, só botão manual. Você roda 2-3 vezes, vê se os dados batem, e só então eu ligo o cron numa segunda passada.
- Rollback do cron: `SELECT cron.unschedule('sync-inss-emails-hourly');` — um comando.
- Rollback total: deletar a função do Railway + drop da tabela `inss_email_sync_log`. `lead_processes` fica intacto, só não atualiza mais sozinho.

## Pergunta antes de começar

Confirma a estratégia "primeiro só botão, depois ligo o cron"? Se sim, eu começo agora pelo Railway + UI e deixo o cron pra depois que você validar.

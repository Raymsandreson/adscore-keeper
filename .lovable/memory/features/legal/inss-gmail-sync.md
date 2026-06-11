---
name: INSS Gmail Sync
description: Ingestão automática de emails do INSS via Gmail → processos administrativos com vínculo manual a caso/lead e notificação humanizada
type: feature
---

## Arquitetura

- **Gmail connector (Lovable App)**: 1 conta única do escritório, OAuth gerenciado.
- **Tabelas (Externo)**: `inss_admin_processes`, `inss_status_history`, `inss_sync_state`.
- **Railway handlers**:
  - `gmail-inss-sync` — chama Gmail API via gateway, parseia subject/body, faz upsert do processo e insert no histórico. Dispara `notify-inss-update` quando o processo já está vinculado.
  - `notify-inss-update` — cria `lead_activities` no caso vinculado + envia zap humanizado (Lovable AI) no `lead_whatsapp_groups`.
- **pg_cron Externo**: job `gmail-inss-sync-hourly` chama Railway a cada hora (`5 * * * *`), lookback 2h.
- **UI**: aba "INSS Administrativo" em `/processos`, filtro "Órfãos" (sem caso), botão "Sincronizar agora" pra rodar sob demanda, dialog de vínculo com busca de casos.

## Parsing

Regex no subject: `requerimento\s+(\d{6,12})` + `alterado\s+para\s+(.+)`.
Status "realizado com sucesso" normaliza pra "Em análise".
CPF/nome/benefício extraídos do corpo (text/plain decodificado base64url).

## Vínculo

Sempre órfão por padrão (cliente pediu revisão manual). Ao vincular um caso, todos os updates não notificados (`notified=false`) viram atividade + zap.

## Envs Railway necessárias

- `LOVABLE_API_KEY`
- `GOOGLE_MAIL_API_KEY` (vem do connector)
- `RAILWAY_PUBLIC_URL` (opcional, default localhost)

## Endpoint público

- `POST {RAILWAY}/functions/gmail-inss-sync` (com x-api-key)
- `POST {RAILWAY}/functions/notify-inss-update` `{ process_id }`

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

## Aba "E-mail" no Cadastrar Processo (jul/2026)

Caminho inverso do vínculo: em vez de sair da aba INSS procurando o caso, o
assessor abre o caso e procura o requerimento.

- `src/components/cases/InssEmailSearchTab.tsx` — 3ª aba do `AddProcessDialog`.
  Busca em `inss_admin_processes` (não no Gmail ao vivo). Score = tokens que
  batem no `nome_segurado`, com +2 quando é o primeiro nome — sem isso "Cícero"
  empata com "Francisco Cícero".

### De onde sai o nome do cliente (ordem de confiança)

1. **Procuração (ZapSign)** — `zapsign_documents.outorgante_name/​outorgante_cpf`,
   extraídos do PDF assinado. É o nome civil completo, o mesmo que o INSS usa.
   Achada por `lead_id` e, quando órfã, pelo **telefone do lead/contato**
   comparando os **últimos 8 dígitos** (o nono dígito aparece num cadastro e
   some no outro: contato `5586 98156159` × ZapSign `5586 998156159`).
   Em 31/07/2026: 2830 docs, só 1150 com `lead_id` — a maioria das procurações
   é órfã, daí o casamento por telefone valer a pena.
2. Contatos do lead (`contacts.lead_id` e `contact_leads`).
3. Título do caso / `lead_name` — vêm com apelido e lixo ("✅PREV 542 | Cícero/Milla").
4. `victim_name`, só como último recurso.

**`victim_name` não é o nome do cliente.** O campo é de acidente de trabalho; em
previdenciário não existe vítima. Ele só carrega nome de cliente porque o trigger
`copy_zapsign_data_to_lead` (migration `20260718120100`) despeja a procuração ali
quando o campo está vazio. Qualquer lógica nova deve ler a procuração direto, não
o `victim_name` — e é por isso que o `inss-matcher` erra em caso PREV: ele casa
nome por `victim_name`/`contacts.full_name`, e num lead sem nenhum dos dois
(1119 de 15932 leads têm `victim_name`) o requerimento gruda em homônimo.
- Requerimento já preso a outro lead/caso aparece com selo "Vinculado a: X" e só
  é movido após `confirm()` explícito.
- Botão "procurar no Gmail agora" chama `gmail-inss-sync` com `lookback_days: 30`.
- `src/lib/inssLeadProcess.ts` — `upsertInssLeadProcess`, extraído do
  `InssAdminProcessesTab`. É a única ponte `inss_admin_processes` →
  `lead_processes`; agora grava também POP e responsável escolhidos no modal.

**Por que existe:** o dado do e-mail só aparece na ficha do caso quando existe
linha em `lead_processes`, e isso só acontecia quando o processo tinha `case_id`.
Em 31/07/2026: 250 de 789 requerimentos tinham lead mas nenhum caso — invisíveis
na ficha. Ex.: req. 485096106 (Cícero) estava no lead "Cicero" (0 casos) em vez
do `PREV 542`, porque o matcher casa por `victim_name`/`contacts.full_name` e o
PREV 542 não tem nenhum dos dois preenchido.

Pendente: verificar na UI após o publish.

## Envs Railway necessárias

- `LOVABLE_API_KEY`
- `GOOGLE_MAIL_API_KEY` (vem do connector)
- `RAILWAY_PUBLIC_URL` (opcional, default localhost)

## Endpoint público

- `POST {RAILWAY}/functions/gmail-inss-sync` (com x-api-key)
- `POST {RAILWAY}/functions/notify-inss-update` `{ process_id }`

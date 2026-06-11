## Visão geral (metáfora)

Vou montar um **"carteiro robô"** que:
1. Abre o Gmail do escritório de hora em hora
2. Lê só emails do INSS
3. Pega número do requerimento + status novo
4. Joga numa **"caixa de órfãos"** dentro do WhatsJUD
5. Operador entra ali e diz "esse requerimento é do Caso X"
6. A partir do vínculo, toda atualização vira **atividade** + **mensagem no grupo do lead** em linguagem simples

---

## Peças que vou construir

### 1. Conexão Gmail (workspace única)
- Usar o **App connector "Google Mail"** da Lovable (OAuth gerenciado)
- Você loga 1x com a conta do escritório que recebe os emails do INSS
- Sistema usa essa conta para todos os usuários

### 2. Tabela nova no Supabase Externo: `inss_admin_processes`
Campos principais:
- `requerimento_number` (único, ex: 1874188131)
- `current_status` (Pendente / Concluída / Exigência / Indeferido…)
- `cpf_segurado` (extraído do email se vier)
- `nome_segurado` (extraído do email)
- `case_id` (NULL até operador vincular = órfão)
- `lead_id` (preenchido por consequência do case)
- `linked_at`, `linked_by`
- `last_email_at`, `last_email_subject`
- `deleted_at` (soft-delete padrão)

### 3. Tabela `inss_status_history`
Cada atualização vira uma linha:
- `process_id` → fk pra `inss_admin_processes`
- `from_status`, `to_status`
- `email_received_at`
- `email_subject`
- `gmail_message_id` (pra não processar 2x)
- `notified` (boolean — virou atividade + zap no grupo?)

### 4. Edge function no Externo: `gmail-inss-sync`
- Roda via **pg_cron a cada 1h**
- Usa Gmail API via gateway Lovable
- Query: `from:noreply newer_than:1h "[INSS]"`
- Pra cada email:
  - Regex pega número do requerimento + status no subject
  - Se já existe processo → cria linha em `inss_status_history`
  - Se não existe → cria processo órfão
  - Se `case_id` já vinculado → dispara notificação (passo 6)

### 5. UI nova dentro do módulo Processos (sem rota nova no sidebar)
Aba **"INSS Administrativo"** dentro de `/processos` com:
- **Filtro "Órfãos"** no topo (badge vermelho com contagem)
- Lista com: número, status atual, segurado, último update
- Botão **"Vincular ao caso"** → modal pra escolher caso/lead
- Histórico de status expandível por linha

### 6. Notificação automática (quando vinculado)
Quando chega update de processo já vinculado:
- Cria **atividade** no caso:
  - Título: "INSS atualizou requerimento 1874188131"
  - Descrição: "Status mudou de Pendente → Exigência. Verificar próxima ação."
  - Atribui ao dono do lead
- Envia **zap no grupo do lead** via Railway, mensagem humanizada (IA Lovable gera):
  > "Oi! Tivemos novidade no seu pedido junto ao INSS. O status mudou para *Exigência*, isso quer dizer que o INSS pediu mais alguma informação ou documento. Vamos verificar o que precisa e te retornar. 🙏"

### 7. Vínculo retroativo
Quando operador vincula um órfão a um caso, dispara notificação **para cada update anterior não notificado** (limitado aos últimos 5 pra não floodar).

---

## Stack técnica

```text
[Gmail conta escritório]
        │ OAuth (App connector "google_mail")
        ▼
[pg_cron 1x/hora no Externo]
        │ chama
        ▼
[edge function gmail-inss-sync (Externo)]
        │ - busca emails INSS (gateway Lovable)
        │ - parsing regex
        │ - upsert inss_admin_processes
        │ - insert inss_status_history
        │ - se vinculado → POST Railway /functions/notify-inss-update
        ▼
[Railway notify-inss-update]
        │ - cria lead_activity no Externo
        │ - chama IA Lovable pra humanizar texto
        │ - envia zap no grupo via UazAPI
        ▼
[Operador vê atividade + cliente recebe zap]
```

---

## Ordem de execução

1. Conectar Google Mail connector (você faz OAuth)
2. Migration no Externo: 2 tabelas + índices
3. Edge function `gmail-inss-sync` no Externo
4. pg_cron horário no Externo
5. Handler `notify-inss-update` no Railway
6. UI aba "INSS Administrativo" em `/processos`
7. Teste manual: rodar sync 1x, vincular 1 órfão, ver atividade + zap

---

## O que NÃO vou mexer

- Tabela `lead_processes` existente (esses são processos **judiciais**; INSS administrativo é tabela separada pra não misturar)
- Notificações de movimentação judicial (`check-process-movements` continua igual)
- Outras integrações Gmail/Google que possam existir

---

## Custos e riscos

- Gmail API: 250 quota units/user/segundo — sem risco com 1h de intervalo
- IA Lovable pra humanizar mensagem: ~50 tokens por update, custo desprezível
- Risco principal: regex de parsing pode falhar em formatos novos do INSS. Mitigação: log do email cru em `inss_status_history.raw_subject` pra debug, e fallback "Status desconhecido" criando o processo mesmo assim pra revisão manual

---

Confirma esse plano que eu sigo na ordem acima.
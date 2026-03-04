

## Plano: Integração Meta BM com Rotina de Tráfego Pago e Produtividade

### Contexto
Você quer que os dados da Meta Business Manager (leads qualificados, leads chegados, criativos subidos) sejam puxados diariamente e contabilizados como métricas de produtividade dentro da rotina de tráfego pago. Além disso, quer uma aba editável para registrar o que foi feito e o que está dando certo.

### Arquitetura

```text
┌─────────────────────────────────────────────┐
│         Edge Function (CRON diário)         │
│  meta-daily-sync                            │
│  - Puxa dados da Meta API (server-side)     │
│  - Salva em tabela: meta_daily_metrics      │
│  - Métricas: leads, leads qualificados,     │
│    criativos ativos                         │
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│       Tabela: meta_daily_metrics            │
│  user_id, date, leads_received,             │
│  leads_qualified, creatives_uploaded,        │
│  notes, what_worked, next_actions           │
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│  Integração na Produtividade                │
│  - Novas métricas no useTeamProductivity    │
│  - Visível no Dashboard + Banner            │
│  - Conta na % de produtividade da rotina    │
└─────────────────────────────────────────────┘
```

### Etapas de Implementação

**1. Tabela `meta_daily_metrics`**
- `id`, `user_id`, `date`, `account_id`
- Métricas automáticas: `leads_received`, `leads_qualified`, `creatives_active`, `spend`, `impressions`, `clicks`
- Campos editáveis: `notes` (o que fiz), `what_worked` (o que deu certo), `next_actions` (próximos passos), `manual_creatives_uploaded`
- RLS: usuário vê seus próprios dados, admin vê todos

**2. Edge Function `meta-daily-sync`**
- Executa via CRON diário (pg_cron)
- Busca config da Meta (token + account_id) da tabela existente ou secrets
- Chama a Graph API server-side (sem CORS)
- Calcula leads recebidos (action_type = lead), leads qualificados (filtro por conversões), criativos ativos
- Insere/atualiza `meta_daily_metrics` para o dia

**3. Novo componente `TrafficActivityPanel`**
- Aba dentro da página de Atividades ou Dashboard de Tráfego Pago
- Exibe métricas diárias (automáticas da Meta)
- Campos editáveis: "O que fiz hoje", "O que está dando certo", "Criativos subidos manualmente"
- Histórico por data com possibilidade de edição

**4. Integração com Produtividade**
- Adicionar métricas `leadsReceived`, `leadsQualified`, `creativesUploaded` ao `useTeamProductivity`
- Registrar como `activity_log` entries para contar na % de produtividade
- Vincular ao tipo de atividade "tráfego pago" na rotina do membro
- Aparece no banner de produtividade e no dashboard da equipe

**5. Configuração de Metas (CommissionGoals)**
- Adicionar metas de ação diária: leads recebidos, leads qualificados, criativos subidos
- Permitir definir targets por membro

### Detalhes Técnicos

- A Edge Function usa os secrets `META_ACCESS_TOKEN` já configurados
- Precisará de uma tabela `meta_account_configs` para mapear qual account_id pertence a qual user_id (caso múltiplos gestores)
- O CRON roda 1x/dia às 23:00 para capturar dados do dia
- Os campos editáveis são salvos via update direto na tabela pelo frontend
- As métricas automáticas da Meta são read-only no frontend


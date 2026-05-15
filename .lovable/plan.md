# Painel "Foco Agora" — topo do WhatsApp

## O que é (em palavras simples)

Hoje, em cima do WhatsApp aparece uma "tira fina" de produtividade (a barra vermelha que você marcou). Vamos trocar essa tira por um **painel grande e visível** com 4 KPIs e 3 cards de ação imediata — exatamente como o primeiro print que você enviou.

Pensa assim: a tira fina é um painel de carro com 1 ponteirinho. Vamos trocar por um painel completo de avião — com instrumentos grandes que mostram, num olhar, o que você precisa atacar agora.

## Onde vai aparecer

- **Só dentro da rota `/whatsapp`** — nas outras telas (Leads, Atividades, etc.) a barra fina antiga continua igual.
- O global `UserProductivityBanner` será escondido quando a rota for `/whatsapp`, e o novo painel ocupa esse espaço.

## Estrutura visual (espelha o print)

```text
┌─────────────────────────────────────────────────────────────────┐
│  KA  Karolyne · visão pessoal       [Ontem][Hoje][Semana]...   │
│      ⏱ 4h 28min online              [👥 Equipe / 🙋 Pessoal]    │
├─────────────────────────────────────────────────────────────────┤
│  Leads      │  Fechados   │  Conversão  │  Inviáveis           │
│  12         │  3 / 5      │  25%        │  2                   │
│  recebidos  │  meta 5     │  3 de 12    │  descartados         │
│  ↗ +3 em 2h │  ▰▰▰░░ 60%  │  ↗ +7pp     │  Top: sem docs       │
├─────────────────────────────────────────────────────────────────┤
│  🔥 FOCO AGORA                                                  │
│  ┌─────────────┬────────────────┬────────────────────────────┐ │
│  │ Faltam docs │ Pend. assinat. │ Sem resposta               │ │
│  │ 4 leads     │ 6 no ZapSign   │ Eu devo (12) Cliente sumiu │ │
│  │ [Cobrar]    │ [Reenviar]     │ 12 aguardando você [Resp.] │ │
│  └─────────────┴────────────────┴────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Origem dos dados (tudo do Externo)

| KPI | Fonte | Filtro |
|---|---|---|
| Leads recebidos | `leads` | `created_at` no período + `created_by`/equipe |
| Fechados / meta | `leads` | `lead_status='closed'` no período; meta de `routine_process_goals` (steps=closed) |
| Conversão | calc | fechados ÷ recebidos |
| Inviáveis | `leads` | `lead_status='discarded'`; top motivo via `details->>'discard_reason'` |
| Faltam docs | `leads` join `lead_processes` | leads no estágio "documentos" sem anexo |
| Pendentes ZapSign | `zapsign_signatures` | `status='sent'` AND `last_clicked_at IS NULL` AND `created_at < now()-48h` |
| Sem resposta | `whatsapp_messages` (snapshot via `useWhatsAppMessages`) | última msg `direction='inbound'` há +30min |
| Online (4h28min) | `user_session_log` (Cloud) | soma da sessão de hoje |

## Modo Pessoal vs Equipe

- Toggle no header. **Pessoal** = filtra por `created_by = user.id` (e mensagens das instâncias do usuário). **Equipe** = todos os membros do(s) time(s) do usuário (via `team_members` no Cloud + lista de `user_id` aplicada nos filtros do Externo).
- O título muda: "Karolyne · visão pessoal" ↔ "Equipe Vendas · visão do time".

## Seletor de período

`Ontem | Hoje | Semana | Mês | Ano | 📅 Personalizado` — segue o mesmo padrão do `MonitorHeader` que já existe.

## Arquivos novos

- `src/components/whatsapp/FocusDashboard/FocusDashboard.tsx` — componente principal
- `src/components/whatsapp/FocusDashboard/KpiCard.tsx` — card colorido reutilizável (Leads/Fechados/Conversão/Inviáveis)
- `src/components/whatsapp/FocusDashboard/FocusActionCard.tsx` — card de ação (Faltam docs / Pendentes / Sem resposta)
- `src/hooks/useFocusDashboardData.ts` — busca tudo do Externo, retorna `{ kpis, focus, loading, refetch }`

## Arquivos alterados

- `src/components/whatsapp/WhatsAppInbox.tsx` — renderiza `<FocusDashboard />` no topo, antes do header atual do WhatsApp.
- `src/App.tsx` — esconde `<UserProductivityBanner />` quando `pathname === '/whatsapp'`.

## Ações dos botões

- **Cobrar documentos** → abre `WhatsAppLeadsDashboard` filtrado em "faltam docs"
- **Reenviar / cobrar** → abre lista ZapSign pendentes (já existe `ZapSignDialogHost`)
- **Responder agora** → ativa filtro "Não respondidas" + tab "Eu devo" na lista de conversas (já existe `quickFilter`)

## O que NÃO vai mudar

- Funcionalidade do WhatsApp (lista/chat/share).
- A barra fina global continua nas outras rotas.
- Nada de schema novo no banco — só leitura.
- Nenhum endpoint novo — só queries via `db` (barrel) no Externo.

## Risco / rollback

- Risco baixo: feature aditiva visual.
- Rollback: remover o import do `FocusDashboard` no `WhatsAppInbox` e a condição em `App.tsx`. 1 commit, reversível em <1min.

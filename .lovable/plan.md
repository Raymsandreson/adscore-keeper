
# Campanhas — novo objeto no CRM

Metáfora: **Campanha = rede de pesca**. Ela custa dinheiro pra jogar na água, gera peixes (leads), que viram peixes no barco (casos), que viram filé (processos), que viram dinheiro (honorários). A campanha precisa saber quanto pescou e quanto gastou pescando.

## Hierarquia final

```
Campanha (rede, custo)
   └── Leads (peixes fisgados)
         └── Casos (fechados)
               └── Processos (execução)
                     └── Honorários (receita)
```

## 1. Banco (Supabase Externo, via `run-external-migration`)

### Tabela `campaigns`
Campos de negócio:
- `name`, `description`, `status` (rascunho/ativa/pausada/encerrada)
- `start_date`, `end_date`
- `board_id` (workflow próprio da campanha — reusa `kanban_boards` tipo `workflow`)
- `stage_id` (etapa atual no board)
- `investment_total` (custo do tráfego lançado manualmente)
- `meta_ad_account_id`, `meta_campaign_id` (opcional, pra sincronizar custo do Meta depois)
- `product_service_id`, `nucleus_id` (herança pro lead)
- `created_by`, `assigned_to`

### Vínculo Campanha ↔ Lead
- Adicionar coluna `campaign_id UUID` em `leads` (referência opcional).
- Índice em `leads.campaign_id`.

### Vínculo automático via criativo
- Adicionar `campaign_id` em `promoted_posts` / `ad_briefings` (o que já bate com criativo Meta).
- Webhook CTWA (Railway) preenche `leads.campaign_id` quando o `ad_id` bate com criativo vinculado a uma campanha.

### Atividades da campanha
- Adicionar `campaign_id UUID` em `lead_activities` (nullable).
- Atividade pode ser de lead OU de campanha (uma das duas).

### GRANTs padrão (authenticated + service_role).

## 2. Cálculo de ROI (view no Externo)

`vw_campaign_metrics`:
- leads_count, cases_count, processes_count
- honorarios_total (SUM de `lead_financials.contract_value` dos leads da campanha)
- investment_total
- CAC = investment / leads_count
- ROI = (honorarios - investment) / investment
- LTV médio por lead

## 3. Frontend

### Hook `useCampaigns.ts`
CRUD via `db` (barrel Externo). Filtro por status, assigned_to, nucleus.

### Componente único `CampaignForm.tsx`
Reutilizado em criar/editar (política de forms unificados). Campos: nome, descrição, período, board de workflow, produto, núcleo, investimento inicial, responsável.

### Página `/campanhas` (`CampaignsPage.tsx`)
- Lista tipo kanban (por status) + toggle tabela.
- Cada card mostra: nome, período, leads/casos/R$ gerado, ROI colorido.
- Botão "Nova campanha" abre o form.

### Página `/campanhas/:id` (`CampaignDetailPage.tsx`)
- Header: nome, status, investimento, ROI.
- Aba **Fluxo**: reusa `WorkflowProgressPage` apontando pro `board_id` da campanha.
- Aba **Leads**: lista de leads com `campaign_id = X`, com filtros por etapa/acolhedor.
- Aba **Atividades**: lista de `lead_activities` com `campaign_id = X` (cronômetro funciona igual).
- Aba **Financeiro**: investimento (editável), honorários agregados dos processos, CAC/ROI/LTV.
- Aba **Criativos**: `promoted_posts`/`ad_briefings` vinculados.

### Integração com atividade existente
No `ActivityFormCompact`: dropdown "Campanha" (opcional, ao lado do dropdown de Lead). Se marcar campanha sem lead, a atividade fica presa à campanha e usa o workflow dela.

### Vínculo manual no Lead
No `LeadForm` existente: dropdown "Campanha" (busca `campaigns` ativas).

### Sidebar
Novo item **"Campanhas"** dentro do grupo Marketing (não solto — regra de agrupamento). Se o grupo Marketing não existir, criar.

## 4. Vínculo automático (Railway)

Editar webhook CTWA (`railway-server/src/functions/*ctwa*`):
- Ao criar lead com `ad_id`, consultar `promoted_posts.campaign_id` correspondente.
- Se achar, gravar `leads.campaign_id`.

## 5. Migração de dados existentes

Nada retroativo automático — leads antigos ficam sem campanha. Usuário vincula manualmente os que quiser.

## Ordem de execução

1. Migration SQL (tabela + colunas + view + GRANTs) via `run-external-migration`.
2. Hook `useCampaigns`.
3. `CampaignForm` + `CampaignsPage` + rota.
4. `CampaignDetailPage` com abas.
5. Dropdown de campanha no `LeadForm` e `ActivityFormCompact`.
6. Item de sidebar em Marketing.
7. Webhook CTWA (última etapa, quando o resto estiver testado).

## Fora do escopo desta primeira entrega

- Sync automático de custo do Meta (fica manual por enquanto — campo `investment_total` editável).
- Migração retroativa de leads antigos → campanha.
- Dashboards comparativos entre campanhas (fica pra fase 2, depois de ter dados).

Confirma que posso executar nessa ordem? Se sim, começo pela migration.

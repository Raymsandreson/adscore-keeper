## Decisões confirmadas
- Vínculo `lead↔grupo` → lead vira `closed` automático, retroativo
- `closed_at` = `lead_whatsapp_groups.created_at` (data em que o vínculo entrou no sistema — é o que temos sem chamar a UazAPI)
- Resultado (`lead_status` ∈ ganho/recusado/inviável/cancelado) obrigatório **ao tentar fechar**
- Quando o caso está fechado e o lead não tem grupo, sistema tenta achar por **nome do lead** no `whatsapp_groups_cache`

## 1) Trigger no Supabase Externo (via run-external-migration)

```sql
-- a) função: ao inserir vínculo lead↔grupo, marca lead como fechado
create or replace function public.auto_close_lead_on_group_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.leads
     set lead_status = case
           when lead_status in ('refused','inviavel','cancelled') then lead_status
           else 'closed'
         end,
         lead_status_changed_at = coalesce(lead_status_changed_at, NEW.created_at),
         lead_status_reason = coalesce(lead_status_reason, 'Auto: grupo WhatsApp vinculado'),
         updated_at = now()
   where id = NEW.lead_id
     and (lead_status is null or lead_status = 'active');
  return NEW;
end $$;

drop trigger if exists trg_auto_close_on_group_link on public.lead_whatsapp_groups;
create trigger trg_auto_close_on_group_link
  after insert on public.lead_whatsapp_groups
  for each row execute function public.auto_close_lead_on_group_link();

-- b) backfill retroativo: todos os leads que já têm vínculo e ainda estão ativos
update public.leads l
   set lead_status = 'closed',
       lead_status_changed_at = coalesce(l.lead_status_changed_at, lwg.first_link),
       lead_status_reason = coalesce(l.lead_status_reason, 'Auto: grupo WhatsApp vinculado (backfill)'),
       updated_at = now()
  from (
    select lead_id, min(created_at) as first_link
      from public.lead_whatsapp_groups
     group by lead_id
  ) lwg
 where lwg.lead_id = l.id
   and (l.lead_status is null or l.lead_status = 'active');
```

**Rollback**: `drop trigger trg_auto_close_on_group_link on public.lead_whatsapp_groups; drop function public.auto_close_lead_on_group_link;` — o backfill não tem rollback automático, então mostro contagem antes (`select count(*) from leads l join lead_whatsapp_groups lwg on lwg.lead_id=l.id where l.lead_status='active'`) e você aprova.

## 2) Resultado obrigatório ao fechar (UI)

`LeadEditDialog.handleSave`:
- Se mudança implica `lead_status='closed'` (mudou para etapa de fechamento OU foi clicado Salvar com status closed) **e** `lead_status_reason` está vazio **e** nenhum resultado específico (`refused/inviavel/cancelled/closed-com-ganho`) foi selecionado → bloqueia salvar, toast `"Selecione o resultado do lead antes de fechar."`, foca no campo de resultado.
- Mesmo bloqueio no `auto_close_lead_on_case_creation` (trigger Cloud): se ao criar caso o lead não tem `lead_status_reason` nem resultado, mostra dialog forçando preencher antes (no frontend, antes do insert do caso).

## 3) Auto-link de grupo quando entra no lead (caso fechado, sem grupo)

Novo hook `useAutoLinkGroupByName(leadId, leadName, hasCase, currentGroupId)`:
- Só roda se `hasCase === true` e `currentGroupId` vazio.
- 1x por sessão por lead.
- Busca em `whatsapp_groups_cache` por `group_name ilike %{leadName normalizado}%` (com tokens significativos do nome do lead).
- **Match único** → insere em `lead_whatsapp_groups` (vai disparar a trigger acima).
- **Vários matches** → abre toast com botão "escolher grupo" que abre o `LinkOrphanWhatsAppButton` já existente.
- **Nenhum match** → silencioso.

## 4) Resposta de background docs (perguntada)
Sair do lead **cancela** o upload pendente. Pra continuar em background mesmo fechado, precisaria virar edge function assíncrona — fica fora deste escopo. Te aviso se quiser depois.

## O que NÃO vou mexer
- Edge functions de WhatsApp/ZapSign existentes
- Estrutura do kanban / regras de etapas
- `lead-drive` e import de docs (separado)
- Lovable Cloud DB (regra do projeto — só Externo)

## Ordem de execução
1. SQL no Externo via `run-external-migration` (trigger + backfill, mostro contagem antes)
2. Validação obrigatória no `LeadEditDialog.handleSave` + ponto de criação de caso
3. Novo hook `useAutoLinkGroupByName` + plug no `LeadEditDialog`
4. Validar build

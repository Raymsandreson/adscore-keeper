-- Backfill: atividades de robô que nasceram carimbadas como 'manual'
-- ---------------------------------------------------------------------------
-- Motivo: `lead_activities.action_source` tem DEFAULT 'manual'. Os robôs que
-- não preenchiam a coluna não ficavam nulos — ficavam marcados como PESSOA.
-- O símbolo do robô na tela lê esse carimbo, então essas atividades apareciam
-- (e apareceriam para sempre) como criadas por gente.
--
-- Cada lote é identificado pela assinatura DETERMINÍSTICA do robô que o criou
-- (título + descrição gerados em código), nunca por chute. Linha que tem o
-- título do robô mas não a descrição dele (clone feito por uma pessoa, por
-- exemplo) fica de fora e continua 'manual'.
--
-- `action_source = 'manual'` no WHERE torna o script idempotente: rodar duas
-- vezes não muda nada na segunda.
--
-- Os dois triggers são desligados DENTRO da transação:
--   - update_lead_activities_updated_at: sobe updated_at em todo UPDATE. O
--     painel "Atrasadas de hoje" lê `updated_at >= hoje` para dizer "atualizada
--     hoje" — 6.257 linhas apareceriam como tocadas pela equipe hoje.
--   - trg_activity_audit: gravaria 6.257 linhas de auditoria de um UPDATE que
--     não é ação de ninguém.
-- Se qualquer passo falhar, a transação inteira volta — inclusive o estado dos
-- triggers.
--
-- Antes de mexer, os ids afetados são copiados para
-- `backfill.action_source_20260901` — é o rollback, e é exato (id a id), não
-- um recorte por data. A tabela fica no schema `backfill`, que NÃO é exposto
-- pela API: tabela nova em `public` sem RLS seria bug crítico.
--
-- Rollback: scratchpad/rollback-backfill-action-source-20260901.sql
-- ---------------------------------------------------------------------------

begin;

alter table public.lead_activities disable trigger update_lead_activities_updated_at;
alter table public.lead_activities disable trigger trg_activity_audit;

create schema if not exists backfill;

create table backfill.action_source_20260901 as
select id, action_source as action_source_antigo, action_source_detail as detail_antigo
  from public.lead_activities
 where action_source = 'manual'
   and (
        description like '%Assunto do email:%'
     or (title like 'Assinatura: %assinou %'                    and description like '%assinou o documento%')
     or (title like 'Resultado alterado via etiqueta WhatsApp:%' and description like '%pelo operador aplicando a etiqueta%')
     or (title like 'Follow-up pendente: %'                      and description like '%tentativas automáticas de follow-up%')
     or (title like 'Cobrar assinatura: %'                       and description like '%ainda não assinou o documento%')
     or (title = 'ONBOARDING CLIENTE'                            and description like 'Atividade de onboarding criada%')
   );

-- 1) Robô do INSS (notify-inss-update, Railway) — 544 linhas
update public.lead_activities
   set action_source = 'system', action_source_detail = 'Robô do INSS'
 where action_source = 'manual'
   and description like '%Assunto do email:%';

-- 2) Robô do ZapSign (zapsign-webhook) — 666 linhas
update public.lead_activities
   set action_source = 'system', action_source_detail = 'Robô do ZapSign'
 where action_source = 'manual'
   and title like 'Assinatura: %assinou %'
   and description like '%assinou o documento%';

-- 3) Etiqueta do WhatsApp (whatsapp-webhook, Railway) — 4.133 linhas
update public.lead_activities
   set action_source = 'system', action_source_detail = 'Etiqueta do WhatsApp'
 where action_source = 'manual'
   and title like 'Resultado alterado via etiqueta WhatsApp:%'
   and description like '%pelo operador aplicando a etiqueta%';

-- 4) Follow-up automático (wjia-followup-processor) — 530 linhas
update public.lead_activities
   set action_source = 'system', action_source_detail = 'Follow-up automático'
 where action_source = 'manual'
   and title like 'Follow-up pendente: %'
   and description like '%tentativas automáticas de follow-up%';

-- 5) Follow-up automático de assinatura (wjia-followup-processor) — 61 linhas
update public.lead_activities
   set action_source = 'system', action_source_detail = 'Follow-up automático (assinatura)'
 where action_source = 'manual'
   and title like 'Cobrar assinatura: %'
   and description like '%ainda não assinou o documento%';

-- 6) Onboarding automático (onboarding-checkpoint-execute + backfill ZapSign) — 323 linhas
update public.lead_activities
   set action_source = 'system', action_source_detail = 'Onboarding automático'
 where action_source = 'manual'
   and title = 'ONBOARDING CLIENTE'
   and description like 'Atividade de onboarding criada%';

alter table public.lead_activities enable trigger trg_activity_audit;
alter table public.lead_activities enable trigger update_lead_activities_updated_at;

commit;

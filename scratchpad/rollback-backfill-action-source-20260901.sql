-- ROLLBACK do backfill de 01/09/2026 (scratchpad/backfill-action-source-20260901.sql)
-- ---------------------------------------------------------------------------
-- Devolve id a id o valor antigo, a partir da tabela de backup que o próprio
-- backfill gravou. Não usa recorte por data: o que os robôs carimbarem sozinhos
-- depois do deploy não está nessa tabela e continua 'system', como deve ser.
--
-- Mesma proteção de triggers do backfill: nem updated_at nem auditoria.
-- ---------------------------------------------------------------------------

begin;

alter table public.lead_activities disable trigger update_lead_activities_updated_at;
alter table public.lead_activities disable trigger trg_activity_audit;

update public.lead_activities a
   set action_source = b.action_source_antigo,
       action_source_detail = b.detail_antigo
  from backfill.action_source_20260901 b
 where a.id = b.id;

alter table public.lead_activities enable trigger trg_activity_audit;
alter table public.lead_activities enable trigger update_lead_activities_updated_at;

commit;

-- Depois de confirmado que não precisa mais voltar atrás:
-- drop table backfill.action_source_20260901;

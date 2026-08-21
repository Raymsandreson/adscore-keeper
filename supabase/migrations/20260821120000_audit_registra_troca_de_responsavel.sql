-- Audit de atividade passa a registrar TROCA DE RESPONSÁVEL — 21/08/2026.
--
-- Por que:
--   `log_activity_audit` só gravava status, título e deleted_at. Trocar o
--   responsável — a informação que mais gera pergunta ("por que essa atividade
--   saiu de mim?") — não deixava rastro nenhum: a linha do audit saía com
--   `changes = {}`. Medido antes desta migration: 14.822 dos 22.648 updates
--   auditados (65,4%) estavam nesse estado.
--
--   O caso que motivou: a atividade 288ee28e (CASO 366/ PREV 63) saiu do
--   Abderaman para a Gisele em 06/08/2026 18:31:20, junto com outras 429, pelo
--   backfill `20260806160000_backfill_responsavel_prev.sql`. Só foi possível
--   descobrir isso porque AQUELE backfill criou tabela de rollback por conta
--   própria. Sem ela, a resposta seria "não dá para saber".
--
-- O que muda:
--   `changes` ganha 4 chaves quando `assigned_to` muda e 2 quando o array de
--   co-assessores muda. Status, título e deleted_at seguem idênticos — mesma
--   chamada, mesmo `jsonb_strip_nulls`, para não mexer no que já existe.
--
--   As chaves novas ficam FORA do `jsonb_strip_nulls` de propósito: tirar o
--   responsável (ir para NULL) é informação, e o strip apagaria justamente o
--   registro de que a atividade ficou sem dono.
--
-- O que NÃO muda (e continua sendo limitação conhecida):
--   `v_actor := coalesce(NEW.updated_by, auth.uid())`. Quando um UPDATE em lote
--   roda direto no banco sem tocar `updated_by`, o audit credita quem salvou por
--   último pela tela — foi o que aconteceu no lote de 06/08, que apareceu com 13
--   "autores" diferentes, nenhum deles o verdadeiro. Corrigir isso NÃO é trocar
--   por `auth.uid()`: dois saves seguidos do mesmo usuário deixam `updated_by`
--   igual, e a sessão do Externo é anônima. Fica para uma frente própria.
--
-- Nenhum consumidor lê `lead_activity_audit_log` no app hoje (grep em src/,
-- supabase/functions/ e railway-server/): a tabela é só escrita pelo trigger.
-- Chave nova em `changes` não quebra tela nenhuma.
--
-- Rollback: a definição anterior está no fim do arquivo, pronta para colar.

create or replace function public.log_activity_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_action  text;
  v_actor   uuid;
  v_kind    text;
  v_name    text;
  v_old     text;
  v_new     text;
  v_changes jsonb := null;
  rec       public.lead_activities%rowtype;
begin
  if TG_OP = 'INSERT' then
    v_action := 'insert';
    v_actor  := coalesce(NEW.created_by, auth.uid());
    v_old := null; v_new := NEW.status;
    rec := NEW;
  elsif TG_OP = 'UPDATE' then
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      v_action := 'soft_delete';
      v_actor  := coalesce(NEW.deleted_by, NEW.updated_by, auth.uid());
    elsif OLD.deleted_at is not null and NEW.deleted_at is null then
      v_action := 'restore';
      v_actor  := coalesce(NEW.updated_by, auth.uid());
    else
      v_action := 'update';
      v_actor  := coalesce(NEW.updated_by, auth.uid());
    end if;
    v_old := OLD.status; v_new := NEW.status;
    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'status_old', case when OLD.status is distinct from NEW.status then OLD.status end,
      'status_new', case when OLD.status is distinct from NEW.status then NEW.status end,
      'title_old',  case when OLD.title  is distinct from NEW.title  then OLD.title  end,
      'title_new',  case when OLD.title  is distinct from NEW.title  then NEW.title  end,
      'deleted_at', NEW.deleted_at
    ));

    -- Responsável principal. Sem strip: "virou NULL" precisa aparecer.
    if OLD.assigned_to is distinct from NEW.assigned_to then
      v_changes := v_changes || jsonb_build_object(
        'assigned_to_old',      OLD.assigned_to,
        'assigned_to_new',      NEW.assigned_to,
        'assigned_to_old_name', OLD.assigned_to_name,
        'assigned_to_new_name', NEW.assigned_to_name
      );
    end if;

    -- Co-assessores: reatribuição em lote mexe no array sem trocar o principal.
    if OLD.assigned_to_ids is distinct from NEW.assigned_to_ids then
      v_changes := v_changes || jsonb_build_object(
        'assigned_to_ids_old', to_jsonb(OLD.assigned_to_ids),
        'assigned_to_ids_new', to_jsonb(NEW.assigned_to_ids)
      );
    end if;

    rec := NEW;
  else -- DELETE (hard delete)
    v_action := 'hard_delete';
    v_actor  := coalesce(auth.uid(), OLD.updated_by, OLD.created_by);
    v_old := OLD.status; v_new := null;
    rec := OLD;
  end if;

  v_name := (select p.full_name from public.profiles p where p.user_id = v_actor limit 1);

  if v_action = 'insert' and coalesce(rec.created_by_ai, false) then
    v_kind := 'ai';
  elsif v_name is not null then
    v_kind := 'user';
  else
    v_kind := 'system';
  end if;

  insert into public.lead_activity_audit_log(
    activity_id, lead_id, case_id, action, actor_id, actor_name, actor_kind,
    activity_title, old_status, new_status, changes
  ) values (
    rec.id, rec.lead_id, rec.case_id, v_action, v_actor, v_name, v_kind,
    rec.title, v_old, v_new, v_changes
  );

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$function$;


-- CONSULTA — quem trocou de responsável, desde que isto entrou:
--
--   select created_at, activity_title, actor_name, actor_kind,
--          changes->>'assigned_to_old_name' as de,
--          changes->>'assigned_to_new_name' as para
--     from lead_activity_audit_log
--    where changes ? 'assigned_to_new'
--    order by created_at desc;
--
--
-- ROLLBACK — definição anterior (extraída com pg_get_functiondef em 21/08/2026,
-- md5 90eef381d5adbf8102ebf45637c045ab). Basta rodar o mesmo CREATE OR REPLACE
-- acima trocando o bloco do UPDATE por este:
--
--     v_old := OLD.status; v_new := NEW.status;
--     v_changes := jsonb_strip_nulls(jsonb_build_object(
--       'status_old', case when OLD.status is distinct from NEW.status then OLD.status end,
--       'status_new', case when OLD.status is distinct from NEW.status then NEW.status end,
--       'title_old',  case when OLD.title  is distinct from NEW.title  then OLD.title  end,
--       'title_new',  case when OLD.title  is distinct from NEW.title  then NEW.title  end,
--       'deleted_at', NEW.deleted_at
--     ));
--     rec := NEW;
--
-- ou seja: apagar os dois blocos `if ... assigned_to ... end if;`. Nada de
-- schema muda, então o rollback é instantâneo e sem perda — as linhas já
-- gravadas com as chaves novas continuam válidas.

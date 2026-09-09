-- Chip da casa saindo de grupo não é "cliente saiu do grupo"
-- ============================================================
-- Problema: `trg_create_activity_on_group_exit` criava atividade de prioridade
-- alta ("⚠️ Cliente saiu do grupo: X") para QUALQUER saída com lead_id — inclusive
-- quando quem saía era chip nosso. Em 2 dias, 37 das 140 saídas registradas (26%)
-- eram de número da casa: instâncias Raym, Analyne, Andressa SDR, Atendimento
-- Previdenciário, Dom (chip antigo perdido), WHATSJUD IA.
--
-- Solução: classificar quem saiu no INSERT. O evento continua registrado em
-- whatsapp_group_exits (histórico e monitor), mas saída de chip da casa não vira
-- atividade nem push, e não aparece no card vermelho da ficha do lead.
--
-- Fonte da verdade de "número da casa": dom_numeros_equipe (ativo) ∪
-- whatsapp_instances.owner_phone, casado pelos últimos 10 dígitos.
--
-- Rollback:
--   drop trigger trg_mark_group_exit_internal on public.whatsapp_group_exits;
--   alter table public.whatsapp_group_exits drop column is_internal;
--   (e recriar create_activity_on_group_exit sem o guard IF NEW.is_internal)
-- ============================================================

-- Chip antigo de atendimento, perdido, ainda saindo dos grupos.
-- 558688437181 (Dom) e 558689027856 (WHATSJUD IA) já estavam cadastrados.
insert into public.dom_numeros_equipe (phone, nome, origem, ativo)
values ('558681595991', 'Chip antigo de atendimento (perdido)', 'manual', true)
on conflict (phone) do nothing;

alter table public.whatsapp_group_exits
  add column if not exists is_internal boolean not null default false;

create or replace function public.is_numero_da_casa(p_phone text)
returns boolean
language sql
stable
set search_path = public
as $fn$
  with alvo as (select right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10) as last10)
  select (select length(last10) from alvo) = 10
     and (
       exists (
         select 1 from public.dom_numeros_equipe d, alvo
         where d.ativo
           and right(regexp_replace(coalesce(d.phone,''), '\D', '', 'g'), 10) = alvo.last10
       )
       or exists (
         select 1 from public.whatsapp_instances i, alvo
         where right(regexp_replace(coalesce(i.owner_phone,''), '\D', '', 'g'), 10) = alvo.last10
       )
     );
$fn$;

create or replace function public.mark_group_exit_internal()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.is_internal := coalesce(new.is_internal, false) or public.is_numero_da_casa(new.phone);
  return new;
end;
$fn$;

drop trigger if exists trg_mark_group_exit_internal on public.whatsapp_group_exits;
create trigger trg_mark_group_exit_internal
  before insert on public.whatsapp_group_exits
  for each row execute function public.mark_group_exit_internal();

-- BEFORE roda antes do AFTER, então is_internal já está preenchido aqui.
create or replace function public.create_activity_on_group_exit()
returns trigger
language plpgsql
set search_path = public
as $fn$
DECLARE
  v_assignee uuid;
  v_assignee_name text;
  v_lead_name text;
  v_member_label text;
BEGIN
  -- Quem saiu é chip da casa: não é cliente. Registra o evento, mas não notifica.
  IF COALESCE(NEW.is_internal, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(l.processual_responsible_id, l.created_by), l.lead_name
    INTO v_assignee, v_lead_name
  FROM public.leads l
  WHERE l.id = NEW.lead_id;

  IF v_assignee IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_assignee_name FROM public.profiles WHERE user_id = v_assignee LIMIT 1;

  v_member_label := COALESCE(NEW.contact_name, NEW.phone, 'membro');

  INSERT INTO public.lead_activities (
    lead_id, lead_name, title, description, activity_type,
    status, priority, assigned_to, assigned_to_name, deadline
  ) VALUES (
    NEW.lead_id, v_lead_name,
    '⚠️ Cliente saiu do grupo: ' || v_member_label,
    'O membro ' || v_member_label || ' saiu do grupo WhatsApp ' ||
      COALESCE(NEW.group_name, NEW.group_jid) || ' em ' ||
      to_char(COALESCE(NEW.exited_at, now()), 'DD/MM/YYYY HH24:MI') ||
      '. Verifique antes de enviar atualizações pelo grupo.',
    'notificacao', 'pendente', 'alta',
    v_assignee, v_assignee_name, CURRENT_DATE
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'create_activity_on_group_exit skipped: %', SQLERRM;
  RETURN NEW;
END;
$fn$;

-- Backfill: 37 linhas antigas de chip da casa.
update public.whatsapp_group_exits e
   set is_internal = true
 where not e.is_internal
   and public.is_numero_da_casa(e.phone);

-- As 4 atividades pendentes já geradas por saída de chip da casa foram apagadas
-- em 09/09/2026, com cópia em public.zz_lead_activities_bkp_20260909_group_exit.

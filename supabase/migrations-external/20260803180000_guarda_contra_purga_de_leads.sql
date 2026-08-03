-- =============================================================================
-- Guarda contra purga de leads (incidente permanent-delete-lead, jul/2026)
-- Banco: Supabase EXTERNO (kmedldlepwiityjsdahz)
-- =============================================================================
--
-- O QUE ACONTECEU
-- A edge `permanent-delete-lead`, antes do fix f22d3681d (14/07/2026), destruía
-- o trabalho do lead em três passos, nesta ordem:
--     1. UPDATE legal_cases  SET lead_id = NULL      (caso vira órfão)
--     2. DELETE lead_activities                      (histórico some)
--     3. DELETE lead_processes                       (processo some)
--     4. DELETE leads
-- Resultado: 22 casos sem lead, 15 deles sem nenhum processo nem atividade.
-- O CASO 382 levou ~50 dias para alguém perceber.
--
-- POR QUE UM TRIGGER, E NÃO `ON DELETE RESTRICT` NA FK
-- Não adiantaria: a rotina NULA o lead_id (passo 1) antes de apagar o lead
-- (passo 4). Quando o DELETE chega na FK, já não há o que restringir. A trava
-- tem que estar em cada passo destrutivo, e não só no último.
--
-- AS TRÊS TRAVAS (qualquer uma barra a sequência acima, na ordem que vier)
--   1. legal_cases : proíbe desvincular um caso do seu lead (lead_id -> NULL)
--   2. lead_processes : proíbe DELETE físico (a UI usa soft delete)
--   3. leads : proíbe apagar lead que ainda tenha caso/processo/atividade vivos
--
-- Verificado antes de escrever: nenhum ponto do front faz DELETE físico em
-- lead_processes (só `update deleted_at`), e nenhum ponto do front nula
-- legal_cases.lead_id. As travas 1 e 2 não têm caller legítimo hoje.
--
-- ESCAPE (exclusão deliberada, ex. LGPD)
-- Dentro da transação, declare a intenção:
--     set local app.allow_lead_purge = 'on';
-- Vale só naquela transação; some sozinho no commit/rollback. Nada de flag
-- global que alguém liga e esquece ligada.
--
-- O QUE ESTA MIGRATION NÃO COBRE
-- DELETE em lead_activities continua livre: existe exclusão legítima de
-- atividade na UI (useLeadActivities.ts:572, ActivitiesPage.tsx:568) e travar
-- isso quebraria uso diário. Esse flanco fica com o lead_activity_audit_log,
-- que registra hard_delete com autor desde 20/07/2026.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Helper: a transação declarou intenção de purga?
-- O `true` em current_setting evita erro quando a GUC nunca foi definida.
-- -----------------------------------------------------------------------------
create or replace function public.lead_purge_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('app.allow_lead_purge', true), '') in ('on', 'true', '1');
$$;

comment on function public.lead_purge_allowed() is
  'True quando a transação declarou `set local app.allow_lead_purge = ''on''`. Usado pelas travas anti-purga.';


-- -----------------------------------------------------------------------------
-- TRAVA 1 — legal_cases: não desvincular caso do lead.
-- Pega o passo 1 da rotina de purga (runUpdateNull), que é a assinatura exata
-- do incidente: caso vivo com lead_id NULL.
-- Trocar de lead (X -> Y) continua permitido; só o caminho para NULL é barrado.
-- -----------------------------------------------------------------------------
create or replace function public.tg_legal_cases_no_unlink()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.lead_id is not null and new.lead_id is null and not public.lead_purge_allowed() then
    raise exception
      'Desvincular o caso % (%) do seu lead deixaria o caso órfão e invisível para a equipe.',
      coalesce(old.case_number, '?'), old.id
      using
        errcode = 'restrict_violation',
        hint    = 'Para exclusão deliberada, rode `set local app.allow_lead_purge = ''on'';` na mesma transação. Para trocar de responsável, aponte lead_id para o novo lead em vez de NULL.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_legal_cases_no_unlink on public.legal_cases;
create trigger trg_legal_cases_no_unlink
  before update of lead_id on public.legal_cases
  for each row
  execute function public.tg_legal_cases_no_unlink();


-- -----------------------------------------------------------------------------
-- TRAVA 2 — lead_processes: nada de DELETE físico.
-- O processo é o ativo mais caro da base e a UI nunca o apaga de verdade
-- (usa deleted_at). Um DELETE aqui é sempre anomalia.
-- -----------------------------------------------------------------------------
create or replace function public.tg_lead_processes_no_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.lead_purge_allowed() then
    raise exception
      'DELETE físico em lead_processes bloqueado (processo %, nº %).',
      old.id, coalesce(old.process_number, 'sem número')
      using
        errcode = 'restrict_violation',
        hint    = 'Use soft delete: `update lead_processes set deleted_at = now() where id = ...`. Para purga real, `set local app.allow_lead_purge = ''on'';` na mesma transação.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_lead_processes_no_hard_delete on public.lead_processes;
create trigger trg_lead_processes_no_hard_delete
  before delete on public.lead_processes
  for each row
  execute function public.tg_lead_processes_no_hard_delete();


-- -----------------------------------------------------------------------------
-- TRAVA 3 — leads: não apagar lead que ainda tem trabalho pendurado.
-- Rede de segurança final. Lead sem nada vinculado continua podendo ser
-- apagado normalmente (duplicata, lixo de importação).
-- Conta só o que está vivo: registro em soft delete não segura o lead.
-- -----------------------------------------------------------------------------
create or replace function public.tg_leads_no_delete_with_deps()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_casos     int;
  n_processos int;
  n_ativs     int;
begin
  if public.lead_purge_allowed() then
    return old;
  end if;

  select count(*) into n_casos
    from public.legal_cases where lead_id = old.id and deleted_at is null;
  select count(*) into n_processos
    from public.lead_processes where lead_id = old.id and deleted_at is null;
  select count(*) into n_ativs
    from public.lead_activities where lead_id = old.id and deleted_at is null;

  if (n_casos + n_processos + n_ativs) > 0 then
    raise exception
      'Lead % (%) ainda tem % caso(s), % processo(s) e % atividade(s) vivos.',
      coalesce(old.lead_name, 'sem nome'), old.id, n_casos, n_processos, n_ativs
      using
        errcode = 'restrict_violation',
        hint    = 'Use soft delete: `update leads set deleted_at = now() where id = ...` (some dos funis, volta pelo painel Arquivados). Para purga real, `set local app.allow_lead_purge = ''on'';` na mesma transação.';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_leads_no_delete_with_deps on public.leads;
create trigger trg_leads_no_delete_with_deps
  before delete on public.leads
  for each row
  execute function public.tg_leads_no_delete_with_deps();

commit;


-- =============================================================================
-- TESTE (rode depois de aplicar; tudo dentro de rollback, não grava nada)
-- =============================================================================
--
-- 1) Trava 1 — deve FALHAR com restrict_violation:
-- begin;
--   update legal_cases set lead_id = null
--    where id = 'a8f8b8c5-e1a5-42a0-9b63-ad8a5ed7d506';   -- CASO 382 refeito
-- rollback;
--
-- 2) Trava 2 — deve FALHAR:
-- begin;
--   delete from lead_processes
--    where id = 'b8a78d75-700f-4f33-b4f5-30f6b7330c4e';   -- processo do 382
-- rollback;
--
-- 3) Trava 3 — deve FALHAR:
-- begin;
--   delete from leads where id = 'a93dcd95-3e9c-4a4e-9908-cee077d73ceb';
-- rollback;
--
-- 4) Escape — deve PASSAR (e ser desfeito pelo rollback):
-- begin;
--   set local app.allow_lead_purge = 'on';
--   delete from lead_processes
--    where id = 'b8a78d75-700f-4f33-b4f5-30f6b7330c4e';
-- rollback;
--
-- 5) Lead sem dependentes — deve PASSAR (usa um lead descartável de verdade):
-- begin;
--   insert into leads (lead_name) values ('__teste_trava__') returning id;
--   delete from leads where lead_name = '__teste_trava__';
-- rollback;


-- =============================================================================
-- ROLLBACK DA MIGRATION
-- =============================================================================
-- drop trigger if exists trg_leads_no_delete_with_deps on public.leads;
-- drop trigger if exists trg_lead_processes_no_hard_delete on public.lead_processes;
-- drop trigger if exists trg_legal_cases_no_unlink on public.legal_cases;
-- drop function if exists public.tg_leads_no_delete_with_deps();
-- drop function if exists public.tg_lead_processes_no_hard_delete();
-- drop function if exists public.tg_legal_cases_no_unlink();
-- drop function if exists public.lead_purge_allowed();

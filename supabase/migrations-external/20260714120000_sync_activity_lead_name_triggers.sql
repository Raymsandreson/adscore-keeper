-- Mantém lead_activities.lead_name (coluna DESNORMALIZADA, exibida na badge "Lead:" e usada
-- na busca client-side) sempre em sincronia com o nome real do lead.
--
-- Contexto: a coluna é uma cópia congelada do nome do lead. Quando o lead é renomeado, ou
-- quando uma migração/religação troca lead_activities.lead_id sem atualizar o lead_name, a
-- cópia fica velha e aparece o "nome fantasma" (incidente 'Bruno' — migracao_20260713 religou
-- o lead_id mas deixou o lead_name antigo em 422 atividades de 25 casos).
--
-- Solução: 2 triggers que garantem o invariante "lead_name espelha o lead", cobrindo tanto
-- inserção/religação (qualquer origem: app, migração, SQL manual) quanto renome do lead.
-- Zero mudança no frontend; leitura continua rápida (sem join). Nome de cliente diferente por
-- atividade continua no campo próprio lead_activities.client_name_override (NÃO é tocado aqui).
--
-- Tabela/triggers vivem no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_sync_activity_lead_name ON public.lead_activities;
--   DROP TRIGGER IF EXISTS trg_propagate_lead_rename ON public.leads;
--   DROP FUNCTION IF EXISTS public.sync_activity_lead_name();
--   DROP FUNCTION IF EXISTS public.propagate_lead_rename_to_activities();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 1 — ao INSERIR ou trocar o lead_id de uma atividade, preencher lead_name
-- a partir do lead. Cobre religação vinda de qualquer lugar (app, migração, SQL manual).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_activity_lead_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Só espelha quando há lead vinculado; atividades sem lead (case-only/processo-only,
  -- ~9% da base) mantêm o lead_name que o app definir.
  IF NEW.lead_id IS NOT NULL THEN
    SELECT l.lead_name
      INTO NEW.lead_name
      FROM public.leads l
     WHERE l.id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_activity_lead_name ON public.lead_activities;
CREATE TRIGGER trg_sync_activity_lead_name
BEFORE INSERT OR UPDATE OF lead_id ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.sync_activity_lead_name();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 2 — ao RENOMEAR um lead, propagar o novo nome para as atividades dele.
-- Atualiza por lead_id (índice idx_lead_activities_lead_id), só as que divergem.
-- Não altera lead_id, então NÃO dispara o trigger 1 (sem recursão).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propagate_lead_rename_to_activities()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.lead_activities
     SET lead_name = NEW.lead_name
   WHERE lead_id = NEW.id
     AND lead_name IS DISTINCT FROM NEW.lead_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_lead_rename ON public.leads;
CREATE TRIGGER trg_propagate_lead_rename
AFTER UPDATE OF lead_name ON public.leads
FOR EACH ROW
WHEN (NEW.lead_name IS DISTINCT FROM OLD.lead_name)
EXECUTE FUNCTION public.propagate_lead_rename_to_activities();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill (OPCIONAL — NÃO roda por padrão). Os triggers valem só pra escritas futuras;
-- as 422 atividades do incidente já foram sincronizadas por fora. Se quiser alinhar TODA a
-- base ao invariante, rode primeiro a contagem e avalie antes de aplicar (pode tocar muitas
-- linhas, pois lead_name foi usado de forma solta historicamente):
--
--   -- quantas divergem hoje:
--   SELECT count(*) FROM public.lead_activities a
--     JOIN public.leads l ON l.id = a.lead_id
--    WHERE a.lead_name IS DISTINCT FROM l.lead_name;
--
--   -- aplicar:
--   UPDATE public.lead_activities a
--      SET lead_name = l.lead_name
--     FROM public.leads l
--    WHERE l.id = a.lead_id
--      AND a.lead_name IS DISTINCT FROM l.lead_name;

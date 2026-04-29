-- Wave 2: Estender bridge de Cloud -> External para 6 tabelas adicionais.
-- A função bridge_activity_to_external() já é genérica (usa TG_OP e TG_TABLE_NAME).
-- Cada trigger é idempotente: drop + create.

DROP TRIGGER IF EXISTS bridge_legal_cases_to_external ON public.legal_cases;
CREATE TRIGGER bridge_legal_cases_to_external
AFTER INSERT OR UPDATE OR DELETE ON public.legal_cases
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();

DROP TRIGGER IF EXISTS bridge_lead_processes_to_external ON public.lead_processes;
CREATE TRIGGER bridge_lead_processes_to_external
AFTER INSERT OR UPDATE OR DELETE ON public.lead_processes
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();

DROP TRIGGER IF EXISTS bridge_lead_stage_history_to_external ON public.lead_stage_history;
CREATE TRIGGER bridge_lead_stage_history_to_external
AFTER INSERT OR UPDATE OR DELETE ON public.lead_stage_history
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();

DROP TRIGGER IF EXISTS bridge_process_parties_to_external ON public.process_parties;
CREATE TRIGGER bridge_process_parties_to_external
AFTER INSERT OR UPDATE OR DELETE ON public.process_parties
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();

DROP TRIGGER IF EXISTS bridge_team_chat_messages_to_external ON public.team_chat_messages;
CREATE TRIGGER bridge_team_chat_messages_to_external
AFTER INSERT OR UPDATE OR DELETE ON public.team_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();

DROP TRIGGER IF EXISTS bridge_team_chat_mentions_to_external ON public.team_chat_mentions;
CREATE TRIGGER bridge_team_chat_mentions_to_external
AFTER INSERT OR UPDATE OR DELETE ON public.team_chat_mentions
FOR EACH ROW EXECUTE FUNCTION public.bridge_activity_to_external();
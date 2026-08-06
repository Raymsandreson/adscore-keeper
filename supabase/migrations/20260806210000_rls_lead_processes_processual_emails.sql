-- =============================================================================
-- Fecha o acesso ANÔNIMO PURO em lead_processes e processual_emails — as duas
-- que sobraram do mesmo defeito corrigido em 20260806165000 (tabelas INSS) e
-- 20260806200000 (leads/contacts): policy criada com TO public, e public
-- inclui anon.
--
-- Medido com a chave anon do bundle, sem sign-in:
--   lead_processes    -> 1.770 linhas
--   processual_emails -> 2.719 linhas
--
-- Consumidores conferidos, todos SERVICE_ROLE (ignora RLS):
--   check-process-movements, sync-process-compromissos, backfill-process-marcos,
--   zapsign-webhook, whatsapp-command-processor, whatsapp-handoff-dispatch,
--   permanent-delete-lead, compute-monitor-snapshots, reclassify-process-marcos,
--   gmail-processual-sync, onboarding-checkpoint-execute
-- Front segue via signInAnonymously (role authenticated).
--
-- VERIFICADO depois, nas 6 tabelas tratadas em 06/08/2026:
--   anon puro -> */0 em leads, contacts, lead_processes, processual_emails,
--                inss_admin_processes, inss_status_history
--   sessão do app -> lead_processes 1.779, processual_emails 2.719
--
-- MESMO LIMITE: não fecha contra quem faz o sign-in anônimo, que sai em uma
-- requisição com a chave pública. Ver memória supabase-externo-rls-gap.
--
-- ROLLBACK: trocar authenticated de volta por public nas 3 linhas.
-- =============================================================================

alter policy "Authenticated users can manage lead_processes"
  on public.lead_processes to authenticated;

alter policy processual_emails_read_all  on public.processual_emails to authenticated;
alter policy processual_emails_write_all on public.processual_emails to authenticated;

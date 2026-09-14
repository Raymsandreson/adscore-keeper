-- Remoção de Thaíres Luana Leal Mendes do sistema — 13/08/2026
-- UUID único (Cloud == Externo): 3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8
-- email: thairesmendesadv@gmail.com
-- Banco: Externo kmedldlepwiityjsdahz
--
-- DECISÃO DO USUÁRIO (13/08/2026): os 13 processos em_andamento sob
-- responsabilidade dela FICAM COMO ESTÃO. Nada de reatribuição aqui.
--
-- Histórico preservado de propósito (NÃO tocar):
--   profiles(1), auth_uuid_mapping(1)  -> resolvem o nome nas ~2.900 referências
--   lead_activities created_by(454)/assigned_to(452)/completed_by(430)/updated_by(234)/deleted_by(10)
--   lead_activity_audit_log(660), activity_time_entries(555), user_activity_log(329)
--   activity_notifications(167+76), activity_attachments(86)
--   lead_processes responsible_user_id(13) + created_by(21), legal_cases.created_by(11)
--   team_messages(2), team_chat_mentions(3), work_shifts(43), user_timeblock_settings(45)
--   daily_goal_snapshots(5)

begin;

-- 1) BLOQUEIO DE ACESSO — não existe linha hoje, então é INSERT (não UPDATE).
--    O UserStatusGuard (src/components/auth/UserStatusGuard.tsx) lê esta tabela
--    e força signOut() na abertura do app. maybeSingle() null = NÃO bloqueia,
--    por isso a linha precisa existir.  [1 linha]
insert into org_user_status (user_id, name, active, updated_at, home_office)
values ('3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8', 'Thaíres Luana Leal Mendes', false, now(), false)
on conflict (user_id) do update set active = false, updated_at = now();

-- 2) Papel de acesso  [1 linha: role=member]
delete from user_roles
where user_id = '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8';

-- 3) Instâncias de WhatsApp  [2 linhas: "Atendimento Previdenciário" e "... 2"]
delete from whatsapp_instance_users
where user_id = '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8';

-- 4) Push — para de receber notificação no celular  [1 linha]
delete from push_subscriptions
where user_id = '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8';

-- 5) Time "Processual Previdenciário" (entrada criada hoje, 13/08 18:53)  [1 linha]
delete from team_members
where user_id = '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8';

-- 6) Conversas internas  [4 linhas]
delete from team_conversation_members
where user_id = '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8';

-- 7) work_shifts: NÃO TOCAR.
--    Levantamento mostrou 30 turnos com ended_at IS NULL de 43 totais — o app
--    simplesmente não fecha turno ao sair, é o padrão dela e da base. Fechar
--    todos com now() inventaria ~meses de jornada. Fica como está.

commit;

-- FORA DESTE SQL (feito por API/código):
--   a) auth do Externo: ban da conta espelho (guarda senha viva) via Admin API
--   b) auth do Cloud gliigkupoebmlbwyvijp: INACESSÍVEL daqui (403). Precisa ser
--      feito no dashboard do Supabase ou pelo Lovable — senão o login continua.
--   c) front: ASSIGNEE_BLOCKLIST em src/lib/assigneeBlocklist.ts

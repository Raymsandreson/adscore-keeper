-- ---------------------------------------------------------------------------
-- ROLLBACK do offboarding de Edilan da Silva Santos (14/09/2026, 18:36 UTC)
--
-- ext_uuid   4ede440c-f05a-40d6-a035-27ce0fe96870  (Externo: user_roles,
--            whatsapp_instance_users, auth.users, profiles, atividades)
-- cloud_uuid c989aa6b-e86e-4030-affc-7cabcf435b01  (só org_user_status usa este)
--
-- Linhas originais: scratchpad/edilan-backup-20260914.json
--
-- ESTE ARQUIVO É SAÍDA DE EMERGÊNCIA, NÃO É PARA RODAR.
-- O offboarding é a decisão vigente. Rodar isto devolve o acesso do Edilan,
-- inclusive o role `admin`, que é a porta da edge `admin-whatsapp-instance`.
-- Só execute com pedido explícito do gestor.
--
-- Procedência: o original foi gravado em /tmp (tmpfs) e o reboot de 14/09
-- apagou. Reconstruído no mesmo dia a partir do transcript da sessão
-- 56f74690-77e5-4701-b525-a7443eb2d8b3 (backup às 18:36:09Z, RETURNING das
-- escritas às 18:36:24Z) e conferido contra o banco: o estado de hoje é
-- exatamente o que o transcript descreve.
-- ---------------------------------------------------------------------------

begin;

-- 1) org_user_status — ele NÃO tinha linha antes (select devolveu []).
--    O offboarding fez INSERT com active=false. Desfazer é apagar a linha,
--    não marcar active=true.
delete from public.org_user_status
 where user_id = 'c989aa6b-e86e-4030-affc-7cabcf435b01';

-- 2) user_roles — 2 linhas apagadas. Os ids são os originais: reinserir com
--    o mesmo id mantém qualquer referência que aponte para eles.
insert into public.user_roles (id, user_id, role, created_at, access_profile_id) values
  ('abbcb869-d85e-47ff-8c51-bebbf1eab2de','4ede440c-f05a-40d6-a035-27ce0fe96870','admin','2026-03-30 20:57:22.76746+00', null),
  ('1f232cf6-f0b1-4f30-9fe3-58492aa4adc8','4ede440c-f05a-40d6-a035-27ce0fe96870','member','2026-02-10 18:26:14.392053+00','c8bc3058-9d05-4561-9566-b6acc8c1ec7a');

-- 3) whatsapp_instance_users — 3 linhas apagadas (Atendimento Previdenciário,
--    Andreia Atendimento Maternidade, Atendimento Processual).
insert into public.whatsapp_instance_users (id, instance_id, user_id, created_at) values
  ('28bb09f6-c1ca-4774-b4be-e016f22adf7a','4ac12887-9bbf-44dc-92bc-48a6b6e50806','4ede440c-f05a-40d6-a035-27ce0fe96870','2026-04-07 12:50:38.024376+00'),
  ('8f765097-110e-4e1f-9e7d-ab7117a8b8e5','f6a97ae2-e0b1-498d-b736-7e0e1d75886f','4ede440c-f05a-40d6-a035-27ce0fe96870','2026-04-19 16:13:51.530985+00'),
  ('ad9ffbff-ad49-4571-9e5f-84d9c7dee33c','cba1d1b9-6263-4029-b65a-a9e8964acdd7','4ede440c-f05a-40d6-a035-27ce0fe96870','2026-04-07 12:50:39.126441+00');

commit;

-- 4) Ban do auth do Externo (banned_until 2126-08-21) — NÃO sai por SQL daqui:
--    auth.users é do GoTrue. Desfazer pela Admin API, com o helper do repo:
--
--      node scratchpad/authban.mjs 4ede440c-f05a-40d6-a035-27ce0fe96870 none
--
--    Antes do offboarding o campo era `banned_until: null` (lido às 18:22:21Z),
--    então `none` devolve exatamente o estado anterior — não há data antiga
--    a restaurar.

-- ---------------------------------------------------------------------------
-- VERIFICAÇÃO (rodar depois; deve voltar 2 roles, 3 instâncias, sem linha de
-- status e sem ban):
--
-- scripts/db.sh "
-- select (select count(*) from org_user_status where user_id='c989aa6b-e86e-4030-affc-7cabcf435b01') as linhas_status,
--        (select count(*) from user_roles where user_id='4ede440c-f05a-40d6-a035-27ce0fe96870') as roles,
--        (select count(*) from whatsapp_instance_users where user_id='4ede440c-f05a-40d6-a035-27ce0fe96870') as instancias,
--        (select banned_until from auth.users where id='4ede440c-f05a-40d6-a035-27ce0fe96870') as ban"
--
-- ---------------------------------------------------------------------------
-- FORA DO ESCOPO DESTE ROLLBACK (nunca foram alterados, seguem como estavam):
--   profiles, auth_uuid_mapping, member_module_permissions (Cloud),
--   452 atividades pendentes, 8 work_shifts,
--   leads.acolhedor_user_id (1.064) e processual_responsible_id (426),
--   whatsapp_instances.owner_user_id da instância "Prev. Edilan" (b16fb149),
--   whatsapp_cloud_assignees.assigned_user_id (9 conversas).
-- ---------------------------------------------------------------------------

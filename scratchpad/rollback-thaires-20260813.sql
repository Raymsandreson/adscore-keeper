-- ROLLBACK da remoção de Thaíres Luana Leal Mendes — 13/08/2026
-- Restaura o estado exato lido do banco ANTES da execução.
-- UUID: 3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8

begin;

-- 1) Acesso: antes NÃO existia linha em org_user_status (maybeSingle() = null,
--    UserStatusGuard não bloqueava). Voltar ao estado original é APAGAR a linha.
delete from org_user_status
where user_id = '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8';

-- 2) user_roles  (id original preservado)
insert into user_roles (id, user_id, role, created_at, access_profile_id)
values ('b183e993-f3fe-4534-9348-e9e20c5c7ff2',
        '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8',
        'member', '2026-06-11T11:41:46.359838+00:00', null)
on conflict (id) do nothing;

-- 3) whatsapp_instance_users
insert into whatsapp_instance_users (id, instance_id, user_id, created_at) values
 ('6a455775-93de-486a-8913-568b411932c6','4ac12887-9bbf-44dc-92bc-48a6b6e50806','3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8','2026-06-11T11:49:10.942045+00:00'),
 ('6345ed3b-4ed9-4bfe-ab73-4d44208eac41','f62106c6-ab35-41d2-b994-9cb5088a4edf','3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8','2026-06-11T11:49:14.062888+00:00')
on conflict (id) do nothing;

-- 4) push_subscriptions — ver scratchpad/thaires-backup-20260813.json (endpoint/keys)
--    Restaurar dali; não fica hardcoded aqui por conter chave de push.

-- 5) team_members
insert into team_members (id, team_id, user_id, created_at, evaluated_metrics)
values ('ca1e1629-b601-4f15-8a33-9f0e9b11e2d6',
        'b6608407-3b16-4acf-932b-9f5267d870a8',
        '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8',
        '2026-08-13T18:53:43.884289+00:00', '{}')
on conflict (id) do nothing;

-- 6) team_conversation_members — ver scratchpad/thaires-backup-20260813.json
--    (4 linhas, com last_read_at original de cada conversa)

-- 7) work_shifts: não foi tocado na aplicação, nada a reverter.

commit;

-- FORA DESTE SQL:
--   a) auth do Externo: desbanir com banned_until = 'none' via Admin API
--   b) front: remover o UUID da ASSIGNEE_BLOCKLIST (git revert do commit)

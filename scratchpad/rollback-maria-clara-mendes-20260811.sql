-- Rollback da remoção de Maria Clara Mendes (a4eab7b5-8bcc-473e-804c-c412348b2aa1)
-- Aplicado em 11/08/2026 no Supabase Externo kmedldlepwiityjsdahz.
-- Rodar TUDO junto para desfazer. Não cobre: push_subscriptions (apagada; o
-- navegador dela recria a inscrição no próximo login) e a linha do user_roles
-- do CLOUD, que é removida pelo botão "Remover membro" da tela Equipe.

begin;

-- 1. Reativa o acesso (o UserStatusGuard lê esta tabela e desloga quem tem active=false)
delete from org_user_status where user_id = 'a4eab7b5-8bcc-473e-804c-c412348b2aa1';

-- 2. Devolve as 6 atividades pendentes (estavam com ela, foram para a Luana Barros)
update lead_activities set assigned_to = 'a4eab7b5-8bcc-473e-804c-c412348b2aa1',
       assigned_to_name = 'Maria Clara'
 where id in ('739126bf-db55-4396-bce5-50b5e255ae3a',
              'd1bf1f27-e5a2-48dd-8715-fd1f84878032');
update lead_activities set assigned_to = 'a4eab7b5-8bcc-473e-804c-c412348b2aa1',
       assigned_to_name = 'Maria Clara Mendes'
 where id in ('77900cee-8c5b-4aeb-afd8-a50ad5ff147a',
              '4fb32347-493e-4ad2-95f0-f4ef1c42e7c0',
              'ca5e431a-7098-41b2-9945-4cd92c3f526c',
              '6b34afa6-2458-41a2-852f-c8b44c49b413');

-- 3. Devolve as 3 instâncias de WhatsApp
insert into whatsapp_instance_users (id, user_id, instance_id, created_at) values
 ('38ac258a-40cd-4f3a-b025-86f45765ad7a','a4eab7b5-8bcc-473e-804c-c412348b2aa1','cba1d1b9-6263-4029-b65a-a9e8964acdd7','2026-08-10 13:23:09.217777+00'),
 ('8a720ae8-bfc9-44da-932d-4d20c877d37d','a4eab7b5-8bcc-473e-804c-c412348b2aa1','4ac12887-9bbf-44dc-92bc-48a6b6e50806','2026-08-10 13:23:33.641015+00'),
 ('244d4021-f3cc-4650-8bf3-9433cbdce485','a4eab7b5-8bcc-473e-804c-c412348b2aa1','f62106c6-ab35-41d2-b994-9cb5088a4edf','2026-08-10 13:23:36.363466+00')
on conflict (id) do nothing;

-- 4. Devolve o papel no Externo
insert into user_roles (id, user_id, role, created_at, access_profile_id) values
 ('070edbe4-09df-4aee-ba36-58088232df37','a4eab7b5-8bcc-473e-804c-c412348b2aa1','member','2026-08-10 13:02:48.892+00', null)
on conflict (id) do nothing;

-- 5. Reabre o turno e o timer que ficaram pendurados
update work_shifts set ended_at = null
 where id = '723d123e-85c1-4622-8e2d-af2549a23b51';
update activity_time_entries set status = 'running'
 where id = '85cb4455-68bc-404d-8e42-61c1a32fd89e';

-- 6. Reabre a credencial dela no auth do PRÓPRIO Externo (banida em 11/08/2026;
--    o auth.users do Cloud foi deletado pelo Lovable e não volta por aqui)
update auth.users set banned_until = null, updated_at = now()
 where id = 'a4eab7b5-8bcc-473e-804c-c412348b2aa1';

commit;

-- 6. No front: remover o uuid a4eab7b5-8bcc-473e-804c-c412348b2aa1 de
--    src/lib/assigneeBlocklist.ts e publicar.

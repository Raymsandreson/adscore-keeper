-- Rollback de user_account_permissions — gerado 24/08/2026
-- granted_by original era '79c5c9d1-8629-4831-83cf-c86a7178521c' (uuid do CLOUD do
-- raymsandresonadv). A FK user_account_permissions_granted_by_fkey aponta para o
-- auth.users do EXTERNO e rejeita esse valor -- as linhas originais so' existem
-- porque a constraint foi criada NOT VALID. Restauro com null: a permissao volta
-- igual, so' o autor se perde.
-- Restaura as 7 linhas removidas ao restringir a aba Conta.
INSERT INTO public.user_account_permissions (id, user_id, pluggy_account_id, granted_by, created_at) VALUES
  ('3bc35f98-3964-48fa-a07c-a9749ad31be0','75b9cb45-4117-49fa-b76c-78b83ad15776','13b79bd8-d25b-4a6f-b698-bc0fc9e8acaf',null,'2026-02-25 12:43:17.390115+00'),
  ('9b923ec5-9d5e-4292-ad39-7e2691fcccbc','b54ce59d-261c-4716-aa1e-d1fc4669acee','13b79bd8-d25b-4a6f-b698-bc0fc9e8acaf',null,'2026-02-14 00:58:04.636696+00'),
  ('ab758fb5-9e74-429f-a3e1-c441fbcda0ea','b54ce59d-261c-4716-aa1e-d1fc4669acee','a329be2c-5a2a-433f-9097-11323d25ddc6',null,'2026-02-14 00:58:04.636696+00'),
  ('6c05c41b-b61a-4be5-83fa-c7ca39be9695','b54ce59d-261c-4716-aa1e-d1fc4669acee','cd76ca1a-dd9e-4b40-8a13-9103c7a23492',null,'2026-02-14 00:58:04.636696+00'),
  ('fd92de84-6490-4328-b618-08408fec32f9','bacaa5ee-f1cc-4a9e-a3be-e3c668644c92','13b79bd8-d25b-4a6f-b698-bc0fc9e8acaf',null,'2026-02-24 18:55:42.253987+00'),
  ('24a34ebd-4cc2-493d-9fe9-e45e5bdb21a9','bacaa5ee-f1cc-4a9e-a3be-e3c668644c92','a329be2c-5a2a-433f-9097-11323d25ddc6',null,'2026-02-24 18:55:42.253987+00'),
  ('84269d86-c439-4446-b25b-2130c16b8440','bacaa5ee-f1cc-4a9e-a3be-e3c668644c92','cd76ca1a-dd9e-4b40-8a13-9103c7a23492',null,'2026-02-24 18:55:42.253987+00')
ON CONFLICT (id) DO NOTHING;

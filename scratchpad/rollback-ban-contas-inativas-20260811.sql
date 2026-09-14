-- Rollback do ban das contas inativas no auth.users do Supabase EXTERNO
-- (kmedldlepwiityjsdahz). Aplicado em 11/08/2026.
--
-- O que foi feito: banned_until = '2099-12-31' em 20 contas de pessoas já
-- desativadas em org_user_status.active = false, que ainda tinham senha
-- utilizável no espelho de auth do Externo. Nenhuma linha foi apagada, nenhum
-- CASCADE disparado, nenhum vínculo mexido — só essa coluna.
--
-- FORA do ban, de propósito (pedido do usuário em 11/08/2026): APENAS a conta
-- real da Maria Clara Nunes Milanez Araújo,
--   6300b2c3-a8d9-48b8-bdf1-86e25b224061  claramilanex@gmail.com  (16 pendentes)
-- A fantasma dela (755244a5, mariclaramilanex@) FOI banida, a pedido, e está na
-- lista abaixo.
--
-- A Maria Clara Mendes foi banida à parte; o rollback dela é o
-- rollback-maria-clara-mendes-20260811.sql.

-- Desfaz TUDO:
update auth.users set banned_until = null, updated_at = now()
 where id in (
  'a885ee79-333d-497e-a754-6121bbc1332d', -- Crisley Costa de Oliveira (582 pendentes)
  'a79b147a-4b5b-4250-a937-6f3492b2e9b5', -- Manoel Vitor Rocha Martins (8 pendentes)
  'd510d8ff-dcce-4598-900a-9d78269a3881', -- Mariana Vitório (5 pendentes)
  '5be06043-7def-4e64-b9c5-bc789fef29b7', -- Martin Rafael Ferreira Sulichin (1)
  'cf308900-869a-4383-a34e-52c46400f271', -- Renan Vieira Mendes (1)
  '2dbfb8c2-debc-4995-ada8-f3c2b217f1fc', -- Maria Lydia, conta duplicada (1)
  '3e12ad15-e061-466d-94eb-3f0d99fd51a9', -- Adalto Tavares Cavalcante Junior
  'b0f07415-4fa8-4997-bafb-7fa80ee2820f', -- Andriele Gomes Ferreira
  '1aa8d398-bc0b-46df-8821-b73da545637e', -- Arino da Silva Avelino
  'fc4288d3-9378-48d6-9333-cfdd03dbc626', -- Daniel Vieira Oliveira
  '1abf569d-d9a3-40a0-8e64-82bfde1827c9', -- Gedeon Rodrigues da Silva
  '60c150eb-ad34-4d8f-a564-8cf091323b8a', -- Guilherme (callface.ai)
  '56b2452d-3112-40ac-a52b-2e6d254245e7', -- Ingrede Suelen Ferreira Beserra Campos
  'f0a5dad8-5c5e-44f2-82b9-d8b9f022bb0c', -- KEILANE DE LIMA TEIXEIRA
  '30079161-55db-433b-b64e-c67a85fb320e', -- Luis da silva viana
  'e55bcaa7-00c8-467c-8f4f-49e7f48a1f08', -- Vera Lucia Rafael Justino
  'c51b52a9-3320-465f-9b57-57d1fdaccf3d', -- Viviane Amorim
  'fcdcfa1a-1d79-4df0-a4ce-ba09566cd550', -- conta de teste "xxx xxxx"
  '5758d388-9815-4dc5-9c61-6883d2a36f83', -- conta de teste "xxxxx xxxxxxxx"
  '02b34231-3b52-4691-8b23-bcf2a3b7bb4c', -- conta de teste "teste"
  '755244a5-cc2f-4d37-99d0-9468564de390'  -- Maria Clara Nunes, conta fantasma
 );

-- Desfaz só uma pessoa (troque o uuid):
-- update auth.users set banned_until = null, updated_at = now()
--  where id = 'COLE_O_UUID_AQUI';

-- Conferir DEPOIS, em statement separado — ler a mesma tabela dentro do
-- statement que a alterou devolve o snapshot anterior e engana:
-- select email, banned_until, banned_until > now() as bloqueado
--   from auth.users where id in (...);

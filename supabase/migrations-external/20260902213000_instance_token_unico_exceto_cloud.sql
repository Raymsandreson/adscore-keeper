-- Libera mais de uma linha da Cloud API em whatsapp_instances.
--
-- `whatsapp_instances_instance_token_key` é UNIQUE (instance_token). Faz todo
-- sentido no mundo UazAPI, onde o token É a credencial da conexão: duas linhas
-- com o mesmo token seriam dois nomes para o mesmo WhatsApp.
--
-- Só que as linhas da Cloud API não têm token próprio — a credencial delas é o
-- WHATSAPP_CLOUD_TOKEN do servidor, e a coluna guarda a sentinela constante
-- 'cloud_api_meta' só para marcar o canal. Com a ABRACI já ocupando esse valor,
-- nenhuma segunda linha Cloud consegue nascer (23505).
--
-- O invariante real continua: token de verdade é único. A sentinela fica de fora.
-- Alternativa descartada: dar token distinto por linha ('cloud_api_meta:<linha>').
-- Exigiria trocar o token da ABRACI em produção e virar os dois `.eq()` do front
-- em `like` — mais peça em movimento para o mesmo resultado.
--
-- Tabela com 26 linhas — índice normal, sem CONCURRENTLY.
--
-- ROLLBACK (só passa se sobrar no máximo uma linha Cloud):
--   drop index if exists public.whatsapp_instances_instance_token_key;
--   delete from public.whatsapp_instances
--    where instance_token = 'cloud_api_meta' and instance_name <> 'abraci';
--   alter table public.whatsapp_instances
--     add constraint whatsapp_instances_instance_token_key unique (instance_token);

alter table public.whatsapp_instances
  drop constraint if exists whatsapp_instances_instance_token_key;

create unique index if not exists whatsapp_instances_instance_token_key
  on public.whatsapp_instances (instance_token)
  where (instance_token <> 'cloud_api_meta');

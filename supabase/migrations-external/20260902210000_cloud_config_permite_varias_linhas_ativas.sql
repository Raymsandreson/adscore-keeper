-- Tira o singleton de banco de whatsapp_cloud_config.
--
-- `whatsapp_cloud_config_singleton` é UNIQUE em ((true)) WHERE is_active = true:
-- um índice sobre uma constante, ou seja, "no máximo UMA linha ativa, nunca duas".
-- Ele fazia sentido quando existia um número só — era o que garantia que o
-- maybeSingle() do código nunca visse duas linhas. Com o segundo número (ABRACI +
-- Prudêncio) ele passou a ser o que impede a configuração de existir: salvar a
-- segunda linha morre em 23505 duplicate key.
--
-- O invariante que continua valendo é outro: o MESMO número não pode estar ativo
-- em duas linhas ao mesmo tempo. É isso que o índice novo garante.
--
-- Tabela com 7 linhas — índice normal, sem CONCURRENTLY.
--
-- ROLLBACK (volta ao singleton; só funciona com no máximo 1 linha ativa):
--   drop index if exists public.whatsapp_cloud_config_phone_ativo_key;
--   update public.whatsapp_cloud_config set is_active = false
--    where is_active = true and instance_name is distinct from 'abraci';
--   create unique index whatsapp_cloud_config_singleton
--     on public.whatsapp_cloud_config ((true)) where (is_active = true);

drop index if exists public.whatsapp_cloud_config_singleton;

create unique index if not exists whatsapp_cloud_config_phone_ativo_key
  on public.whatsapp_cloud_config (phone_number_id)
  where (is_active = true);

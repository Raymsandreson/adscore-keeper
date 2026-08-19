-- Push nativo do app mobile (Fase 2 do escopo do WhatsJud Mobile).
--
-- Roda no cluster EXTERNO. `push_subscriptions` nasceu lá
-- (migrations-external/20260716140000_push_subscriptions.sql) e no Cloud a
-- tabela não existe — daí este arquivo morar em migrations-external. Guardado
-- na pasta errada, um `db push` no Cloud quebraria em "relation does not
-- exist", e o Externo, que é quem precisa, continuaria sem a coluna.
--
-- Até aqui `push_subscriptions` guardava só assinatura de Web Push VAPID, cujo
-- formato é { endpoint, p256dh, auth }. O Expo Push usa um token único
-- ("ExponentPushToken[...]") e não tem par de chaves — daí as três mudanças
-- abaixo. A tabela é reusada de propósito: criar uma segunda tabela de
-- destinatário duplicaria a regra de "quem recebe o quê", que é justamente onde
-- o push já errou duas vezes.
--
-- `user_id` continua sendo o uuid do CLOUD. Não mexer nisso: é o cluster de
-- equipe, e traduzir para o Externo aqui foi o bug que deixou 26 pessoas sem
-- notificação, em silêncio.

-- 1) De qual canal é esta linha.
alter table public.push_subscriptions
  add column if not exists provider text not null default 'webpush';

-- 2) Token do Expo não tem par de chaves. As colunas passam a aceitar nulo...
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth   drop not null;

-- ...mas a exigência continua valendo para quem É Web Push: sem as chaves a
-- biblioteca falha no envio, e uma linha assim seria lixo silencioso.
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_webpush_precisa_de_chaves;
alter table public.push_subscriptions
  add constraint push_subscriptions_webpush_precisa_de_chaves
  check (provider <> 'webpush' or (p256dh is not null and auth is not null));

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_provider_conhecido;
alter table public.push_subscriptions
  add constraint push_subscriptions_provider_conhecido
  check (provider in ('webpush', 'expo'));

-- 3) O mesmo aparelho reinstalando o app devolve o mesmo token. Sem unicidade,
-- cada abertura criaria uma linha nova e a pessoa receberia a notificação em
-- duplicata — que é como esse tipo de tabela vaza com o tempo.
create unique index if not exists push_subscriptions_endpoint_uk
  on public.push_subscriptions (endpoint);

-- Despacho filtra por canal; o índice evita varrer a tabela por provider.
create index if not exists push_subscriptions_provider_idx
  on public.push_subscriptions (provider);

comment on column public.push_subscriptions.provider is
  'webpush = assinatura VAPID do navegador (endpoint+p256dh+auth); expo = token do app mobile em endpoint, sem chaves.';

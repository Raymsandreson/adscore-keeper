-- whatsapp_avatars — cache da foto de perfil do WhatsApp por (instância, telefone).
--
-- Por que existe: a UazAPI (/chat/details) devolve a foto como URL de
-- pps.whatsapp.net com expiração assinada no próprio link (`oe=<epoch hex>`).
-- Medido em 26/08/2026 sobre whatsapp_chat_details_cache: 9 das 25 fotos mais
-- recentes já respondiam 403 — inclusive linhas gravadas no mesmo dia, porque a
-- UazAPI guarda a URL dela e devolve vencida. Guardar a URL crua e jogar num
-- <img> quebra a foto em dias, calado.
--
-- Então: get-whatsapp-avatars (Railway) baixa o binário, converte pra webp 256px
-- e guarda no bucket PRIVADO `wa-avatars`. Aqui fica só o ponteiro e a data da
-- última checagem.
--
-- Sem policy de propósito: foto de cliente é dado pessoal (LGPD). Quem lê e
-- escreve é a função do Railway, com service role; a sessão anônima do app não
-- alcança a tabela nem o bucket, e o front só recebe signed URL de 7 dias.
create table if not exists public.whatsapp_avatars (
  instance_name  text        not null,
  phone          text        not null,
  storage_path   text,
  has_photo      boolean     not null default false,
  source_key     text,
  checked_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (instance_name, phone)
);

alter table public.whatsapp_avatars enable row level security;

comment on table public.whatsapp_avatars is
  'Cache de foto de perfil do WhatsApp (UazAPI /chat/details). Imagem no bucket privado wa-avatars; acesso só por service role.';
comment on column public.whatsapp_avatars.source_key is
  'Nome do arquivo na URL do WhatsApp, sem query string — muda quando o cliente troca a foto. Evita reprocessar imagem igual.';
comment on column public.whatsapp_avatars.has_photo is
  'false = consultamos e o contato não expõe foto (privacidade). Reconsultado com TTL menor que o das fotos existentes.';

create index if not exists idx_whatsapp_avatars_checked_at
  on public.whatsapp_avatars (checked_at desc);

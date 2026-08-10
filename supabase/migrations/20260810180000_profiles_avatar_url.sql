-- Foto de perfil do usuário — coluna em profiles + bucket de armazenamento.
-- Projeto alvo: Supabase Externo (kmedldlepwiityjsdahz), onde vive profiles.
--
-- Por que o upload NÃO sai direto do navegador: a sessão do app no Externo é
-- anônima (src/integrations/supabase/external-client.ts → signInAnonymously),
-- então auth.uid() nunca é igual a profiles.user_id e a policy de UPDATE
-- ("Users can update their own profile or admins can update all") barra a
-- gravação — is_admin() também dá false, porque o uuid anônimo não tem role.
-- Quem grava é a função update-profile-avatar no Railway, com service role,
-- depois de validar o JWT do Cloud. Por isso o bucket não recebe policy de
-- escrita: service role passa por cima de RLS e ninguém mais escreve nele.
--
-- ROLLBACK (reversível em <1min; não altera nenhum dado existente):
--   alter table public.profiles drop column if exists avatar_url;
--   drop policy if exists "avatars_public_read" on storage.objects;
--   delete from storage.objects where bucket_id = 'avatars';
--   delete from storage.buckets where id = 'avatars';

-- 1) Coluna. Nullable: quem não tem foto continua caindo nas iniciais.
alter table public.profiles add column if not exists avatar_url text;

-- 2) Bucket. Público na leitura (mesmo padrão de org-logos); o caminho carrega
--    o uuid do perfil + timestamp, então a URL não é adivinhável. Limite de 2MB
--    é folga larga: o servidor grava webp 512px (~40-60KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- 3) Leitura pública explícita (o bucket público já dispensaria, mas org-logos
--    tem a policy equivalente e manter o par simétrico evita surpresa se o
--    bucket for fechado depois).
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'avatars');

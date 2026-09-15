-- =============================================================================
-- Sessão de verdade no Externo para quem está logado no Cloud (10/09/2026).
--
-- O front autentica no Cloud e, até hoje, entrava no Externo com
-- signInAnonymously(). Qualquer pessoa com a chave anon fazia o mesmo e virava
-- `authenticated` (6.277 anônimos contra 55 reais). A partir de agora o front
-- pede ao Railway (`/functions/external-session`) uma sessão do usuário
-- espelho — o de `auth_uuid_mapping` (53 pares) — e a aplica com setSession.
-- Detalhes: railway-server/src/functions/external-session.ts e
-- src/integrations/supabase/external-client.ts.
--
-- Esta migration só cria o apoio SQL: achar o usuário do Externo pelo e-mail
-- sem expor auth.users. Só service_role executa.
--
-- DEPOIS DE VER A ROTA EM USO (auth.users: last_sign_in_at dos usuários
-- mapeados andando; criação de anônimos parando), desligar no painel do Auth
-- do Externo: Authentication → Sign In / Providers → "Allow anonymous
-- sign-ins" = off. Rollback: religar o mesmo botão.
-- APLICADO em 10/09/2026.
-- =============================================================================
create or replace function public.ext_user_id_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.id from auth.users u
   where lower(u.email) = lower(btrim(p_email)) and not coalesce(u.is_anonymous, false)
   order by u.created_at limit 1;
$$;
revoke all on function public.ext_user_id_por_email(text) from public, anon, authenticated;
grant execute on function public.ext_user_id_por_email(text) to service_role;

-- =============================================================================
-- Fecha duas portas do papel `anon` no projeto externo (10/09/2026).
--
-- O QUE FOI VISTO (09/09, testando a REST pelo pg_net com a chave anon, que
-- vai no bundle do front): a vw_caso_grupo_conciliacao respondeu 200 com nome
-- de lead e número de caso. Conferido: TODAS as 51 views `vw_*` do schema
-- public tinham SELECT para `anon` — é o default privilege do Supabase para
-- objetos criados em public (pg_default_acl: anon=arwdDxtm), não um grant de
-- migration. E 36 tabelas (backups zz_*, staging, listas de trabalho) estavam
-- sem RLS, também legíveis pela chave anon.
--
-- O QUE MUDA
--   1. revoke all on <cada view vw_*> from anon. O front NÃO usa o papel anon:
--      ensureExternalSession() faz signInAnonymously(), que devolve JWT com
--      papel `authenticated`. Nenhuma edge nem o railway lê view com a chave
--      anon (conferido no código). Zero impacto esperado.
--   2. enable row level security nas 36 tabelas que não tinham. Sem policy,
--      só service_role e funções security definer alcançam — que é quem as
--      usa (dom_lexemas_comuns: dom_refresh_lexemas_comuns e
--      dom_respostas_parecidas, ambas secdef). Nenhuma delas aparece no
--      código do front/edges/railway.
--
-- O QUE NÃO MUDA (e é a porta de verdade, registrada para decisão do Raym):
--   default privileges continuam dando tudo a anon/authenticated em objetos
--   novos de public; e qualquer pessoa com a chave anon pode fazer
--   signInAnonymously() e virar `authenticated` — 6.277 usuários anônimos,
--   168 por dia, contra 55 usuários reais. Enquanto o front depender de
--   sessão anônima, "authenticated" quer dizer "qualquer um". O conserto é o
--   Railway emitir um JWT do projeto externo para quem está logado no Cloud
--   e desligar o sign-in anônimo — projeto à parte.
--
-- ROLLBACK
--   grant select on <view> to anon;   (lista abaixo, gravada no momento)
--   alter table <tabela> disable row level security;
-- =============================================================================
do $mig$
declare r record; v_views text := ''; v_tabelas text := '';
begin
  for r in
    select table_name from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT' and table_name like 'vw\_%'
     order by table_name
  loop
    execute format('revoke all on public.%I from anon', r.table_name);
    v_views := v_views || r.table_name || ', ';
  end loop;

  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
     order by c.relname
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    v_tabelas := v_tabelas || r.relname || ', ';
  end loop;

  raise notice 'views sem anon: %', v_views;
  raise notice 'tabelas com RLS ligada: %', v_tabelas;
end $mig$;

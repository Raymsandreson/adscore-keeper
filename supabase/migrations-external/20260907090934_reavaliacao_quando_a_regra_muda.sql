-- =============================================================================
-- Mexer em `escopo_prefixos` passa a reclassificar os grupos de verdade.
--
-- O BURACO
-- `dom_reavaliar_escopo` (migration 20260907090811) só reavalia grupo cujo NOME
-- mudou:
--
--     and (g.escopo_avaliado_em is null or g.nome_avaliado is distinct from g.group_name)
--
-- Isso está certo para o caso comum — renomear grupo é o que acontece todo dia,
-- e reavaliar 1.149 grupos a cada rodada seria desperdício. Mas cobre só metade
-- do problema: quando muda a REGRA (alguém desativa FAMILIA, ou cadastra um
-- prefixo novo), o nome de nenhum grupo mudou, então nenhum grupo é reavaliado
-- e a edição não faz efeito nenhum.
--
-- Medido em 07/09/2026, logo depois de aplicar a migration anterior:
--     update escopo_prefixos set ativo = false where prefixo = 'FAMILIA';
--     select dom_reavaliar_escopo();
--     -> operacional 1.146, nao_classificado 3   (idêntico a antes)
--
-- Os 76 grupos FAMILIA continuavam operacionais com um prefixo desativado.
-- A tabela dizia uma coisa e o comportamento era outro — que é pior do que ter
-- o regex hardcoded, porque hardcoded pelo menos não mente.
--
-- A METÁFORA
-- Trocar a fechadura e não recolher as chaves antigas. A porta parece nova,
-- mas quem já tinha chave continua entrando.
--
-- O CONSERTO, EM DUAS PARTES
-- 1. `dom_reavaliar_escopo(p_group_jid, p_forcar)` — com `p_forcar = true` ela
--    reavalia tudo, tenha o nome mudado ou não. `escopo_manual` continua
--    respeitado nos dois modos: override humano é decisão, não cache.
-- 2. Trigger em `escopo_prefixos` que chama a versão forçada. Assim a promessa
--    "editável em runtime, sem deploy" passa a ser verdade sem ninguém precisar
--    lembrar de rodar a função na mão.
--
-- CUSTO
-- O trigger é de STATEMENT, não de linha: um `insert` com 3 prefixos dispara
-- uma reavaliação, não três. E prefixo muda em escala de meses, não de minutos.
-- =============================================================================

-- A assinatura antiga precisa sair: `dom_reavaliar_escopo(text)` e
-- `dom_reavaliar_escopo(text, boolean default)` deixariam a chamada com um
-- argumento só ambígua, e o Postgres recusaria em runtime.
drop function if exists public.dom_reavaliar_escopo(text);

create or replace function public.dom_reavaliar_escopo(
  p_group_jid text default null,
  p_forcar    boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mexidos integer;
begin
  with alvo as (
    select g.group_jid, g.group_name, c.prefixo, c.area
      from public.dom_grupos_piloto g
      left join lateral public.dom_classificar_escopo(g.group_name) c on true
     where not g.escopo_manual
       and (p_group_jid is null or g.group_jid = p_group_jid)
       and (p_forcar
            or g.escopo_avaliado_em is null
            or g.nome_avaliado is distinct from g.group_name)
  )
  update public.dom_grupos_piloto g
     set escopo_status      = case when a.area is null then 'nao_classificado' else 'operacional' end,
         area               = a.area,
         prefixo_detectado  = a.prefixo,
         nome_avaliado      = a.group_name,
         escopo_avaliado_em = now()
    from alvo a
   where g.group_jid = a.group_jid
     -- Sem isto, o modo forçado carimbaria `escopo_avaliado_em` em 1.149 linhas
     -- a cada edição de prefixo, sujando o rastro de quando o escopo realmente
     -- mudou. Só grava quem de fato muda de veredito.
     and (g.escopo_status    is distinct from case when a.area is null then 'nao_classificado' else 'operacional' end
       or g.area             is distinct from a.area
       or g.prefixo_detectado is distinct from a.prefixo
       or g.nome_avaliado    is distinct from a.group_name);

  get diagnostics v_mexidos = row_count;
  return v_mexidos;
end $$;

comment on function public.dom_reavaliar_escopo(text, boolean) is
  'Reclassifica grupos. p_forcar = true ignora o cache por nome (usado quando a REGRA muda). Sempre respeita escopo_manual.';


-- O gatilho: editar a tabela de prefixos reclassifica sozinho.
create or replace function public.dom_escopo_prefixos_mudou()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.dom_reavaliar_escopo(null, true);
  return null;
end $$;

drop trigger if exists trg_escopo_prefixos_reavalia on public.escopo_prefixos;

create trigger trg_escopo_prefixos_reavalia
  after insert or update or delete on public.escopo_prefixos
  for each statement
  execute function public.dom_escopo_prefixos_mudou();

comment on function public.dom_escopo_prefixos_mudou() is
  'Trigger de statement: qualquer mudança em escopo_prefixos reclassifica os grupos na hora.';


-- Reconcilia o estado deixado pelo teste que descobriu o buraco.
select public.dom_reavaliar_escopo(null, true);


-- =============================================================================
-- ROLLBACK
--
-- begin;
-- drop trigger if exists trg_escopo_prefixos_reavalia on public.escopo_prefixos;
-- drop function if exists public.dom_escopo_prefixos_mudou();
-- drop function if exists public.dom_reavaliar_escopo(text, boolean);
--
-- -- volta a versão de 20260907090811 (sem p_forcar)
-- create or replace function public.dom_reavaliar_escopo(p_group_jid text default null)
-- returns integer language plpgsql security definer set search_path to 'public'
-- as $f$
-- declare v_mexidos integer;
-- begin
--   with alvo as (
--     select g.group_jid, g.group_name, c.prefixo, c.area
--       from public.dom_grupos_piloto g
--       left join lateral public.dom_classificar_escopo(g.group_name) c on true
--      where not g.escopo_manual
--        and (p_group_jid is null or g.group_jid = p_group_jid)
--        and (g.escopo_avaliado_em is null or g.nome_avaliado is distinct from g.group_name))
--   update public.dom_grupos_piloto g
--      set escopo_status = case when a.area is null then 'nao_classificado' else 'operacional' end,
--          area = a.area, prefixo_detectado = a.prefixo,
--          nome_avaliado = a.group_name, escopo_avaliado_em = now()
--     from alvo a where g.group_jid = a.group_jid;
--   get diagnostics v_mexidos = row_count;
--   return v_mexidos;
-- end $f$;
-- commit;
-- =============================================================================

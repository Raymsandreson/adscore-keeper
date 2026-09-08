-- =============================================================================
-- A varredura de processos citados passa a cobrir TODOS os grupos de caso,
-- não só o piloto do Dom.
--
-- O QUE O RAYM VIU (08/09/2026): "são muito mais grupos" — 368 CASO/FAMÍLIA e
-- ~2.000 PREV na lista, todos com número de processo nas mensagens. Medido:
--
--     grupos no índice (whatsapp_groups_index)          6.671
--       o classificador de escopo do Dom aceita         2.464   (prefixo + número)
--         já no piloto (o detector varria)              1.133
--         FORA do piloto — nunca varridos               1.331   ← 1.109 PREV + 222 CASO/FAMÍLIA
--       nome sem prefixo+número (CC425, BD76, LEAD...)  4.191   fora do escopo, como sempre
--
-- Ou seja: o detector cobria 46% dos grupos de caso. O resto tem, em média,
-- 113 mensagens por grupo (amostra de 100), e nunca foi lido.
--
-- POR QUE NÃO ENTRAM NO DOM
-- dom_grupos_piloto é a lista onde o Dom FALA. Tudo que o Dom faz filtra
-- `ativo = true` (dom-rascunho, dom-contexto, dom-cobranca,
-- dom_grupos_para_olhar, vw_dom_grupo_sem_ficha — conferido um a um). Nada
-- liga `ativo` sozinho: só o switch da tela. Então os 1.331 entram com
-- `ativo = false` e `so_varredura = true`: o detector e o vinculador os
-- leem; o Dom continua mudo neles. Ligar o Dom lá é decisão à parte, com
-- custo de modelo por rascunho — não é o que se decide aqui.
--
-- O escopo é o do próprio Dom: dom_classificar_escopo(nome) (tabela
-- escopo_prefixos). Grupo pessoal com "família" no meio do nome NÃO entra —
-- foi o furo de 06/09 ("Familia gold1p.x"), e a regra que o fechou vale aqui.
--
-- O QUE MUDA
--   1. coluna dom_grupos_piloto.so_varredura (default false).
--   2. os 1.331 grupos entram com ativo=false, so_varredura=true, e passam
--      pelo dom_reavaliar_escopo() como qualquer outro.
--   3. detectar_processos_em_grupos, vincular_processos_citados_no_grupo e
--      rodar_processos_citados_no_grupo aceitam `ativo or so_varredura`.
--   4. A lista "grupos do Dom" da tela (AtendenteDeCasoSection) esconde os
--      so_varredura — senão viram 1.331 chaves de liga/desliga na tela.
--
-- CUSTO. Só regex sobre mensagens, sem modelo: ~1.331 × 113 ≈ 150 mil linhas,
-- uma vez, por índice de telefone. O cron faz 300 grupos/hora; a primeira
-- carga pode ser puxada à mão em lotes.
--
-- APLICADO em 08/09/2026 com aval do Raym. Inseridos 1.335 (1.112 prev +
-- 223 trab), todos operacional, 0 com ativo. Varridos em 4 lotes na hora:
-- 114 citam algum CNJ (81 já no lead, 51 viraram processo do grupo em 42
-- grupos, 50 fila). PREV amostrados (293): 8 citam CNJ, 17 citam número do
-- INSS, 268 nenhum — o detector lê só CNJ; número do INSS é o próximo degrau.
--
-- ROTA DE FUGA
--   delete from grupo_processo_detectado d using dom_grupos_piloto g
--    where g.group_jid = d.group_jid and g.so_varredura;
--   delete from dom_grupos_piloto where so_varredura;
--   (as pontes que o vinculador criar têm auto_linked = true e log com source)
-- =============================================================================

-- ── 1. A coluna ──────────────────────────────────────────────────────────────
alter table public.dom_grupos_piloto
  add column if not exists so_varredura boolean not null default false;

comment on column public.dom_grupos_piloto.so_varredura is
  'true = o grupo está aqui SÓ para a varredura de processos citados; o Dom não fala nele '
  '(ativo=false). Entrou em 08/09/2026 pela regra "processo citado no grupo é do grupo".';

-- ── 2. Os grupos de caso que estavam fora ────────────────────────────────────
do $mig$
declare v_n integer; v_esc integer;
begin
  with idx as (
    select distinct on (jid_chave(g.group_jid))
           jid_chave(g.group_jid) as chave, g.contact_name as nome
      from whatsapp_groups_index g
     order by jid_chave(g.group_jid), g.last_seen desc nulls last, g.updated_at desc nulls last
  )
  insert into dom_grupos_piloto (group_jid, group_name, ativo, so_varredura, modo, observacao)
  select i.chave, i.nome, false, true, 'rascunho',
         'Só varredura de processos citados; o Dom não fala aqui. Entrou em 08/09/2026 (regra: processo citado no grupo é do grupo).'
    from idx i
    join lateral dom_classificar_escopo(i.nome) c on true
   where c.area is not null
     and not exists (select 1 from dom_grupos_piloto p where p.group_jid = i.chave)
  on conflict (group_jid) do nothing;
  get diagnostics v_n = row_count;

  select dom_reavaliar_escopo() into v_esc;
  raise notice 'grupos só-varredura inseridos: % · escopo reavaliado em: %', v_n, v_esc;
end $mig$;

-- ── 3. O detector aceita os só-varredura ─────────────────────────────────────
do $mig$
declare
  def text;
  velho text := $a$     where g.ativo
       and g.escopo_status = 'operacional'$a$;
  novo  text := $b$     where (g.ativo or g.so_varredura)
       and g.escopo_status = 'operacional'$b$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'detectar_processos_em_grupos';
  if position(velho in def) = 0 then
    raise exception 'detector: âncora "where g.ativo" não encontrada — NADA alterado';
  end if;
  execute replace(def, velho, novo);
end $mig$;

-- ── 4. O vinculador idem ─────────────────────────────────────────────────────
create or replace function public.vincular_processos_citados_no_grupo(p_group_jid text default null)
returns table(pontes_criadas integer, processos_do_grupo integer, deixados_na_fila integer)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_pontes   integer := 0;
  v_marcados integer := 0;
  v_fila     integer := 0;
  v_n        integer := 0;
  r record;
begin
  for r in
    with cit as (
      select d.group_jid, d.cnj, g.group_name,
             (select array_agg(distinct p.lead_id)
                from lead_processes p
               where p.deleted_at is null and p.lead_id is not null
                 and cnj_digitos(p.process_number) = d.cnj) as donos,
             exists (select 1 from lead_whatsapp_groups lg
                      where jid_chave(lg.group_jid) = d.group_jid
                        and lg.lead_id is not null) as tem_ponte,
             exists (select 1 from leads l
                      where l.deleted_at is null and l.whatsapp_group_id is not null
                        and jid_chave(l.whatsapp_group_id) = d.group_jid) as tem_cadastro,
             (select kg.numero from busca_chave_caso(g.group_name, false) kg limit 1) as numero_grupo
        from grupo_processo_detectado d
        join dom_grupos_piloto g on g.group_jid = d.group_jid and (g.ativo or g.so_varredura)
       where d.status = 'eco_da_casa'
         and d.origem = 'equipe'
         and cnj_valido(d.cnj)
         and (p_group_jid is null or d.group_jid = jid_chave(p_group_jid))
    )
    select c.*,
           cardinality(c.donos) as n_donos,
           (select bool_or(kd.numero = c.numero_grupo)
              from unnest(c.donos) u(lead_id)
              join leads l on l.id = u.lead_id,
              lateral busca_chave_caso(coalesce(l.case_number, l.lead_name, l.victim_name), false) kd
           ) as numero_bate
      from cit c
     where c.donos is not null
  loop
    if r.numero_grupo is null or not coalesce(r.numero_bate, false) then
      v_fila := v_fila + 1;
      continue;
    end if;

    if not r.tem_ponte and not r.tem_cadastro then
      if r.n_donos <> 1 then
        v_fila := v_fila + 1;
        continue;
      end if;
      insert into lead_whatsapp_groups (lead_id, group_jid, group_name, auto_linked)
      values (r.donos[1], r.group_jid || '@g.us', r.group_name, true)
      on conflict do nothing;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        insert into lead_group_audit_log (action, group_jid, group_name, lead_id, lead_name, result, source)
        select 'link', r.group_jid || '@g.us', r.group_name, l.id, l.lead_name, 'success',
               'vincular_processos_citados_no_grupo'
          from leads l where l.id = r.donos[1];
        v_pontes := v_pontes + 1;
      end if;
    end if;

    update grupo_processo_detectado
       set status = 'processo_do_grupo',
           lead_id = case when r.n_donos = 1 then r.donos[1] else lead_id end,
           atualizado_em = now()
     where group_jid = r.group_jid and cnj = r.cnj;
    v_marcados := v_marcados + 1;
  end loop;

  return query select v_pontes, v_marcados, v_fila;
end $fn$;

-- ── 5. O cron idem ───────────────────────────────────────────────────────────
create or replace function public.rodar_processos_citados_no_grupo(p_horas integer default 3)
returns table(grupos_revarridos integer, grupos_varridos integer, cnjs_registrados integer,
              pontes_criadas integer, processos_do_grupo integer, deixados_na_fila integer)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_re integer := 0; v_g integer := 0; v_c integer := 0;
  v_p integer := 0;  v_m integer := 0; v_f integer := 0;
begin
  with novas as (
    select distinct m.phone
      from whatsapp_messages m
     where m.created_at > now() - make_interval(hours => greatest(p_horas, 1))
       and m.phone like '1203%'
       and m.message_text ~ '\d{7}[-.]?\d{2}[.]?\d{4}[.]?\d[.]?\d{2}[.]?\d{4}'
  )
  update dom_grupos_piloto g
     set processos_varridos_em = null
    from novas n
   where n.phone = g.group_jid
     and (g.ativo or g.so_varredura) and g.escopo_status = 'operacional'
     and g.processos_varridos_em is not null;
  get diagnostics v_re = row_count;

  select t.grupos_varridos, t.cnjs_registrados into v_g, v_c
    from detectar_processos_em_grupos(300) t;
  select t.pontes_criadas, t.processos_do_grupo, t.deixados_na_fila into v_p, v_m, v_f
    from vincular_processos_citados_no_grupo() t;

  return query select v_re, v_g, v_c, v_p, v_m, v_f;
end $fn$;

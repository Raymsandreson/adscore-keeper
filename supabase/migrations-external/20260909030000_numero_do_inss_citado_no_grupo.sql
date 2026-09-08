-- =============================================================================
-- O número do INSS citado no grupo também é do grupo — o degrau dos PREV.
--
-- O QUE FALTAVA (08/09/2026). O detector lia só CNJ. Nos PREV o número que a
-- equipe cita é o do REQUERIMENTO do INSS (protocolo, 9–10 dígitos) ou o do
-- benefício (NB). Amostra de 293 PREV: 8 citam CNJ, 17 citam número do INSS.
--
-- POR QUE NÃO DÁ PARA LER "QUALQUER NÚMERO". CNJ tem dígito verificador; o
-- número do INSS não. 10 dígitos soltos podem ser telefone, CPF, valor.
-- Medido em 400 PREV (números de 9–11 dígitos fora de CNJ):
--     11 dígitos ....... 399 distintos, ZERO batem com o INSS  → telefone/CPF
--     10 dígitos ........ 81 distintos, 61 existem em inss_admin_processes
--      9 dígitos ........ 45 distintos, 32 existem
--     com a palavra "processo" na frente: 45 distintos, 43 existem
-- A palavra-âncora ajuda pouco; o que separa número de requerimento de número
-- qualquer é EXISTIR como requerimento no sistema. Então a trava é essa:
--   só registra número de 8–10 dígitos que exista em inss_admin_processes
--   (requerimento_number ou benefit_number) ou em lead_processes
--   administrativo. Número desconhecido não entra nem na fila — seria fila de
--   lixo.
-- Os tamanhos reais: requerimento_number tem 10 (645), 9 (476) ou 8 (50)
-- dígitos; lead_processes administrativo idem. Por isso 8–10.
--
-- O QUE MUDA
-- 1. grupo_processo_detectado.tipo: 'cnj' | 'inss'. Mesma chave (group_jid,
--    cnj) — a coluna `cnj` guarda os dígitos do número, seja qual for o tipo.
-- 2. detectar_processos_em_grupos: além do CNJ, extrai tokens de 8–10 dígitos
--    (fora de CNJ, com fronteira de palavra — 11+ dígitos não casam) e mantém
--    só os que existem. "Já está no lead" (ignorado) passa a olhar também os
--    números administrativos do lead e os requerimentos do INSS dele.
-- 3. vincular_processos_citados_no_grupo: o dono do número vem de
--    lead_processes OU de inss_admin_processes.lead_id. Regras iguais.
-- 4. vw_grupo_processo_desalinhado / vw_grupo_processo_conciliacao: sabem o
--    tipo; não passam número do INSS pelo cnj_formatado.
-- 5. resolver_processo_citado: dono via as duas tabelas; se precisar
--    cadastrar, cadastra como 'administrativo'.
-- 6. dom_contexto_processual: requerimentos_inss = do lead ∪ citados no grupo
--    (por dígitos do requerimento_number). O Dom passa a saber do
--    requerimento mesmo quando ele está em outro lead.
-- 7. rodar_processos_citados_no_grupo: re-varre também grupo com mensagem
--    nova que tenha número de 8–10 dígitos.
--
-- ROTA DE FUGA
--   detectar_processos_em_grupos_antes_do_inss / dom_contexto_processual_antes_do_inss
--   guardam as versões de antes. Linhas novas: tipo = 'inss'.
--     update grupo_processo_detectado set status = 'eco_da_casa' where tipo = 'inss';
--     delete from grupo_processo_detectado where tipo = 'inss';
-- =============================================================================

-- ── 0. Rotas de fuga ─────────────────────────────────────────────────────────
do $mig$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'detectar_processos_em_grupos';
  execute replace(def, 'FUNCTION public.detectar_processos_em_grupos(', 'FUNCTION public.detectar_processos_em_grupos_antes_do_inss(');
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';
  execute replace(def, 'FUNCTION public.dom_contexto_processual(', 'FUNCTION public.dom_contexto_processual_antes_do_inss(');
end $mig$;

-- ── 1. O tipo ────────────────────────────────────────────────────────────────
alter table public.grupo_processo_detectado
  add column if not exists tipo text not null default 'cnj';
alter table public.grupo_processo_detectado
  drop constraint if exists grupo_processo_detectado_tipo_ck;
alter table public.grupo_processo_detectado
  add constraint grupo_processo_detectado_tipo_ck check (tipo in ('cnj', 'inss'));
-- A coluna `cnj` exigia 20 dígitos. Passa a exigir o formato do TIPO.
alter table public.grupo_processo_detectado
  drop constraint if exists grupo_processo_detectado_cnj_ck;
alter table public.grupo_processo_detectado
  add constraint grupo_processo_detectado_cnj_ck check (
    (tipo = 'cnj'  and cnj ~ '^[0-9]{20}$') or
    (tipo = 'inss' and cnj ~ '^[0-9]{8,10}$')
  );
comment on column public.grupo_processo_detectado.tipo is
  'cnj = processo judicial (20 dígitos, dígito verificador). inss = requerimento/benefício do INSS '
  '(8–10 dígitos; só entra se existir em inss_admin_processes ou lead_processes administrativo).';

-- ── 2. O detector lê CNJ e número do INSS ────────────────────────────────────
create or replace function public.detectar_processos_em_grupos(p_limite integer default 50, p_group_jid text default null)
returns table(grupos_varridos integer, cnjs_registrados integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_re      constant text := '\d{7}[-.]?\d{2}[.]?\d{4}[.]?\d[.]?\d{2}[.]?\d{4}';
  c_re_inss constant text := '\m\d{8,10}\M';
  v_grupos integer := 0;
  v_cnjs   integer := 0;
begin
  drop table if exists _alvo;
  drop table if exists _equipe;
  drop table if exists _lead_do_grupo;
  drop table if exists _cnjs_do_lead;
  drop table if exists _achado;
  drop table if exists _quantos_cnj;

  create temporary table _alvo on commit drop as
    select g.group_jid
      from public.dom_grupos_piloto g
     where (g.ativo or g.so_varredura)
       and g.escopo_status = 'operacional'
       and (p_group_jid is null or g.group_jid = p_group_jid)
       and (p_group_jid is not null or g.processos_varridos_em is null)
     order by g.group_jid
     limit greatest(p_limite, 1);

  select count(*) into v_grupos from _alvo;
  if v_grupos = 0 then
    return query select 0, 0;
    return;
  end if;

  create temporary table _equipe on commit drop as
    select distinct right(regexp_replace(phone, '\D', '', 'g'), 8) as fim
      from public.dom_numeros_equipe where ativo and phone is not null
    union
    select distinct right(regexp_replace(owner_phone, '\D', '', 'g'), 8)
      from public.whatsapp_instances where is_active and owner_phone is not null;

  create temporary table _lead_do_grupo on commit drop as
    select a.group_jid,
           count(distinct lg.lead_id) as leads,
           (array_agg(distinct lg.lead_id))[1] as lead_id
      from _alvo a
      left join public.lead_whatsapp_groups lg
             on public.jid_chave(lg.group_jid) = public.jid_chave(a.group_jid)
     group by a.group_jid;

  -- Os números que o lead do grupo JÁ tem: CNJs e administrativos em
  -- lead_processes, e requerimento/benefício em inss_admin_processes.
  create temporary table _cnjs_do_lead on commit drop as
    select distinct a.group_jid, public.cnj_digitos(p.process_number) as cnj
      from _alvo a
      join public.lead_whatsapp_groups lg
        on public.jid_chave(lg.group_jid) = public.jid_chave(a.group_jid)
      join public.lead_processes p
        on p.lead_id = lg.lead_id and p.deleted_at is null
     where length(public.cnj_digitos(p.process_number)) between 8 and 20
    union
    select distinct a.group_jid, regexp_replace(i.requerimento_number, '\D', '', 'g')
      from _alvo a
      join public.lead_whatsapp_groups lg
        on public.jid_chave(lg.group_jid) = public.jid_chave(a.group_jid)
      join public.inss_admin_processes i
        on i.lead_id = lg.lead_id and i.deleted_at is null
     where coalesce(i.requerimento_number, '') <> ''
    union
    select distinct a.group_jid, regexp_replace(i.benefit_number, '\D', '', 'g')
      from _alvo a
      join public.lead_whatsapp_groups lg
        on public.jid_chave(lg.group_jid) = public.jid_chave(a.group_jid)
      join public.inss_admin_processes i
        on i.lead_id = lg.lead_id and i.deleted_at is null
     where coalesce(i.benefit_number, '') <> '';

  create temporary table _achado on commit drop as
    with msgs as (
      select a.group_jid, m.id as msg_id, m.created_at, m.message_text,
             right(regexp_replace(
               coalesce(m.metadata -> 'message' ->> 'sender_pn',
                        m.metadata -> 'message' ->> 'sender', ''), '\D', '', 'g'), 8) as fim_remetente
        from _alvo a
        join public.whatsapp_messages m on m.phone = a.group_jid
       where m.message_text ~ c_re or m.message_text ~ c_re_inss
    ),
    brutos as (
      -- CNJ, como sempre
      select group_jid, msg_id, created_at, fim_remetente,
             (regexp_matches(message_text, c_re, 'g'))[1] as bruto, 'cnj'::text as tipo
        from msgs where message_text ~ c_re
      union all
      -- número do INSS: 8–10 dígitos com fronteira de palavra, DEPOIS de tirar
      -- os CNJs do texto (senão os pedaços do CNJ viram "números").
      select group_jid, msg_id, created_at, fim_remetente,
             (regexp_matches(regexp_replace(message_text, c_re, ' ', 'g'), c_re_inss, 'g'))[1], 'inss'
        from msgs where regexp_replace(message_text, c_re, ' ', 'g') ~ c_re_inss
    ),
    validos as (
      select group_jid,
             case when tipo = 'cnj' then public.cnj_digitos(bruto) else bruto end as cnj,
             tipo, msg_id, created_at,
             case when fim_remetente is null or fim_remetente = '' then 'equipe'
                  when exists (select 1 from _equipe e where e.fim = brutos.fim_remetente) then 'equipe'
                  else 'cliente' end as origem
        from brutos
       where (tipo = 'cnj' and public.cnj_valido(bruto))
          -- A trava do INSS é a existência: só número que já é requerimento
          -- ou benefício de alguém, ou processo administrativo de alguém.
          or (tipo = 'inss' and (
                exists (select 1 from public.inss_admin_processes i
                         where i.deleted_at is null
                           and (regexp_replace(i.requerimento_number, '\D', '', 'g') = brutos.bruto
                                or regexp_replace(i.benefit_number, '\D', '', 'g') = brutos.bruto))
             or exists (select 1 from public.lead_processes p
                         where p.deleted_at is null and p.process_type = 'administrativo'
                           and regexp_replace(p.process_number, '\D', '', 'g') = brutos.bruto)))
    )
    select group_jid, cnj, min(tipo) as tipo,
           min(origem) as origem,
           count(*)::integer as ocorrencias,
           min(created_at) as primeira_em,
           max(created_at) as ultima_em,
           (array_agg(msg_id order by (origem = 'cliente') desc, created_at))[1] as primeira_msg_id
      from validos
     group by 1, 2;

  create temporary table _quantos_cnj on commit drop as
    select group_jid, count(*) filter (where origem = 'cliente') as cnjs_do_cliente
      from _achado group by 1;

  insert into public.grupo_processo_detectado as d
    (group_jid, cnj, tipo, status, origem, lead_id, ocorrencias, primeira_msg_id, primeira_em, ultima_em)
  select
    a.group_jid,
    a.cnj,
    a.tipo,
    case
      when exists (select 1 from _cnjs_do_lead c
                    where c.group_jid = a.group_jid and c.cnj = a.cnj) then 'ignorado'
      when a.origem = 'equipe'            then 'eco_da_casa'
      when l.leads is null or l.leads = 0 then 'sem_lead'
      when l.leads > 1                    then 'ambiguo_lead'
      when exists (select 1 from _cnjs_do_lead c
                    where c.group_jid = a.group_jid)                   then 'divergente'
      when q.cnjs_do_cliente > 1          then 'ambiguo_cnj'
      else 'sugerido'
    end,
    a.origem,
    case when coalesce(l.leads, 0) = 1 then l.lead_id else null end,
    a.ocorrencias, a.primeira_msg_id, a.primeira_em, a.ultima_em
  from _achado a
  join _quantos_cnj q on q.group_jid = a.group_jid
  left join _lead_do_grupo l on l.group_jid = a.group_jid
  on conflict (group_jid, cnj) do update
     set status = case when d.status in ('processo_do_grupo', 'nao_e_do_grupo') then d.status else excluded.status end,
         tipo = excluded.tipo,
         origem = excluded.origem,
         lead_id = case when d.status in ('processo_do_grupo', 'nao_e_do_grupo') then d.lead_id else excluded.lead_id end,
         ocorrencias = excluded.ocorrencias,
         primeira_msg_id = excluded.primeira_msg_id,
         primeira_em = least(d.primeira_em, excluded.primeira_em),
         ultima_em = greatest(d.ultima_em, excluded.ultima_em),
         atualizado_em = now();

  get diagnostics v_cnjs = row_count;

  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'ambiguidade_lead', l.group_jid, null,
         jsonb_build_object('leads', l.leads, 'motivo', 'grupo ligado a mais de um cliente')
    from _lead_do_grupo l
   where l.leads > 1
     and exists (select 1 from _achado a where a.group_jid = l.group_jid and a.origem = 'cliente')
  on conflict do nothing;

  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'ambiguidade_processo', d.group_jid, (array_agg(d.lead_id))[1],
         jsonb_build_object(
           'candidatos', jsonb_agg(jsonb_build_object(
             'cnj', d.cnj, 'ocorrencias', d.ocorrencias, 'msg_id', d.primeira_msg_id)),
           'motivo', 'o cliente citou mais de um processo e a ficha nao tem nenhum')
    from public.grupo_processo_detectado d
    join _alvo a on a.group_jid = d.group_jid
   where d.status = 'ambiguo_cnj'
   group by d.group_jid
  on conflict do nothing;

  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'divergencia_processo', d.group_jid, (array_agg(d.lead_id))[1],
         jsonb_build_object(
           'novos', jsonb_agg(jsonb_build_object(
             'cnj', d.cnj, 'ocorrencias', d.ocorrencias, 'msg_id', d.primeira_msg_id)),
           'ja_cadastrados', (select jsonb_agg(distinct c.cnj) from _cnjs_do_lead c
                               where c.group_jid = d.group_jid),
           'motivo', 'o cliente citou processo que nao esta na ficha dele')
    from public.grupo_processo_detectado d
    join _alvo a on a.group_jid = d.group_jid
   where d.status = 'divergente'
   group by d.group_jid
  on conflict do nothing;

  update public.dom_grupos_piloto g
     set processos_varridos_em = now()
    from _alvo a
   where g.group_jid = a.group_jid;

  return query select v_grupos, v_cnjs;
end $function$;

-- ── 3. O vinculador conhece o dono pelo INSS também ──────────────────────────
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
      select d.group_jid, d.cnj, d.tipo, g.group_name,
             (select array_agg(distinct x.lead_id) from (
                select p.lead_id from lead_processes p
                 where p.deleted_at is null and p.lead_id is not null
                   and cnj_digitos(p.process_number) = d.cnj
                union
                select i.lead_id from inss_admin_processes i
                  join leads l on l.id = i.lead_id and l.deleted_at is null
                 where i.deleted_at is null and d.tipo = 'inss'
                   and (regexp_replace(i.requerimento_number, '\D', '', 'g') = d.cnj
                        or regexp_replace(i.benefit_number, '\D', '', 'g') = d.cnj)
              ) x) as donos,
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
         and ((d.tipo = 'cnj' and cnj_valido(d.cnj)) or d.tipo = 'inss')
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

-- ── 4. As views sabem o tipo ─────────────────────────────────────────────────
create or replace view public.vw_grupo_processo_desalinhado as
with base as (
  select d.group_jid, d.cnj, d.tipo, d.ocorrencias, d.primeira_msg_id, d.primeira_em, d.ultima_em,
         g.group_name, g.area,
         exists (select 1 from lead_whatsapp_groups lg where jid_chave(lg.group_jid) = jid_chave(d.group_jid)) as grupo_tem_cliente,
         (exists (select 1 from lead_processes p where p.deleted_at is null and cnj_digitos(p.process_number) = d.cnj)
          or exists (select 1 from inss_admin_processes i where i.deleted_at is null
                      and (regexp_replace(i.requerimento_number, '\D', '', 'g') = d.cnj
                           or regexp_replace(i.benefit_number, '\D', '', 'g') = d.cnj))) as processo_existe
    from grupo_processo_detectado d
    join dom_grupos_piloto g on g.group_jid = d.group_jid
   where d.status = 'eco_da_casa'
),
donos as (
  -- quem tem o número: lead_processes (qualquer tipo) ∪ inss_admin_processes
  select b.group_jid, b.cnj, x.lead_id
    from base b
    join lateral (
      select p.lead_id from lead_processes p where p.deleted_at is null and p.lead_id is not null and cnj_digitos(p.process_number) = b.cnj
      union
      select i.lead_id from inss_admin_processes i where i.deleted_at is null and i.lead_id is not null
         and (regexp_replace(i.requerimento_number, '\D', '', 'g') = b.cnj or regexp_replace(i.benefit_number, '\D', '', 'g') = b.cnj)
    ) x on true
),
chaves as (
  select b.*, kg.numero as numero_do_grupo,
         (select array_agg(distinct kd.numero)
            from donos dn join leads l on l.id = dn.lead_id,
                 lateral busca_chave_caso(coalesce(l.case_number, l.lead_name, l.victim_name), false) kd
           where dn.group_jid = b.group_jid and dn.cnj = b.cnj) as numeros_do_dono,
         (select string_agg(distinct coalesce(l.lead_name, l.victim_name), ' | ')
            from donos dn join leads l on l.id = dn.lead_id
           where dn.group_jid = b.group_jid and dn.cnj = b.cnj) as dono_do_processo,
         (select array_agg(distinct dn.lead_id) from donos dn where dn.group_jid = b.group_jid and dn.cnj = b.cnj) as leads_donos
    from base b
    left join lateral busca_chave_caso(b.group_name, false) kg on true
)
select group_jid, group_name, area,
       case when tipo = 'inss' then cnj else cnj_formatado(cnj) end as processo,
       cnj, dono_do_processo, leads_donos, ocorrencias, primeira_msg_id, primeira_em, ultima_em,
       case
         when not processo_existe then 'processo_orfao'
         when not grupo_tem_cliente then 'grupo_sem_cliente'
         when numero_do_grupo is null or numeros_do_dono is null then 'a_conferir'
         when numero_do_grupo = any (numeros_do_dono) then 'ficha_paralela'
         else 'caso_diferente'
       end as classe,
       case
         when not processo_existe then 'achar de onde o robo tirou esse numero (inss_admin_processes?) e cadastrar, ou marcar como erro'
         when not grupo_tem_cliente then 'ligar o grupo ao dono do processo em lead_whatsapp_groups, apos conferir o nome'
         when numero_do_grupo is null or numeros_do_dono is null then 'conferir na mao: nome sem codigo de caso dos dois lados'
         when numero_do_grupo = any (numeros_do_dono) then 'mesma pessoa em duas fichas: fundir os leads ou apontar o grupo para a ficha do processo'
         else 'conferir: o numero de caso do grupo nao bate com o do dono do processo'
       end as o_que_fazer,
       tipo
  from chaves c;

create or replace view public.vw_grupo_processo_conciliacao as
with grupo as (
  select distinct on (jid_chave(g.group_jid))
         g.group_jid, jid_chave(g.group_jid) as chave, g.contact_name as group_name,
         nullif(regexp_replace((regexp_match(g.contact_name, '(?i)caso\s*n?º?\s*([0-9]{1,4})'))[1], '\D', '', 'g'), '') as caso_no_nome
    from whatsapp_groups_index g
   where g.contact_name ~* 'caso'
   order by jid_chave(g.group_jid), g.last_seen desc nulls last, g.updated_at desc nulls last
),
vinculo as (
  select distinct on (jid_chave(group_jid)) jid_chave(group_jid) as chave, lead_id
    from lead_whatsapp_groups
   where lead_id is not null
   order by jid_chave(group_jid), created_at desc
),
do_lead as (
  select chave, string_agg(distinct numero, ', ') as cnj_do_lead
    from (
      select v.chave, lp.process_number as numero
        from vinculo v
        join lead_processes lp on lp.lead_id = v.lead_id and lp.deleted_at is null
       where coalesce(lp.process_number, '') <> ''
      union
      select d.group_jid, case when d.tipo = 'inss' then d.cnj else cnj_formatado(d.cnj) end
        from grupo_processo_detectado d
       where d.status = 'processo_do_grupo'
    ) x
   group by chave
),
sugerido as (
  select g.chave,
         string_agg(distinct jp.processo_cnj, ', ') as cnj_sugerido,
         count(distinct jp.processo_cnj) as qtd_sugerida,
         string_agg(distinct (jp.processo_cnj || ' · ' || coalesce(jp.empresa, 'sem empresa'))
                             || coalesce(' (' || nullif(jp.cidade_proc, '') || '/' || nullif(jp.uf_proc, '') || ')', ''),
                    E'\n') as sugestao_detalhe
    from grupo g
    join jm_processos jp on nullif(regexp_replace(jp.caso, '\D', '', 'g'), '') = g.caso_no_nome
   where not exists (select 1 from lead_processes lp
                      where regexp_replace(coalesce(lp.process_number, ''), '\D', '', 'g')
                            = regexp_replace(jp.processo_cnj, '\D', '', 'g')
                        and lp.deleted_at is null)
   group by g.chave
)
select g.group_jid, g.group_name, g.caso_no_nome, v.lead_id,
       dl.cnj_do_lead, s.cnj_sugerido, s.sugestao_detalhe,
       coalesce(s.qtd_sugerida, 0::bigint) as qtd_sugerida,
       (dl.cnj_do_lead is null and s.cnj_sugerido is not null) as so_na_jurimetria
  from grupo g
  left join vinculo  v  on v.chave  = g.chave
  left join do_lead  dl on dl.chave = g.chave
  left join sugerido s  on s.chave  = g.chave
 where dl.cnj_do_lead is not null or s.cnj_sugerido is not null;

-- ── 5. A decisão de 1 clique sabe o tipo ─────────────────────────────────────
create or replace function public.resolver_processo_citado(
  p_group_jid text, p_cnj text, p_decisao text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_jid   text := jid_chave(p_group_jid);
  v_cnj   text := cnj_digitos(p_cnj);
  v_row   grupo_processo_detectado%rowtype;
  v_nome  text;
  v_lead  uuid;
  v_donos uuid[];
  v_orfaos integer;
  v_existe boolean;
  v_acao  text;
  v_n     integer;
begin
  if p_decisao not in ('e_do_grupo', 'nao_e_do_grupo') then
    raise exception 'decisão inválida: %', p_decisao;
  end if;

  select * into v_row from grupo_processo_detectado where group_jid = v_jid and cnj = v_cnj;
  if not found then
    raise exception 'citação não encontrada para este grupo e processo';
  end if;

  if p_decisao = 'nao_e_do_grupo' then
    update grupo_processo_detectado
       set status = 'nao_e_do_grupo', atualizado_em = now()
     where group_jid = v_jid and cnj = v_cnj;
    return jsonb_build_object('ok', true, 'acao', 'nao_e_do_grupo');
  end if;

  select g.group_name into v_nome from dom_grupos_piloto g where g.group_jid = v_jid;

  select lg.lead_id into v_lead
    from lead_whatsapp_groups lg
   where jid_chave(lg.group_jid) = v_jid and lg.lead_id is not null
   order by lg.created_at desc limit 1;
  if v_lead is null then
    select case when count(*) = 1 then (array_agg(l.id))[1] end into v_lead
      from leads l
     where l.deleted_at is null and l.whatsapp_group_id is not null
       and jid_chave(l.whatsapp_group_id) = v_jid;
  end if;

  -- donos: lead_processes ∪ (se inss) inss_admin_processes. O filter importa:
  -- sem ele o NULL das linhas órfãs contaria como dono.
  select array_agg(distinct x.lead_id) filter (where x.lead_id is not null),
         count(*) filter (where x.lead_id is null)
    into v_donos, v_orfaos
    from (
      select p.lead_id from lead_processes p
       where p.deleted_at is null and cnj_digitos(p.process_number) = v_cnj
      union all
      select i.lead_id from inss_admin_processes i
       where i.deleted_at is null and v_row.tipo = 'inss'
         and (regexp_replace(i.requerimento_number, '\D', '', 'g') = v_cnj
              or regexp_replace(i.benefit_number, '\D', '', 'g') = v_cnj)
    ) x;
  v_existe := (cardinality(coalesce(v_donos, '{}')) > 0) or (v_orfaos > 0);

  if not v_existe then
    if v_lead is null then
      raise exception 'O processo não está cadastrado e o grupo não tem lead. Ligue o grupo a um lead primeiro (botão Vincular).';
    end if;
    insert into lead_processes (lead_id, process_number, process_type, status, title)
    select v_lead,
           case when v_row.tipo = 'inss' then v_cnj else cnj_formatado(v_cnj) end,
           case when v_row.tipo = 'inss' then 'administrativo' else 'judicial' end,
           'em_andamento',
           coalesce(nullif(btrim(jp.natureza || ' — ' || coalesce(jp.empresa, '')), '— '),
                    case when v_row.tipo = 'inss' then 'Requerimento INSS citado no grupo ' else 'Citado no grupo ' end || coalesce(v_nome, v_jid))
      from (select 1) x
      left join jm_processos jp on v_row.tipo = 'cnj' and cnj_digitos(jp.processo_cnj) = v_cnj
     limit 1;
    v_acao := 'cadastrado_no_lead_do_grupo';

  elsif cardinality(coalesce(v_donos, '{}')) = 0 then
    if v_lead is null then
      raise exception 'O processo está sem lead e o grupo também. Ligue o grupo a um lead primeiro (botão Vincular).';
    end if;
    update lead_processes set lead_id = v_lead
     where deleted_at is null and lead_id is null and cnj_digitos(process_number) = v_cnj;
    v_acao := 'adotado_pelo_lead_do_grupo';

  elsif v_lead is null then
    if cardinality(v_donos) <> 1 then
      raise exception 'O grupo não tem lead e o processo está em % leads. Escolha o lead do grupo primeiro (botão Vincular).', cardinality(v_donos);
    end if;
    v_lead := v_donos[1];
    insert into lead_whatsapp_groups (lead_id, group_jid, group_name, auto_linked)
    values (v_lead, v_jid || '@g.us', v_nome, false)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into lead_group_audit_log (action, group_jid, group_name, lead_id, lead_name, result, source)
      select 'link', v_jid || '@g.us', v_nome, l.id, l.lead_name, 'success', 'fila_processos_citados'
        from leads l where l.id = v_lead;
    end if;
    v_acao := 'grupo_ligado_ao_lead_do_processo';

  else
    v_acao := 'processo_do_grupo';
  end if;

  update grupo_processo_detectado
     set status = 'processo_do_grupo',
         lead_id = case when cardinality(coalesce(v_donos, '{}')) = 1 then v_donos[1] else v_lead end,
         atualizado_em = now()
   where group_jid = v_jid and cnj = v_cnj;

  return jsonb_build_object('ok', true, 'acao', v_acao, 'lead_id', v_lead);
end $fn$;

-- ── 6. O Dom lê o requerimento citado ────────────────────────────────────────
do $mig$
declare def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';
  v_old := '      from inss_admin_processes i
      join gs on gs.lead_id = i.lead_id
      where i.deleted_at is null';
  v_new := '      from (
        -- do lead do grupo ∪ citados pela equipe no grupo (tipo inss). O mesmo
        -- requerimento pode estar em dois leads: uma linha só, a do lead do grupo.
        select distinct on (regexp_replace(i0.requerimento_number, ''\D'', '''', ''g'')) i0.*
          from inss_admin_processes i0
          left join gs on gs.lead_id = i0.lead_id
         where i0.deleted_at is null
           and (gs.lead_id is not null
                or regexp_replace(i0.requerimento_number, ''\D'', '''', ''g'') in (select c.cnj from citados c)
                or regexp_replace(i0.benefit_number, ''\D'', '''', ''g'') in (select c.cnj from citados c))
         order by regexp_replace(i0.requerimento_number, ''\D'', '''', ''g''), (gs.lead_id is null)
      ) i
      where true';
  if position(v_old in def) = 0 then
    raise exception 'RPC: âncora de requerimentos_inss não encontrada — NADA alterado';
  end if;
  execute replace(def, v_old, v_new);
end $mig$;

-- ── 7. O cron re-varre também quem citou número do INSS ──────────────────────
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
       and (m.message_text ~ '\d{7}[-.]?\d{2}[.]?\d{4}[.]?\d[.]?\d{2}[.]?\d{4}'
            or m.message_text ~ '\m\d{8,10}\M')
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

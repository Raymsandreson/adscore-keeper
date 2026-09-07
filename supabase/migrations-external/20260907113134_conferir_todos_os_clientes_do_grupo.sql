-- =============================================================================
-- "O cliente já tem esse processo?" passa a olhar TODOS os clientes do grupo.
--
-- O ERRO
-- A 20260907112738 montava a lista de processos já cadastrados a partir de
-- `(array_agg(distinct lg.lead_id))[1]` — o PRIMEIRO cliente do grupo, escolhido
-- por ordem arbitrária do agregador. Para os 568 grupos com um cliente só, dá no
-- mesmo. Para os 276 com dois ou mais, olhava um e ignorava os outros.
--
-- MEDIDO: dos 228 números classificados 'eco_da_casa' que já existem na base,
-- 14 pertencem a OUTRO cliente do mesmo grupo. Deviam ser 'ignorado' (o caso já
-- está cadastrado, só que na ficha do irmão, do pai, do espólio) e apareceriam
-- na tela como pendência inexistente.
--
-- Os outros 214 pertencem a cliente de FORA do grupo — esses continuam sendo
-- achado de verdade, e dos grandes: ou o processo está na ficha errada, ou o
-- vínculo grupo↔cliente está errado. Não é o que o item 6 foi pedir, mas é
-- material que só apareceu porque a varredura existe.
--
-- A METÁFORA
-- Perguntar "esse documento é seu?" só para o primeiro da fila, num balcão onde
-- a família inteira está junta. A resposta "não" não quer dizer que não seja
-- de ninguém ali.
-- =============================================================================

create or replace function public.detectar_processos_em_grupos(
  p_limite integer default 50,
  p_group_jid text default null
)
returns TABLE (grupos_varridos integer, cnjs_registrados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c_re constant text := '\d{7}[-.]?\d{2}[.]?\d{4}[.]?\d[.]?\d{2}[.]?\d{4}';
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
     where g.ativo
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

  -- TODOS os clientes do grupo, não só o primeiro. Ver cabeçalho.
  create temporary table _cnjs_do_lead on commit drop as
    select distinct a.group_jid, public.cnj_digitos(p.process_number) as cnj
      from _alvo a
      join public.lead_whatsapp_groups lg
        on public.jid_chave(lg.group_jid) = public.jid_chave(a.group_jid)
      join public.lead_processes p
        on p.lead_id = lg.lead_id and p.deleted_at is null
     where length(public.cnj_digitos(p.process_number)) = 20;

  create temporary table _achado on commit drop as
    with brutos as (
      select a.group_jid, m.id as msg_id, m.created_at,
             right(regexp_replace(
               coalesce(m.metadata -> 'message' ->> 'sender_pn',
                        m.metadata -> 'message' ->> 'sender', ''), '\D', '', 'g'), 8) as fim_remetente,
             (regexp_matches(m.message_text, c_re, 'g'))[1] as bruto
        from _alvo a
        join public.whatsapp_messages m on m.phone = a.group_jid
       where m.message_text ~ c_re
    ),
    validos as (
      select group_jid, public.cnj_digitos(bruto) as cnj, msg_id, created_at,
             case when fim_remetente is null or fim_remetente = '' then 'equipe'
                  when exists (select 1 from _equipe e where e.fim = brutos.fim_remetente) then 'equipe'
                  else 'cliente' end as origem
        from brutos
       where public.cnj_valido(bruto)
    )
    select group_jid, cnj,
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
    (group_jid, cnj, status, origem, lead_id, ocorrencias, primeira_msg_id, primeira_em, ultima_em)
  select
    a.group_jid,
    a.cnj,
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
     set status = excluded.status,
         origem = excluded.origem,
         lead_id = excluded.lead_id,
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
end $$;

delete from public.pendencias_vinculo where resolvido_por is null and resolvido_em is null;
truncate table public.grupo_processo_detectado;
update public.dom_grupos_piloto set processos_varridos_em = null;

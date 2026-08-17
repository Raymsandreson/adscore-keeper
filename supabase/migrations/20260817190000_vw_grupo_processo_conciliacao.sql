-- =============================================================================
-- vw_grupo_processo_conciliacao — acha o processo de cada grupo do WhatsApp.
--
-- Por que existe (17/08/2026): 485 processos da jurimetria não têm lead nem caso
-- cadastrado. A ponte que sobrou é o nome do grupo onde os clientes são
-- informados: ele carrega o nº do caso ("Caso 88 - ..."), e o mesmo nº está em
-- `jm_processos.caso`. A tela Contatos > Grupos (modo auditoria) já concilia
-- grupo↔lead; esta view dá a ela a coluna de processo.
--
-- REGRA DE CASAMENTO (decisão do Raym): casa SÓ PELO INTEIRO. "Caso 10.1
-- Marlene" e "Caso 11.1 Orileia" usam o sufixo para OUTRA parte/processo do
-- mesmo caso — casar com o sufixo juntaria pessoas diferentes.
--
-- GRÃO: uma linha por grupo. `whatsapp_groups_index` guarda uma linha por
-- (group_jid, instance_name); sem o DISTINCT ON o mesmo grupo saía até 11 vezes
-- (1.040 linhas para 224 grupos) e a coluna duplicaria o grid da tela.
--
-- `cnj_do_lead`    → o grupo já tem lead com processo em `lead_processes`.
-- `cnj_sugerido`   → a jurimetria tem processo com esse nº de caso e NINGUÉM
--                    cadastrou ficha. É sugestão, não vínculo — nada aqui
--                    escreve em `lead_processes`.
-- `qtd_sugerida>1` → ambíguo (2 casos hoje): o nº aponta para mais de um CNJ.
--                    Não pode virar vínculo automático.
--
-- Medido em 17/08/2026: 224 grupos · 93 com CNJ do lead · 131 só na jurimetria
-- · 2 ambíguos.
-- =============================================================================
drop view if exists public.vw_grupo_processo_conciliacao;

create view public.vw_grupo_processo_conciliacao as
with grupo as (
  select distinct on (g.group_jid)
    g.group_jid,
    g.contact_name as group_name,
    nullif(regexp_replace((regexp_match(g.contact_name, '(?i)caso\s*n?º?\s*([0-9]{1,4})'))[1], '\D', '', 'g'), '') as caso_no_nome
  from whatsapp_groups_index g
  where g.contact_name ~* 'caso'
  order by g.group_jid, g.last_seen desc nulls last, g.updated_at desc nulls last
),
vinculo as (
  select distinct on (group_jid) group_jid, lead_id
  from lead_whatsapp_groups
  order by group_jid, created_at desc
),
do_lead as (
  select v.group_jid, string_agg(distinct lp.process_number, ', ') as cnj_do_lead
  from vinculo v
  join lead_processes lp on lp.lead_id = v.lead_id and lp.deleted_at is null
  where coalesce(lp.process_number, '') <> ''
  group by v.group_jid
),
sugerido as (
  select
    g.group_jid,
    string_agg(distinct jp.processo_cnj, ', ') as cnj_sugerido,
    count(distinct jp.processo_cnj) as qtd_sugerida,
    string_agg(
      distinct jp.processo_cnj || ' · ' || coalesce(jp.empresa, 'sem empresa')
        || coalesce(' (' || nullif(jp.cidade_proc, '') || '/' || nullif(jp.uf_proc, '') || ')', ''),
      E'\n'
    ) as sugestao_detalhe
  from grupo g
  join jm_processos jp
    on nullif(regexp_replace(jp.caso, '\D', '', 'g'), '') = g.caso_no_nome
  -- só sugere processo que ainda NÃO tem ficha em lead_processes: o que já tem
  -- ficha não é conciliação pendente, é cadastro feito.
  where not exists (
    select 1 from lead_processes lp
    where regexp_replace(coalesce(lp.process_number, ''), '\D', '', 'g')
        = regexp_replace(jp.processo_cnj, '\D', '', 'g')
      and lp.deleted_at is null
  )
  group by g.group_jid
)
select
  g.group_jid,
  g.group_name,
  g.caso_no_nome,
  v.lead_id,
  dl.cnj_do_lead,
  s.cnj_sugerido,
  s.sugestao_detalhe,
  coalesce(s.qtd_sugerida, 0) as qtd_sugerida,
  (dl.cnj_do_lead is null and s.cnj_sugerido is not null) as so_na_jurimetria
from grupo g
left join vinculo v on v.group_jid = g.group_jid
left join do_lead dl on dl.group_jid = g.group_jid
left join sugerido s on s.group_jid = g.group_jid
where dl.cnj_do_lead is not null or s.cnj_sugerido is not null;

grant select on public.vw_grupo_processo_conciliacao to anon, authenticated, service_role;

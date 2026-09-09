-- =============================================================================
-- A coluna "Processo" da lista de grupos passa a valer para TODOS os grupos.
--
-- O QUE O RAYM VIU (09/09/2026): grupos PREV e LEAD com lead e processo
-- cadastrado mostravam "—" na coluna Processo. Causa: a
-- vw_grupo_processo_conciliacao nasceu (07/09) como auditoria dos grupos
-- "Caso N" e filtrava `contact_name ~* 'caso'`. Só 508 dos 6.671 grupos
-- passavam. O resto não tinha linha na view, e a tela lia "—".
--
-- O QUE MUDA
--   * O filtro de nome sai. Todo grupo do índice entra; `caso_no_nome` fica
--     nulo quando o nome não tem "Caso N", e aí a sugestão da jurimetria
--     simplesmente não se aplica (a lógica já tratava nulo).
--   * O resto é igual: processos do lead do grupo ∪ processos que a equipe
--     citou no grupo e o vinculador confirmou (processo_do_grupo, CNJ ou INSS).
--
-- CUSTO. A view é carregada uma vez ao abrir a aba Grupos. 6.671 grupos em
-- vez de 508: `do_lead` anda pela ponte (2.551 linhas) e pelo detector; a
-- junção com a jurimetria só acontece para quem tem `caso_no_nome`.
--
-- STATUS: NÃO APLICADO. Testado em transação com rollback em 09/09/2026: 750 linhas
-- (395 PREV, 298 CASO/FAMÍLIA, 57 outros), 281 ms. Aguarda aval do Raym.
--
-- ROLLBACK: recriar a view com `where g.contact_name ~* 'caso'` na CTE grupo
-- (versão em 20260909030000, seção 4).
-- =============================================================================
create or replace view public.vw_grupo_processo_conciliacao as
with grupo as (
  select distinct on (jid_chave(g.group_jid))
         g.group_jid, jid_chave(g.group_jid) as chave, g.contact_name as group_name,
         nullif(regexp_replace((regexp_match(g.contact_name, '(?i)caso\s*n?º?\s*([0-9]{1,4})'))[1], '\D', '', 'g'), '') as caso_no_nome
    from whatsapp_groups_index g
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
    join jm_processos jp on g.caso_no_nome is not null
                        and nullif(regexp_replace(jp.caso, '\D', '', 'g'), '') = g.caso_no_nome
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

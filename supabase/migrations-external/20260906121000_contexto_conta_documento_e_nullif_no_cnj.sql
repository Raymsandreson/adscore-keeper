-- =============================================================================
-- O contexto passa a contar documento como movimentação — e para de casar
-- ficha sem número com linha órfã.
--
-- PARTE 1 — a mesma definição nos dois lugares
-- O gatilho `lead_processes_avanca_ultima_movimentacao` (migration irmã
-- 20260906120000) passou a aceitar `jm_documentos`. Se só ele soubesse disso,
-- o RPC calcularia uma data e a coluna outra: duas verdades sobre o mesmo
-- fato, que é a doença que esta sessão inteira tratou. Então `mov` aqui usa
-- exatamente a mesma lista de origens — process_updates, jm_decisoes,
-- jm_documentos.
--
-- PARTE 2 — o vazamento entre clientes
-- `dom_so_digitos` devolve STRING VAZIA para qualquer texto sem número:
--     select dom_so_digitos('Não protocolado')  →  ''
--
-- E há fichas com `process_number` preenchido à mão com anotação em vez de
-- número. Medido em 06/09/2026, três delas:
--     "."
--     "Não protocolado"
--     "reprotocolar-cliente nao foi p perícia"
--
-- Do outro lado, `process_updates` tem 12 linhas com `numero_cnj` NULO — que
-- também viram '' pela mesma função. O join `'' = ''` casava as duas pontas:
-- essas fichas puxavam as 12 movimentações órfãs e ganhavam a data
-- 17/06/2026. O assessor contaria a um cliente a movimentação de um processo
-- que não é dele.
--
--   antes:  ultima_movimentacao = 2026-06-17, 12 andamentos
--   depois: nulo, 0 andamentos, 0 documentos
--
-- O conserto é `nullif(dom_so_digitos(...), '')`. NULL não casa com NULL num
-- join — que é a resposta certa para "não sei de qual processo isto é". O
-- guard vale em TODAS as junções por CNJ: andamentos, documentos, decisões e
-- audiências.
--
-- Os dois backfills desta sessão NÃO foram contaminados: o de 05/09 filtrava
-- `numero_cnj is not null` e o de 06/09 vem de `jm_documentos`, que não tem
-- linha sem dígito. Conferido nas tabelas de backup: zero em cada.
--
-- ROLLBACK: reaplicar 20260905203000_dom_ultima_movimentacao_real.sql.
-- =============================================================================

create or replace function public.dom_contexto_processual(p_group_jid text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with g as (
    select lg.lead_id, lg.group_name
    from lead_whatsapp_groups lg
    where dom_jid_curto(lg.group_jid) = dom_jid_curto(p_group_jid)
      and lg.lead_id is not null
    order by lg.created_at desc
    limit 1
  ),
  proc as (
    select p.id, p.process_number,
           -- NULLIF e a trava do vazamento. dom_so_digitos devolve STRING VAZIA
           -- para qualquer texto sem numero — e ha fichas com process_number
           -- ".", "Nao protocolado", "reprotocolar-cliente nao foi p pericia".
           -- Sem o nullif, '' = '' casava essas fichas com as 12 linhas de
           -- process_updates que tem numero_cnj nulo: o assessor contaria a um
           -- cliente a movimentacao de outro processo. Com NULL, nada casa,
           -- que e a resposta certa para "nao sei de qual processo e".
           nullif(dom_so_digitos(p.process_number), '') as cnj_digitos,
           p.title, p.status, p.situacao,
           p.tribunal, p.tribunal_sigla, p.grau, p.classe,
           p.assunto_principal, p.orgao_julgador,
           p.data_distribuicao, p.data_ultima_movimentacao,
           p.arquivado, p.segredo_justica,
           p.resultado_atingido, p.resultado_atingido_tipo, p.resultado_atingido_data
    from lead_processes p
    join g on g.lead_id = p.lead_id
    where p.process_number is not null
      and p.deleted_at is null
  ),
  -- A data real do ultimo movimento. TRES origens, a mesma lista que o gatilho
  -- lead_processes_avanca_ultima_movimentacao usa — se as duas discordassem,
  -- voltariamos a ter duas verdades sobre o mesmo fato.
  mov as (
    select pr.id,
           nullif(btrim(pr.data_ultima_movimentacao), '')::date as cadastro_em,
           greatest(
             (select max(u.data_movimentacao)
                from process_updates u
               where (pr.cnj_digitos is not null
                      and dom_so_digitos(u.numero_cnj) = pr.cnj_digitos)
                  or u.process_id = pr.id),
             (select max(d.data_decisao)
                from jm_decisoes d
               where pr.cnj_digitos is not null
                 and dom_so_digitos(d.processo_cnj) = pr.cnj_digitos),
             (select max(dc.data_documento)
                from jm_documentos dc
               where pr.cnj_digitos is not null
                 and dom_so_digitos(dc.processo_cnj) = pr.cnj_digitos
                 and dc.oculta_em is null
                 and dc.data_documento <= current_date)
           ) as feed_em
    from proc pr
  )
  select jsonb_build_object(
    'tem_vinculo', exists (select 1 from g),
    'grupo',       (select group_name from g),
    'lead_id',     (select lead_id from g),

    'processo_mais_recente', (
      select pr.process_number
      from proc pr
      join mov mv on mv.id = pr.id
      where mv.feed_em is not null
      order by mv.feed_em desc
      limit 1
    ),

    'ultima_atividade', (
      select jsonb_build_object(
               'titulo',        dom_texto_limpo(a.title),
               'assunto',       coalesce(a.process_title, a.case_title),
               'status',        a.status,
               'como_esta',     left(dom_texto_limpo(a.current_status_notes), 700),
               'proximo_passo', left(dom_texto_limpo(a.next_steps), 500),
               'quando',        a.created_at
             )
      from lead_activities a
      join g on g.lead_id = a.lead_id
      order by a.created_at desc
      limit 1
    ),

    'requerimentos_inss', coalesce((
      select jsonb_agg(jsonb_build_object(
               'numero',             i.requerimento_number,
               'beneficio',          btrim(split_part(coalesce(i.benefit_type, ''), 'Data do Protocolo', 1)),
               'servico',            i.servico,
               'status',             i.current_status,
               'protocolado_em',     i.protocol_date,
               'resultado',          i.resultado,
               'despacho',           left(dom_texto_limpo(i.despacho), 600),
               'em_exigencia_desde', i.exigencia_since,
               'numero_beneficio',   i.benefit_number
             ) order by i.protocol_date desc nulls last)
      from inss_admin_processes i
      join g on g.lead_id = i.lead_id
      where i.deleted_at is null
    ), '[]'::jsonb),

    'processos', coalesce((
      select jsonb_agg(x order by ord desc nulls last)
      from (
        select
          coalesce(mv.feed_em, mv.cadastro_em) as ord,
          jsonb_build_object(
            'numero',              pr.process_number,
            'esfera',              dom_esfera_cnj(pr.process_number),
            'titulo',              pr.title,
            'status',              coalesce(pr.situacao, pr.status),
            'tribunal',            coalesce(pr.tribunal_sigla, pr.tribunal),
            'grau',                pr.grau,
            'classe',              pr.classe,
            'assunto',             pr.assunto_principal,
            'orgao',               pr.orgao_julgador,
            'distribuido_em',      pr.data_distribuicao,

            'ultima_movimentacao',          coalesce(mv.feed_em, mv.cadastro_em),
            'ultima_movimentacao_cadastro', mv.cadastro_em,
            'cadastro_desatualizado',       (mv.feed_em is not null
                                             and (mv.cadastro_em is null
                                                  or mv.feed_em > mv.cadastro_em)),

            'arquivado',           pr.arquivado,
            'segredo_justica',     pr.segredo_justica,
            'resultado',           case
                                     when pr.resultado_atingido is not null
                                     then jsonb_build_object(
                                            'situacao', pr.resultado_atingido,
                                            'tipo',     pr.resultado_atingido_tipo,
                                            'data',     pr.resultado_atingido_data)
                                   end,

            'fase_atual', (
              select jsonb_build_object(
                       'fase',  m.rotulo,
                       'desde', m.data_detectada,
                       'fonte', m.fonte)
              from process_pop_marcos m
              where m.process_id = pr.id and m.data_detectada is not null
              order by m.data_detectada desc, m.ordem desc
              limit 1
            ),

            'marcos', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'fase',  mm.rotulo,
                       'desde', mm.data_detectada) order by mm.data_detectada desc)
              from (
                select m2.rotulo, m2.data_detectada
                from process_pop_marcos m2
                where m2.process_id = pr.id and m2.data_detectada is not null
                order by m2.data_detectada desc, m2.ordem desc
                limit 5
              ) mm
            ), '[]'::jsonb),

            'documentos', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'peca',   dd.titulo,
                       'data',   dd.data_documento,
                       'resumo', left(dom_texto_limpo(dd.resumo), 500)) order by dd.data_documento desc)
              from (
                select d2.titulo, d2.data_documento, l2.resumo
                from jm_documentos d2
                join jm_documento_leitura l2 on l2.documento_id = d2.id
                where pr.cnj_digitos is not null
                  and dom_so_digitos(d2.processo_cnj) = pr.cnj_digitos
                  and d2.oculta_em is null
                  and coalesce(l2.resumo, '') <> ''
                order by d2.data_documento desc nulls last
                limit 6
              ) dd
            ), '[]'::jsonb),

            'andamentos', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'data',      u.data_movimentacao,
                       'categoria', u.categoria,
                       'titulo',    u.titulo,
                       'resumo',    dom_texto_limpo(coalesce(u.resumo_ia, left(u.descricao, 400)))
                     ) order by u.data_movimentacao desc)
              from (
                select u2.*
                from process_updates u2
                where (pr.cnj_digitos is not null
                       and dom_so_digitos(u2.numero_cnj) = pr.cnj_digitos)
                   or u2.process_id = pr.id
                order by u2.data_movimentacao desc
                limit 8
              ) u
            ), '[]'::jsonb),

            'decisoes', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'data',      d.data_decisao,
                       'tipo',      d.tipo_evento,
                       'instancia', d.instancia,
                       'titulo',    d.titulo,
                       'orgao',     d.orgao
                     ) order by d.data_decisao desc)
              from (
                select d2.*
                from jm_decisoes d2
                where pr.cnj_digitos is not null
                  and dom_so_digitos(d2.processo_cnj) = pr.cnj_digitos
                order by d2.data_decisao desc
                limit 5
              ) d
            ), '[]'::jsonb),

            'audiencias', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'data',   h.hearing_date,
                       'hora',   h.hearing_time,
                       'tipo',   h.hearing_type,
                       'status', h.status,
                       'local',  h.location
                     ) order by h.hearing_date)
              from hearings h
              where ((pr.cnj_digitos is not null
                      and dom_so_digitos(h.process_number) = pr.cnj_digitos)
                     or h.process_id = pr.id)
                and h.deleted_at is null
                and h.hearing_date >= current_date - 30
            ), '[]'::jsonb)
          ) as x
        from proc pr
        join mov mv on mv.id = pr.id
      ) s
    ), '[]'::jsonb)
  )
$function$;

comment on function public.dom_contexto_processual(text) is
  'Contexto do assessor virtual. ultima_movimentacao vem do feed (process_updates, jm_decisoes E jm_documentos), a mesma lista de origens do gatilho lead_processes_avanca_ultima_movimentacao. cnj_digitos usa NULLIF: ficha com process_number sem numero nao casa com nada, em vez de casar com toda linha orfa.';

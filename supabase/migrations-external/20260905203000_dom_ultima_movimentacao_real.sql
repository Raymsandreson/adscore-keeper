-- =============================================================================
-- A "última movimentação" passa a vir do FEED, não do cadastro.
--
-- O DEFEITO QUE ISTO CONSERTA
-- O assessor escreveu, sobre um cliente com sete processos:
--   "O que teve movimentação mais recente foi o da ação de indenização,
--    que continua sem novidades."
-- As duas metades se contradizem. Não foi invenção do modelo: foi ele
-- juntando, com honestidade, duas fontes que discordavam.
--
-- MEDIDO EM 05/09/2026, nos 644 processos dos grupos do piloto:
--   333  `lead_processes.data_ultima_movimentacao` NULA, com andamento gravado
--   140  coluna ATRASADA em relação ao andamento real (pior: 1363 dias)
--    30  coluna correta
--   141  sem andamento nenhum (aí a coluna vazia está certa)
-- Ou seja: 473 dos 503 processos que têm movimento — 94% — carregavam data
-- errada ou vazia. Na base inteira são 2091 de 2686 sem data nenhuma.
--
-- E o estrago era maior que um campo errado: o `order by ord desc nulls last`
-- da lista de processos usava ESSA coluna. Com ela nula em 333 processos, a
-- lista chegava ao modelo praticamente sem ordem — e ele tinha que adivinhar
-- qual "mexeu por último". A regra dos três degraus manda dizer justamente
-- isso ("conte o que aconteceu de mais recente em UM deles"). Estávamos
-- pedindo uma resposta que o contexto não permitia dar.
--
-- POR QUE O FEED É CONFIÁVEL E A COLUNA NÃO
--   process_updates:  5741 linhas, tipo date, ZERO datas no futuro
--   jm_decisoes:            "        "        ZERO datas no futuro
--   lead_processes.data_ultima_movimentacao: text, 16 datas NO FUTURO
-- A coluna é campo de cadastro, preenchido por sincronização que falha calada.
-- O feed é o registro do que aconteceu. Passa a mandar quem viu acontecer.
--
-- DETECTOR, NÃO FILTRO (CLAUDE.md, processo e rigor #8)
-- A coluna errada NÃO é escondida. Ela continua saindo em
-- `ultima_movimentacao_cadastro`, e `cadastro_desatualizado` marca a linha
-- quando as duas discordam. Assim os 473 processos viram fila de conserto da
-- sincronização em vez de sumirem de vista. Corrigir a tela e deixar o dado
-- torto no banco seria trocar um número errado por outro.
--
-- O QUE MAIS MUDA
--   · `processo_mais_recente` no topo do JSON: o número do processo que mexeu
--     por último. O modelo para de adivinhar — a resposta vem pronta.
--   · a lista de processos passa a ser ordenada pela data real.
--
-- NÃO MEXE em lead_processes. Consertar a coluna é trabalho da sincronização,
-- não desta função — e agora dá para saber exatamente quais consertar:
--   select ... where cadastro_desatualizado
--
-- ROLLBACK: reaplicar 20260904120000_dom_isolamento_por_grupo.sql seguido da
-- versão de 05/09 que adicionou fase/documentos/atividade
-- (20260905120000_dom_contexto_com_fase_documentos_e_atividade.sql).
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
           dom_so_digitos(p.process_number) as cnj_digitos,
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
  -- A data real do último movimento, calculada uma vez por processo e usada
  -- tanto no campo quanto na ordenação. GREATEST ignora NULL, então processo
  -- que só tem andamento (ou só decisão) também é atendido.
  mov as (
    select pr.id,
           nullif(btrim(pr.data_ultima_movimentacao), '')::date as cadastro_em,
           greatest(
             (select max(u.data_movimentacao)
                from process_updates u
               where dom_so_digitos(u.numero_cnj) = pr.cnj_digitos
                  or u.process_id = pr.id),
             (select max(d.data_decisao)
                from jm_decisoes d
               where dom_so_digitos(d.processo_cnj) = pr.cnj_digitos)
           ) as feed_em
    from proc pr
  )
  select jsonb_build_object(
    'tem_vinculo', exists (select 1 from g),
    'grupo',       (select group_name from g),
    'lead_id',     (select lead_id from g),

    -- Quem mexeu por último, dito de uma vez. Sem isto o modelo tinha que
    -- deduzir olhando sete blocos de andamento — e deduzia errado.
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

            -- A data que vale: o feed primeiro, o cadastro só como último recurso.
            'ultima_movimentacao',          coalesce(mv.feed_em, mv.cadastro_em),
            -- O que o cadastro diz, preservado. Não escondemos o dado torto.
            'ultima_movimentacao_cadastro', mv.cadastro_em,
            -- O detector: esta linha precisa de conserto na sincronização.
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
                where dom_so_digitos(d2.processo_cnj) = pr.cnj_digitos
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
                where dom_so_digitos(u2.numero_cnj) = pr.cnj_digitos
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
                where dom_so_digitos(d2.processo_cnj) = pr.cnj_digitos
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
              where (dom_so_digitos(h.process_number) = pr.cnj_digitos
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
  'Contexto do assessor virtual. A ultima_movimentacao vem do feed (process_updates/jm_decisoes), nao da coluna de cadastro — que em 05/09/2026 estava errada ou vazia em 94% dos processos do piloto. O valor do cadastro sai em ultima_movimentacao_cadastro e cadastro_desatualizado marca a divergencia, para a fila de conserto da sincronizacao.';

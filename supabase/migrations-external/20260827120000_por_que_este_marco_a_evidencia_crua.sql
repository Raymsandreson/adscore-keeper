-- =============================================================================
-- POR QUE ESTE MARCO — a evidência crua, linha a linha
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- PEDIDO DO RAYM (27/08/2026), olhando a Conferência do processo:
--   "eu acho que o datajud pode estar mais atrapalhando que ajudando; aqui
--    poderia também consultar que movimentação do datajud ele usou para
--    identificar que passou por aquele marco".
--
-- Hoje a trilha diz "Decisão TST / STJ · DataJud · 19/05/2026" e para por aí.
-- Quem lê não tem como saber se o DataJud acertou, porque a linha que gerou o
-- marco — o movimento TPU do tribunal — nunca sai do banco. Sem ela, "o DataJud
-- atrapalha" é palpite dos dois lados: nem dá para provar, nem para desmentir.
--
-- Esta função devolve a MATÉRIA PRIMA do marco: a regra que o reconhece, cada
-- linha que casou com a regra, qual delas ditou a data, e o que as OUTRAS
-- fontes diriam sobre o mesmo marco. Nada aqui detecta nada — é leitura pura,
-- espelhando exatamente os predicados de vw_pop_marcos_detectados,
-- vw_pop_marcos_escavador, vw_pop_marcos_email e da capa em
-- vw_pop_marcos_regua. Se a evidência não explica o marco, o bug está lá, e a
-- tela passa a mostrar isso em vez de escondê-lo.
--
-- O QUE JÁ APARECEU NO PRIMEIRO CASO CONFERIDO (0024387-89.2021.5.24.0086):
--   - "Decisão TST / STJ" veio do código TPU 239 "Não-Provimento", grau SUP,
--     Gabinete da Presidência, 19/05/2026 — e o PDF daquele dia é o não
--     provimento de um AGRAVO DE INSTRUMENTO. O marco existe, mas não é
--     decisão de mérito. Só dá para ver isso lendo o movimento.
--   - "Suspensão" casou QUATRO vezes com o código 272 (2022, 2023 e duas em
--     2024) e o marco ficou com a MENOR data, 17/11/2022. É por isso que um
--     processo com trânsito em julgado em 2026 ainda aparece com o selo
--     "suspenso": a régua registra quando a suspensão foi DETECTADA, e nada
--     nela expira. A evidência mostra as quatro linhas e a que foi usada.
--
-- COMO A DATA É ESCOLHIDA (repetindo a regra da régua, para a tela poder dizer):
--   dentro de uma fonte  ... a MENOR data entre as linhas que casaram;
--   entre as fontes ...... movimento/documento (1) > Escavador (2) > capa (3),
--                          e, no par movimento+documento, o documento vence
--                          quando as duas datas estão a até 30 dias.
--
-- CUSTO: uma chamada por marco aberto, filtrada pelo CNJ. As listas são
-- limitadas a 50 linhas com o total ao lado — marco casado com 300 movimentos
-- é sinal de regra frouxa, e o número diz isso sem despejar 300 linhas na tela.
--
-- REVERSÃO: drop function public.pop_marco_evidencia(uuid, text);
-- =============================================================================

create or replace function public.pop_marco_evidencia(
  p_process_id  uuid,
  p_marco_chave text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_board_id       uuid;
  v_cnj            text;
  v_marco_id       uuid;
  v_rotulo         text;
  v_data_detectada date;
  v_fonte          text;
  v_regras         jsonb;
  v_datajud        jsonb := jsonb_build_object('total', 0, 'linhas', '[]'::jsonb);
  v_documento      jsonb := jsonb_build_object('total', 0, 'linhas', '[]'::jsonb);
  v_escavador      jsonb := jsonb_build_object('total', 0, 'linhas', '[]'::jsonb);
  v_email          jsonb := jsonb_build_object('total', 0, 'linhas', '[]'::jsonb);
  v_capa           jsonb := 'null'::jsonb;
  v_candidatas     jsonb;
  v_cobertura      jsonb;
begin
  select lp.workflow_id::uuid,
         regexp_replace(coalesce(lp.process_number, ''), '[^0-9]', '', 'g')
    into v_board_id, v_cnj
  from lead_processes lp
  where lp.id = p_process_id;

  if v_board_id is null then
    return jsonb_build_object('erro', 'processo sem POP — a régua não roda sem quadro');
  end if;

  select pm.id, pm.rotulo into v_marco_id, v_rotulo
  from pop_marcos pm
  where pm.board_id = v_board_id and pm.chave = p_marco_chave;

  select ppm.data_detectada, ppm.fonte, coalesce(v_rotulo, ppm.rotulo)
    into v_data_detectada, v_fonte, v_rotulo
  from process_pop_marcos ppm
  where ppm.process_id = p_process_id and ppm.marco_chave = p_marco_chave;

  -- ---------------------------------------------------------------------
  -- A regra. Marco sem sinal nenhum não é detectável: ou veio da capa, ou
  -- alguém apagou a regra e o marco ficou órfão no processo.
  -- ---------------------------------------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', s.tipo, 'codigo', s.codigo, 'grau', s.grau,
           'complemento_pattern', s.complemento_pattern,
           'padrao', s.padrao, 'padrao_excluir', s.padrao_excluir,
           'campo_email', s.campo_email, 'email_status', s.email_status,
           'email_servico', s.email_servico,
           'origem', s.origem, 'confirmado', s.confirmado, 'motivo', s.motivo
         ) order by s.tipo, s.codigo nulls last), '[]'::jsonb)
    into v_regras
  from pop_marco_sinais s
  where s.pop_marco_id = v_marco_id;

  -- ---------------------------------------------------------------------
  -- DataJud (tipo='tpu'): o movimento TPU do tribunal. `distinct on (m.id)`
  -- porque dois sinais do mesmo marco podem casar com o mesmo movimento — a
  -- linha é uma só, e contá-la duas vezes inflaria o "casou N vezes".
  -- ---------------------------------------------------------------------
  with casados as (
    select distinct on (m.id)
           m.id, m.codigo, m.nome, m.grau, m.orgao_julgador, m.tribunal_alias,
           m.data_hora, m.complementos, s.codigo as sinal_codigo, s.grau as sinal_grau
    from pop_marco_sinais s
    join jm_movimentos m
      on m.codigo = s.codigo
     and (s.grau is null or s.grau = m.grau)
     and (s.complemento_pattern is null
          or lower(coalesce(m.complementos::text, '')) like '%' || s.complemento_pattern || '%')
    where s.pop_marco_id = v_marco_id
      and s.tipo = 'tpu'
      and regexp_replace(m.processo_cnj, '[^0-9]', '', 'g') = v_cnj
    order by m.id
  ), marcados as (
    select c.*,
           (c.data_hora::date = min(c.data_hora::date) over ()) as usado,
           count(*) over () as total
    from casados c
  )
  select jsonb_build_object(
           'total', coalesce(max(total), 0),
           'linhas', coalesce(jsonb_agg(linha order by data_hora) filter (where rn <= 50), '[]'::jsonb)
         )
    into v_datajud
  from (
    select data_hora, total,
           row_number() over (order by data_hora) as rn,
           jsonb_build_object(
             'id', id, 'codigo', codigo, 'nome', nome, 'grau', grau,
             'orgao_julgador', orgao_julgador, 'tribunal', tribunal_alias,
             'data', data_hora::date, 'data_hora', data_hora,
             'complementos', complementos,
             'sinal_codigo', sinal_codigo, 'sinal_grau', sinal_grau,
             'usado', usado
           ) as linha
    from marcados
  ) t;

  -- ---------------------------------------------------------------------
  -- Documento (tipo='documento'): regex no título da peça. `oculta_em` vai
  -- junto de propósito — a régua NÃO filtra peça desvinculada, então uma peça
  -- que sumiu da tela pode continuar sustentando o marco. Ver isso é o ponto.
  -- ---------------------------------------------------------------------
  with casados as (
    select distinct on (d.id)
           d.id, d.titulo, d.tipo, d.data_documento, d.paginas, d.origem,
           d.storage_path is not null as tem_arquivo, d.oculta_em, s.padrao
    from pop_marco_sinais s
    join jm_documentos d
      on lower(coalesce(d.titulo, '')) ~ s.padrao
     and (s.padrao_excluir is null or lower(coalesce(d.titulo, '')) !~ s.padrao_excluir)
    where s.pop_marco_id = v_marco_id
      and s.tipo = 'documento'
      and d.data_documento is not null
      and regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') = v_cnj
    order by d.id
  ), marcados as (
    select c.*,
           (c.data_documento = min(c.data_documento) over ()) as usado,
           count(*) over () as total
    from casados c
  )
  select jsonb_build_object(
           'total', coalesce(max(total), 0),
           'linhas', coalesce(jsonb_agg(linha order by data_documento) filter (where rn <= 50), '[]'::jsonb)
         )
    into v_documento
  from (
    select data_documento, total,
           row_number() over (order by data_documento) as rn,
           jsonb_build_object(
             'documento_id', id, 'titulo', titulo, 'tipo', tipo,
             'data', data_documento, 'paginas', paginas, 'origem', origem,
             'tem_arquivo', tem_arquivo, 'oculta_em', oculta_em,
             'padrao', padrao, 'usado', usado
           ) as linha
    from marcados
  ) t;

  -- ---------------------------------------------------------------------
  -- Escavador: a movimentação publicada, dentro do JSON do processo. Casa por
  -- CNJ (não por process_id) porque é assim que a view faz — cadastro
  -- duplicado do mesmo CNJ alimenta o marco dos dois.
  -- ---------------------------------------------------------------------
  with mov as (
    select (nullif(mv.value ->> 'data', ''))::date as data_mov,
           lower(coalesce(mv.value -> 'classificacao_predita' ->> 'nome', '')) as classe,
           lower(coalesce(mv.value ->> 'conteudo', '')) as conteudo,
           case mv.value -> 'fonte' ->> 'grau'
             when '1' then 'G1' when '2' then 'G2' when '3' then 'SUP' end as grau
    from lead_processes p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.movimentacoes) = 'array' then p.movimentacoes else '[]'::jsonb end) mv(value)
    where p.deleted_at is null
      and regexp_replace(coalesce(p.process_number, ''), '[^0-9]', '', 'g') = v_cnj
  ), casados as (
    select m.data_mov, m.classe, m.conteudo, m.grau, 'escavador_texto' as via, s.padrao
    from pop_marco_sinais s
    join mov m
      on (m.classe ~ s.padrao or m.conteudo ~ s.padrao)
     and (s.padrao_excluir is null
          or not (m.classe ~ s.padrao_excluir or m.conteudo ~ s.padrao_excluir))
    where s.pop_marco_id = v_marco_id and s.tipo = 'texto' and m.data_mov is not null
    union all
    select m.data_mov, m.classe, m.conteudo, m.grau, 'escavador_grau', null
    from pop_marco_sinais s
    join mov m on m.grau = s.grau
    where s.pop_marco_id = v_marco_id and s.tipo = 'grau' and m.data_mov is not null
  ), marcados as (
    select c.*,
           (c.data_mov = min(c.data_mov) over (partition by c.via)) as usado,
           count(*) over () as total
    from casados c
  )
  select jsonb_build_object(
           'total', coalesce(max(total), 0),
           'linhas', coalesce(jsonb_agg(linha order by data_mov) filter (where rn <= 50), '[]'::jsonb)
         )
    into v_escavador
  from (
    select data_mov, total,
           row_number() over (order by data_mov) as rn,
           jsonb_build_object(
             'data', data_mov, 'classe', classe,
             -- O conteúdo da publicação chega inteiro e às vezes tem milhares de
             -- caracteres. 600 dá para ler a frase que casou sem entupir a tela.
             'conteudo', left(conteudo, 600),
             'cortado', length(conteudo) > 600,
             'grau', grau, 'via', via, 'padrao', padrao, 'usado', usado
           ) as linha
    from marcados
  ) t;

  -- ---------------------------------------------------------------------
  -- E-mail do INSS: a única fonte que alcança requerimento sem CNJ.
  -- ---------------------------------------------------------------------
  with ev as (
    select e.data_evento, e.tipo_evento, e.status, e.servico, e.despacho,
           lower(coalesce(e.despacho, '')) as despacho_l,
           lower(coalesce(e.status, '')) as status_l,
           lower(coalesce(e.servico, '')) as servico_l,
           lower(e.tipo_evento) as evento_l,
           lower(coalesce(pe.subject, '')) as assunto_l
    from inss_requerimento_eventos e
    join processual_emails pe on pe.id = e.email_id
    join lead_processes lp
      on lp.id = p_process_id
     and regexp_replace(coalesce(lp.protocolo_administrativo, ''), '[^0-9]', '', 'g') = e.protocolo
     and coalesce(lp.protocolo_administrativo, '') <> ''
  ), casados as (
    select ev.data_evento, ev.tipo_evento, ev.status, ev.servico, ev.despacho, s.padrao
    from pop_marco_sinais s
    join ev on true
    join lateral (
      select case coalesce(s.campo_email, 'despacho')
               when 'despacho' then ev.despacho_l
               when 'status'   then ev.status_l
               when 'servico'  then ev.servico_l
               when 'assunto'  then ev.assunto_l
               when 'evento'   then ev.evento_l
             end as texto
    ) c on true
    where s.pop_marco_id = v_marco_id and s.tipo = 'email'
      and (s.email_status is null or lower(s.email_status) = ev.status_l)
      and (s.email_servico is null or ev.servico_l ~ lower(s.email_servico))
      and c.texto ~ lower(s.padrao)
      and (s.padrao_excluir is null or c.texto !~ lower(s.padrao_excluir))
  ), marcados as (
    select c.*, (c.data_evento = min(c.data_evento) over ()) as usado,
           count(*) over () as total
    from casados c
  )
  select jsonb_build_object(
           'total', coalesce(max(total), 0),
           'linhas', coalesce(jsonb_agg(linha order by data_evento) filter (where rn <= 50), '[]'::jsonb)
         )
    into v_email
  from (
    select data_evento, total,
           row_number() over (order by data_evento) as rn,
           jsonb_build_object(
             'data', data_evento, 'evento', tipo_evento, 'status', status,
             'servico', servico, 'despacho', left(coalesce(despacho, ''), 600),
             'padrao', padrao, 'usado', usado
           ) as linha
    from marcados
  ) t;

  -- ---------------------------------------------------------------------
  -- A capa. Só vale para ajuizamento, e só quando nenhuma movimentação achou.
  -- ---------------------------------------------------------------------
  if p_marco_chave = 'ajuizamento' then
    select jsonb_build_object(
             'data_distribuicao', lp.data_distribuicao,
             'data_inicio', lp.data_inicio,
             'data', least(
               case when nullif(lp.data_distribuicao, '') ~ '^\d{4}-\d{2}-\d{2}'
                    then substring(lp.data_distribuicao, 1, 10)::date end,
               case when nullif(lp.data_inicio, '') ~ '^\d{4}-\d{2}-\d{2}'
                    then substring(lp.data_inicio, 1, 10)::date end)
           )
      into v_capa
    from lead_processes lp
    where lp.id = p_process_id;
  end if;

  -- ---------------------------------------------------------------------
  -- O que CADA fonte diria. É aqui que "o DataJud atrapalha" vira verificável:
  -- se o Escavador aponta uma data e o DataJud outra, as duas ficam à vista com
  -- a prioridade que decidiu o empate.
  -- ---------------------------------------------------------------------
  select jsonb_agg(x order by prioridade, fonte) into v_candidatas
  from (
    select 'movimento' as fonte, 1 as prioridade,
           (select min((l ->> 'data')::date) from jsonb_array_elements(v_datajud -> 'linhas') l) as data,
           (v_datajud ->> 'total')::int as casou
    union all
    select 'documento', 1,
           (select min((l ->> 'data')::date) from jsonb_array_elements(v_documento -> 'linhas') l),
           (v_documento ->> 'total')::int
    union all
    select via, 2,
           min((l ->> 'data')::date), count(*)::int
    from jsonb_array_elements(v_escavador -> 'linhas') l,
         lateral (select l ->> 'via' as via) v
    group by via
    union all
    select 'email', 2,
           (select min((l ->> 'data')::date) from jsonb_array_elements(v_email -> 'linhas') l),
           (v_email ->> 'total')::int
    union all
    select 'campo_processo', 3, (v_capa ->> 'data')::date, case when v_capa ->> 'data' is null then 0 else 1 end
  ) f
  cross join lateral (
    select jsonb_build_object(
             'fonte', f.fonte, 'prioridade', f.prioridade, 'data', f.data, 'casou', f.casou,
             'venceu', f.fonte = v_fonte
           ) as x
  ) j
  where f.casou > 0;

  -- ---------------------------------------------------------------------
  -- Cobertura: fonte sem UMA linha para este CNJ explica o silêncio. 28% dos
  -- processos com marco têm movimento do DataJud; dizer "não temos" é
  -- informação, deixar a caixa vazia é bug aparente.
  -- ---------------------------------------------------------------------
  select jsonb_build_object(
           'movimentos_datajud', (select count(*) from jm_movimentos m
                                   where regexp_replace(m.processo_cnj, '[^0-9]', '', 'g') = v_cnj),
           'documentos', (select count(*) from jm_documentos d
                           where regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') = v_cnj),
           'movimentacoes_escavador', (select coalesce(sum(jsonb_array_length(
                                          case when jsonb_typeof(p.movimentacoes) = 'array'
                                               then p.movimentacoes else '[]'::jsonb end)), 0)
                                        from lead_processes p
                                        where p.deleted_at is null
                                          and regexp_replace(coalesce(p.process_number, ''), '[^0-9]', '', 'g') = v_cnj)
         )
    into v_cobertura;

  return jsonb_build_object(
    'marco', jsonb_build_object(
      'chave', p_marco_chave, 'rotulo', v_rotulo,
      'data_detectada', v_data_detectada, 'fonte', v_fonte,
      'cadastrado_no_pop', v_marco_id is not null
    ),
    'cnj', v_cnj,
    'regras', v_regras,
    'datajud', v_datajud,
    'documento', v_documento,
    'escavador', v_escavador,
    'email', v_email,
    'capa', v_capa,
    'candidatas', coalesce(v_candidatas, '[]'::jsonb),
    'cobertura', v_cobertura
  );
end;
$$;

comment on function public.pop_marco_evidencia(uuid, text) is
  'Materia prima de UM marco de UM processo: a regra que o reconhece, cada linha que casou (DataJud, documento, Escavador, e-mail, capa), qual ditou a data e o que as outras fontes diriam. Leitura pura — nao detecta nem altera nada.';

-- A sessão do app no Externo é anônima (signInAnonymously), o que dá o role
-- `authenticated`. `anon` fica de fora: quem não entrou não confere processo.
revoke all on function public.pop_marco_evidencia(uuid, text) from public;
grant execute on function public.pop_marco_evidencia(uuid, text) to authenticated;

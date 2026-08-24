-- =============================================================================
-- A CONTRA-PROVA DO SINAL: quantos processos DESTE POP isso pegaria, e quais
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- POR QUE (24/08/2026). O painel de detecção deixa qualquer pessoa do jurídico
-- escrever a regra que reconhece um marco. Sem contra-prova, isso é uma arma:
-- a régua já mostrou que erra de um jeito que ninguém percebe.
--
--   O TPU 277 ("Convenção das Partes para Satisfação Voluntária") virou sinal
--   de "Levantamento / pagamento". Não é levantamento — é o combinado de COMO
--   pagar. Como o marco tinha ordem alta, o processo subia ao topo da régua e
--   travava: o caso 88 ficou 846 dias em "pagamento" tendo ido para execução.
--
--   E na auditoria de 05/08/2026, dos 96 "acórdão" que o parser gerou, 9 eram
--   acórdão. O resto era Certidão de Publicação, DJE, Contrarrazões.
--
-- Nenhuma dessas duas seria escrita se quem escreveu tivesse visto, na hora, a
-- frase que o padrão casa. É isso que esta função devolve: o número E a
-- amostra. O número sozinho não protege — "pega 340" parece ótimo até você ler
-- que 300 são "Mero expediente".
--
-- UNIDADE. Para tpu/texto/documento a conta é em PROCESSOS deste POP. Para
-- email é em REQUERIMENTOS do INSS, e de propósito: hoje quase nenhum
-- protocolo está vinculado, então contar processos devolveria zero para todo
-- padrão e a tela não serviria para nada. O que se quer saber ao escrever a
-- regra é "que e-mails esta frase pega", não "quantos donos eles já têm".
--
-- REGEX INVÁLIDA NÃO DERRUBA A TELA. `padrao` é escrito à mão por gente que
-- não escreve regex; um `(` solto levantaria exceção no meio da digitação. O
-- bloco EXCEPTION devolve o erro como dado.
--
-- REVERSÃO: drop function if exists public.pop_sinal_teste(uuid,text,integer,text,text,text,text,text,text,text);
-- =============================================================================
create or replace function public.pop_sinal_teste(
  p_board_id            uuid,
  p_tipo                text,
  p_codigo              integer default null,
  p_grau                text    default null,
  p_complemento_pattern text    default null,
  p_padrao              text    default null,
  p_padrao_excluir      text    default null,
  p_campo_email         text    default null,
  p_email_status        text    default null,
  p_email_servico       text    default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_res jsonb;
begin
  if p_tipo = 'tpu' then
    if p_codigo is null then
      return jsonb_build_object('erro', 'Sinal de movimentação precisa do código TPU.');
    end if;

    with proc as (
      select lp.id, regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g') as cnj
      from public.lead_processes lp
      where lp.workflow_id = p_board_id::text and lp.deleted_at is null
    ),
    casos as (
      select p.id as ref, m.data_hora::date as data, coalesce(m.nome, '') as texto
      from public.jm_movimentos m
      join proc p on regexp_replace(coalesce(m.processo_cnj,''), '[^0-9]', '', 'g') = p.cnj
      where m.codigo = p_codigo
        and (p_grau is null or p_grau = m.grau)
        and (p_complemento_pattern is null
             or lower(coalesce(m.complementos::text,'')) like '%' || p_complemento_pattern || '%')
    )
    select jsonb_build_object(
      'unidade', 'processos',
      'alvos', count(distinct ref), 'ocorrencias', count(*),
      'primeira', min(data), 'ultima', max(data),
      'amostra', coalesce((select jsonb_agg(a) from (
          select left(texto, 160) as texto, data from casos order by data desc limit 5
        ) a), '[]'::jsonb)
    ) into v_res from casos;

  elsif p_tipo = 'texto' then
    with proc as (
      select lp.id, lp.movimentacoes
      from public.lead_processes lp
      where lp.workflow_id = p_board_id::text and lp.deleted_at is null
    ),
    mov as (
      select p.id as ref,
             nullif(mv.value->>'data','')::date as data,
             lower(coalesce(mv.value->'classificacao_predita'->>'nome','')) as classe,
             lower(coalesce(mv.value->>'conteudo','')) as conteudo
      from proc p
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.movimentacoes) = 'array' then p.movimentacoes else '[]'::jsonb end
      ) mv(value)
    ),
    casos as (
      select ref, data, coalesce(nullif(classe,''), conteudo) as texto
      from mov
      where data is not null
        and (classe ~ p_padrao or conteudo ~ p_padrao)
        and (p_padrao_excluir is null
             or not (classe ~ p_padrao_excluir or conteudo ~ p_padrao_excluir))
    )
    select jsonb_build_object(
      'unidade', 'processos',
      'alvos', count(distinct ref), 'ocorrencias', count(*),
      'primeira', min(data), 'ultima', max(data),
      'amostra', coalesce((select jsonb_agg(a) from (
          select left(texto, 160) as texto, data from casos order by data desc limit 5
        ) a), '[]'::jsonb)
    ) into v_res from casos;

  elsif p_tipo = 'documento' then
    with proc as (
      select lp.id, regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g') as cnj
      from public.lead_processes lp
      where lp.workflow_id = p_board_id::text and lp.deleted_at is null
    ),
    casos as (
      select p.id as ref, d.data_documento as data, coalesce(d.titulo, '') as texto
      from public.jm_documentos d
      join proc p on regexp_replace(coalesce(d.processo_cnj,''), '[^0-9]', '', 'g') = p.cnj
      where d.data_documento is not null
        and lower(coalesce(d.titulo,'')) ~ p_padrao
        and (p_padrao_excluir is null or lower(coalesce(d.titulo,'')) !~ p_padrao_excluir)
    )
    select jsonb_build_object(
      'unidade', 'processos',
      'alvos', count(distinct ref), 'ocorrencias', count(*),
      'primeira', min(data), 'ultima', max(data),
      'amostra', coalesce((select jsonb_agg(a) from (
          select left(texto, 160) as texto, data from casos order by data desc limit 5
        ) a), '[]'::jsonb)
    ) into v_res from casos;

  elsif p_tipo = 'email' then
    -- Conta REQUERIMENTO, não processo. Ver o cabeçalho: com quase nenhum
    -- protocolo vinculado, contar processo devolveria zero para todo padrão.
    with ev as (
      select e.protocolo, e.data_evento,
             lower(coalesce(e.despacho,'')) as despacho_l,
             lower(coalesce(e.status,''))   as status_l,
             lower(coalesce(e.servico,''))  as servico_l,
             lower(e.tipo_evento)           as evento_l,
             lower(coalesce(pe.subject,'')) as assunto_l
      from public.inss_requerimento_eventos e
      join public.processual_emails pe on pe.id = e.email_id
    ),
    casos as (
      select ev.protocolo as ref, ev.data_evento as data,
             case coalesce(p_campo_email,'despacho')
               when 'despacho' then ev.despacho_l when 'status' then ev.status_l
               when 'servico'  then ev.servico_l  when 'assunto' then ev.assunto_l
               when 'evento'   then ev.evento_l end as texto
      from ev
      where (p_email_status  is null or lower(p_email_status) = ev.status_l)
        and (p_email_servico is null or ev.servico_l ~ lower(p_email_servico))
        and (case coalesce(p_campo_email,'despacho')
               when 'despacho' then ev.despacho_l when 'status' then ev.status_l
               when 'servico'  then ev.servico_l  when 'assunto' then ev.assunto_l
               when 'evento'   then ev.evento_l end) ~ lower(p_padrao)
        and (p_padrao_excluir is null
             or (case coalesce(p_campo_email,'despacho')
                   when 'despacho' then ev.despacho_l when 'status' then ev.status_l
                   when 'servico'  then ev.servico_l  when 'assunto' then ev.assunto_l
                   when 'evento'   then ev.evento_l end) !~ lower(p_padrao_excluir))
    )
    select jsonb_build_object(
      'unidade', 'requerimentos',
      'alvos', count(distinct ref), 'ocorrencias', count(*),
      'primeira', min(data), 'ultima', max(data),
      'amostra', coalesce((select jsonb_agg(a) from (
          select left(texto, 160) as texto, data from casos order by data desc limit 5
        ) a), '[]'::jsonb)
    ) into v_res from casos;

  else
    return jsonb_build_object('erro', format('Tipo de sinal sem contra-prova: %s', p_tipo));
  end if;

  return coalesce(v_res, jsonb_build_object('unidade','processos','alvos',0,'ocorrencias',0,'amostra','[]'::jsonb));

exception when others then
  -- Regex meio escrita levanta exceção. Devolver como dado deixa a pessoa
  -- continuar digitando em vez de ver a tela quebrar.
  return jsonb_build_object('erro', sqlerrm);
end $fn$;

grant execute on function public.pop_sinal_teste(uuid,text,integer,text,text,text,text,text,text,text)
  to authenticated, anon, service_role;

comment on function public.pop_sinal_teste is
  'Contra-prova de um sinal antes de grava-lo: quantos processos do POP (ou requerimentos do INSS, no tipo email) ele pegaria, desde quando, e cinco frases de exemplo. Regex invalida volta como {erro}, nao como excecao.';

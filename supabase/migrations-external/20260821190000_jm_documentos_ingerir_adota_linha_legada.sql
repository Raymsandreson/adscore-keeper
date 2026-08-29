-- =============================================================================
-- A COLHEITA ADOTA A LINHA VELHA EM VEZ DE DUPLICAR
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- BUG INTRODUZIDO HORAS ANTES, em 20260821170000, e medido na primeira colheita
-- real (0016527-69.2021.5.16.0018, 21/08/2026):
--   documentos-publicos devolveu 27 peças
--   jm_documentos_ingerir gravou 27 NOVAS
--   o processo passou a ter 47 linhas para 27 peças
--
-- CAUSA: a chave natural ganhou `escavador_documento_id` como quarta coluna. As
-- 4.261 linhas do acervo antigo têm esse campo NULL (coalesce -> 0); a peça que
-- volta da API tem id de verdade. Chave diferente = linha nova. E a linha velha,
-- que é justamente a que tem o PDF já baixado em jm-autos, virava órfã: a nova
-- entrava sem storage_path e o arquivamento baixaria o mesmo PDF outra vez.
--
-- CORREÇÃO: antes de inserir, ADOTA — casa a linha legada pela chave ANTIGA
-- (cnj, título, data) e carimba nela o id, o link renovado e os metadados. Só
-- o que sobrar é inserido. Como a chave antiga era única, não existe linha
-- legada ambígua para adotar; entre dois itens do mesmo título e data, adota o
-- de menor id e o outro entra como novo.
--
-- A adoção é um UPDATE SEPARADO, não um CTE junto do INSERT: CTEs que alteram
-- dados no mesmo comando não enxergam o efeito uma da outra, e o INSERT
-- reinseriria as linhas recém-adotadas.
--
-- VERIFICADO depois de aplicar, no mesmo processo:
--   1ª colheita ... novos=7  adotados=20  processados=27   (27 linhas, 20 já arquivadas)
--   2ª colheita ... novos=0  adotados=0   processados=27   (idempotente)
--   arquivar ...... 7 de 7 baixadas, 0 falhas
--
-- LIMPEZA das 27 duplicatas: delete direto por id (nenhuma tinha storage_path
-- nem filha em jm_documento_leitura / pop_marco_extracoes — conferido antes).
--
-- REVERSÃO: recriar a função com o corpo de 20260821170000.
-- =============================================================================

create or replace function public.jm_documentos_ingerir(p_cnj text, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_novos int := 0; v_total int := 0; v_adotados int := 0;
begin
  if p_cnj is null or jsonb_typeof(p_itens) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'ENTRADA_INVALIDA');
  end if;

  create temp table _itens on commit drop as
  select distinct on (titulo, data_documento, esc_id)
         titulo, tipo, data_documento, data_hora, link, origem, esc_id, extensao, paginas
  from (
    select nullif(d->>'titulo','')                       as titulo,
           coalesce(nullif(d->>'tipo',''), 'PUBLICO')    as tipo,
           nullif(left(d->>'data',10),'')::date          as data_documento,
           (nullif(d->>'data',''))::timestamptz          as data_hora,
           d->>'link'                                    as link,
           coalesce(nullif(d->>'origem',''), 'escavador_autos') as origem,
           nullif(d->>'id','')::bigint                   as esc_id,
           nullif(d->>'extensao','')                     as extensao,
           nullif(d->>'paginas','')::int                 as paginas
    from jsonb_array_elements(p_itens) d
  ) s;

  update public.jm_documentos d
     set escavador_documento_id = a.esc_id,
         link_api      = a.link,
         tipo          = a.tipo,
         data_hora     = coalesce(a.data_hora, d.data_hora),
         extensao      = coalesce(a.extensao, d.extensao),
         paginas       = coalesce(a.paginas, d.paginas),
         storage_error = case when d.storage_path is null then null else d.storage_error end
    from (
      select distinct on (coalesce(titulo,''), coalesce(data_documento,'1900-01-01'::date))
             titulo, data_documento, tipo, data_hora, link, esc_id, extensao, paginas
      from _itens where esc_id is not null
      order by coalesce(titulo,''), coalesce(data_documento,'1900-01-01'::date), esc_id
    ) a
   where d.processo_cnj = p_cnj
     and d.escavador_documento_id is null
     and coalesce(d.titulo,'') = coalesce(a.titulo,'')
     and coalesce(d.data_documento,'1900-01-01'::date) = coalesce(a.data_documento,'1900-01-01'::date);
  get diagnostics v_adotados = row_count;

  with gravados as (
    insert into public.jm_documentos
      (processo_cnj, titulo, tipo, data_documento, data_hora, link_api, origem,
       escavador_documento_id, extensao, paginas)
    select p_cnj, i.titulo, i.tipo, i.data_documento, i.data_hora, i.link, i.origem,
           i.esc_id, i.extensao, i.paginas
    from _itens i
    on conflict (processo_cnj, (coalesce(titulo, '')), (coalesce(data_documento, '1900-01-01'::date)),
                 (coalesce(escavador_documento_id, 0)))
    do update set link_api  = excluded.link_api,
                  tipo      = excluded.tipo,
                  data_hora = coalesce(excluded.data_hora, jm_documentos.data_hora),
                  extensao  = coalesce(excluded.extensao, jm_documentos.extensao),
                  paginas   = coalesce(excluded.paginas, jm_documentos.paginas),
                  storage_error = case when jm_documentos.storage_path is null
                                       then null else jm_documentos.storage_error end
    returning (xmax = 0) as inserido
  )
  select count(*) filter (where inserido), count(*) into v_novos, v_total from gravados;

  drop table if exists _itens;

  return jsonb_build_object('ok', true, 'cnj', p_cnj, 'novos', v_novos,
                            'adotados', v_adotados, 'processados', v_total);
end $function$;

comment on function public.jm_documentos_ingerir(text, jsonb) is
  'Grava as pecas devolvidas pelo Escavador (autos ou documentos-publicos). Adota a linha legada sem escavador_documento_id antes de inserir, para nao duplicar o acervo ja arquivado.';

revoke all on function public.jm_documentos_ingerir(text, jsonb) from public, anon, authenticated;

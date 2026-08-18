-- =============================================================================
-- A duplicação de jm_documentos (17/08/2026): 8.905 linhas para 2.728 documentos
-- reais — 69% de lixo — e 1.445 PDFs baixados a mais no bucket jm-autos.
--
-- CAUSA: `jm_esc_colher_docs()` deduplicava por `link_api`. O link do Escavador
-- é um token cifrado (~323 chars) trocado A CADA CHAMADA — medido: 8.905 links
-- distintos para 8.905 linhas, com prefixo comum de ~215 chars e cauda
-- diferente. O `not exists (... link_api = ...)` nunca batia.
--
-- AGRAVANTE: o cron roda de 20 em 20 min e a função varre `net._http_response`
-- dos últimos 30 min — a mesma resposta era relida na janela seguinte, e várias
-- respostas do mesmo CNJ entravam no mesmo insert (por isso duplicatas com o
-- MESMO captured_at).
--
-- LIMPEZA (executada uma vez, fora deste arquivo, com backup em
-- zz_jm_documentos_bkp_20260817 / zz_jm_documento_leitura_bkp_20260817 /
-- zz_pop_marco_extracoes_bkp_20260817 e mapa perdedor→vencedor em
-- zz_jm_doc_dedup_map_20260817):
--   vencedor = o que TEM arquivo baixado; empate, o id menor. Mesmo critério que
--   a vw_jm_fila_leitura já usava. As filhas (jm_documento_leitura e
--   pop_marco_extracoes, esta com ON DELETE CASCADE) foram REPONTADAS antes do
--   delete — sem isso as 336 extrações teriam ido junto.
--   Resultado: 2.728 documentos, 10 leituras, 168 extrações.
--
-- `titulo` e `data_documento` são nullable (hoje 0 nulos); o coalesce mantém a
-- dedup válida se um dia vier peça sem título ou sem data.
-- =============================================================================
create unique index if not exists jm_documentos_natural_uk
  on public.jm_documentos (
    processo_cnj,
    (coalesce(titulo, '')),
    (coalesce(data_documento, '1900-01-01'::date))
  );

create or replace function public.jm_esc_colher_docs()
 returns integer
 language plpgsql
as $function$
declare v_rec record; v_n int := 0;
begin
  for v_rec in
    select processo_cnj from public.jm_esc_solicitacoes
    where status='PENDENTE' order by id limit 15
  loop
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('acao','docs','cnj',v_rec.processo_cnj),
      timeout_milliseconds := 25000);
    v_n := v_n + 1;
  end loop;

  -- O `distinct on` resolve o duplicado DENTRO do mesmo lote (a mesma resposta
  -- pode listar a peça mais de uma vez, e várias respostas do mesmo CNJ caem na
  -- janela); o `on conflict` resolve contra o que já está gravado.
  insert into public.jm_documentos (processo_cnj, titulo, tipo, data_documento, link_api)
  select distinct on (cnj, titulo, data_documento) cnj, titulo, tipo, data_documento, link
  from (
    select x.content::jsonb->>'cnj' as cnj,
           d->>'titulo' as titulo,
           d->>'tipo' as tipo,
           nullif(left(d->>'data',10),'')::date as data_documento,
           d->>'link' as link
    from net._http_response x
    cross join lateral jsonb_array_elements(x.content::jsonb->'items') d
    where x.created >= now() - interval '30 minutes'
      and x.status_code = 200
      and left(ltrim(x.content), 1) = '{'
      and (x.content::jsonb->>'ok') = 'true'
      and jsonb_typeof(x.content::jsonb->'items') = 'array'
  ) s
  where cnj is not null
  on conflict (processo_cnj, (coalesce(titulo, '')), (coalesce(data_documento, '1900-01-01'::date)))
  do nothing;

  -- Olha a RESPOSTA HTTP, não a inserção: com ON CONFLICT DO NOTHING, um CNJ
  -- cujos documentos já estão todos gravados não insere linha nenhuma, e o
  -- critério antigo (captured_at recente em jm_documentos) deixaria a
  -- solicitação PENDENTE para sempre — redisparada a cada 20 min, queimando
  -- crédito do Escavador.
  -- `net._http_response` é global (guarda resposta de TODA função que usa
  -- pg_net), daí a guarda de '{' antes do cast.
  update public.jm_esc_solicitacoes s set status='SUCESSO', concluido_em=now()
  where s.status='PENDENTE'
    and exists (
      select 1 from net._http_response x
      where x.created >= now() - interval '30 minutes'
        and x.status_code = 200
        and left(ltrim(x.content), 1) = '{'
        and (x.content::jsonb->>'ok') = 'true'
        and x.content::jsonb->>'cnj' = s.processo_cnj
    );
  return v_n;
end $function$;

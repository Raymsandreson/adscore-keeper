-- =============================================================================
-- Conserta três achados do review dos commits de 07/09/2026. Todos meus.
--
-- 1. LAÇO INFINITO DE DOWNLOAD (o mais caro)
--    `jm_esc_arquivar_tick` devolve à fila, a cada 6h, todo erro que NÃO casa
--    `^(HTTP_4|NAO_PDF)` — a ideia era "5xx e timeout são tropeço, não
--    veredito". Os erros que criei hoje, `PDF_SEM_FIM` e `TRUNCADO`, não casam
--    o padrão: as 7 peças truncadas na origem seriam re-baixadas 4x por dia,
--    para sempre, falhando sempre igual. Eu fechei um silêncio e abri um laço.
--
--    Poderia bastar somar PDF_SEM_FIM ao padrão de erro permanente, mas isso
--    parqueia para sempre uma peça que talvez volte boa. E existe um caso real
--    de corte transitório que chega aqui como PDF_SEM_FIM: a API do Escavador
--    NÃO manda Content-Length (medido — `declarado=?` nas 7), então uma conexão
--    que morre no meio não vira TRUNCADO, vira PDF_SEM_FIM também.
--
--    Por isso a solução é TETO, não lista: 3 tentativas, como já se faz na fila
--    de solicitações do Escavador. Vale para toda a família de erro passageiro,
--    não só para a minha — 5xx e UPLOAD também deixam de girar sem fim.
--
-- 2. A REGRA RECUSADA ERA SILENCIOSA
--    `jm_expandir_cronograma_regra` devolve '[]' quando a regra não tem
--    n_parcelas utilizável ou passa de 1.200 parcelas. O cabeçalho da migration
--    anterior prometia "recusada com aviso" — e não havia aviso nenhum: a
--    leitura ficava idêntica a "peça sem cronograma". Prometi detector e
--    entreguei filtro, que é exatamente o que a regra 8 do CLAUDE.md proíbe.
--
--    A regra continua guardada em `cronograma_regra`, então o estado "tinha
--    regra e não virou parcela" É detectável — só não estava à vista. Fica.
--
-- 3. A TABELA DE BACKUP NÃO SE REPRODUZIA
--    A migration 20260907160000 cria `zz_pdf_sem_pagina_bkp_20260907` e nunca a
--    preenche: quem rodasse as migrations num banco limpo teria a tabela vazia,
--    e a comparação "o que voltou do re-download" não existiria. O INSERT que
--    eu rodei à mão entra aqui.
--
-- ROLLBACK:
--   drop view if exists public.vw_jm_cronograma_regra_recusada;
--   alter table public.jm_documentos drop column if exists download_tentativas;
--   (e recriar jm_esc_arquivar_tick sem o teto, da migration 20260906074500)
-- =============================================================================

-- 1. Teto de tentativas de download ------------------------------------------
alter table public.jm_documentos
  add column if not exists download_tentativas integer not null default 0;

comment on column public.jm_documentos.download_tentativas is
  'Quantas vezes a peca voltou para a fila de download depois de falhar. Teto de 3 no jm_esc_arquivar_tick: sem ele, erro que se repete sempre igual (PDF truncado na origem, por exemplo) e re-baixado 4x por dia para sempre.';

create or replace function public.jm_esc_arquivar_tick()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_devolvidos int;
  v_fila       int;
begin
  -- Erro passageiro volta para a fila; erro permanente fica de fora.
  -- HTTP_404 = a peca nao existe mais no Escavador
  -- NAO_PDF  = o que veio no link nao e um PDF
  -- O resto (5xx deles, UPLOAD do nosso storage, timeout, PDF_SEM_FIM) e
  -- tropeco -- mas tropeco COM TETO. Sem teto, o que falha sempre igual volta
  -- 4x por dia para sempre: foi o que quase aconteceu com as 7 pecas truncadas
  -- na origem. Tres tentativas e o mesmo numero da fila de solicitacoes.
  with volta as (
    update public.jm_documentos
       set storage_error       = null,
           download_tentativas = coalesce(download_tentativas, 0) + 1
     where storage_path is null
       and storage_error is not null
       and storage_error !~* '^(HTTP_4|NAO_PDF)'
       and coalesce(download_tentativas, 0) < 3
       and coalesce(stored_at, '-infinity'::timestamptz) < now() - interval '6 hours'
    returning 1
  ) select count(*) into v_devolvidos from volta;

  select count(*) into v_fila
    from public.jm_documentos
   where storage_path is null and storage_error is null and link_api is not null;

  if v_fila = 0 then
    return format('nada a baixar (devolvidos=%s)', v_devolvidos);
  end if;

  perform net.http_post(
    'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('acao','arquivar','limite',60,'concorrencia',8,'orcamento_ms',110000),
    timeout_milliseconds := 130000);

  return format('disparado: fila=%s devolvidos=%s', v_fila, v_devolvidos);
end $function$;

comment on function public.jm_esc_arquivar_tick() is
  'Devolve a fila o erro passageiro (ate 3 vezes) e dispara a acao arquivar do esc-autos. HTTP_4xx e NAO_PDF sao veredito permanente e nao voltam.';

-- 2. A regra que foi recusada para de ser invisivel ---------------------------
create or replace view public.vw_jm_cronograma_regra_recusada as
select l.documento_id,
       l.processo_cnj,
       d.titulo,
       l.cronograma_regra,
       (l.cronograma_regra->>'n_parcelas') as n_parcelas_pedidas,
       case
         when nullif(l.cronograma_regra->>'n_parcelas','') is null then 'regra sem n_parcelas'
         when (l.cronograma_regra->>'n_parcelas') !~ '^\d+$'       then 'n_parcelas nao e numero'
         when (l.cronograma_regra->>'n_parcelas')::numeric > 1200  then 'acima do teto de 1.200 parcelas'
         else 'motivo nao classificado'
       end as motivo
  from public.jm_documento_leitura l
  join public.jm_documentos d on d.id = l.documento_id
 where l.cronograma_regra is not null
   and coalesce(jsonb_array_length(coalesce(l.cronograma, '[]'::jsonb)), 0) = 0;

comment on view public.vw_jm_cronograma_regra_recusada is
  'Leituras que trouxeram regra de cronograma e mesmo assim ficaram sem parcela: a regra foi recusada pela expansao. Sem esta lista o caso era indistinguivel de "peca sem cronograma" — detector que nao aparece e filtro.';

-- 3. O backup das 11, que a migration anterior criava vazio -------------------
-- Idempotente: se ja foi preenchido a mao (foi, em 07/09/2026), nao duplica.
insert into public.zz_pdf_sem_pagina_bkp_20260907 (documento_id, storage_path, bytes_antes, paginas_esperadas)
select d.id, d.storage_path, (o.metadata->>'size')::bigint, d.paginas
  from public.jm_documentos d
  left join storage.objects o on o.bucket_id='jm-autos' and o.name = d.storage_path
 where d.leitura_erro like '%no pages%'
    or d.storage_error like 'PDF_SEM_FIM%'
on conflict (documento_id) do nothing;

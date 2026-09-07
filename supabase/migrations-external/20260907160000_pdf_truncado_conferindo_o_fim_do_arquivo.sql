-- =============================================================================
-- O download de peça passa a conferir o FIM do arquivo, não só o começo.
--
-- COMO APARECEU
-- Onze peças chegavam ao leitor e voltavam
--     gemini 400: {"error":{"code":400,"message":"The document has no pages."}}
-- O arquivo estava lá, com mimetype application/pdf, e o Escavador dizia
-- quantas páginas tinha: 9, 18, 23, 24, 54, 57. Documento com página, arquivo
-- guardado, e mesmo assim "sem páginas".
--
-- O QUE OS TAMANHOS DENUNCIARAM
-- Sete dos onze tinham tamanho MÚLTIPLO EXATO de 16.384 bytes:
--     32.768 (×2)     311.296 (×19)   442.368 (×27)   475.136 (×29)
--    688.128 (×42)    851.968 (×52) 1.081.344 (×66)
-- PDF real não tem tamanho redondo assim. Isso é download cortado num limite de
-- bloco de 16 KiB — a conexão morreu no meio da transferência.
--
-- E o corte cai justamente onde dói: o índice de páginas de um PDF mora no FIM
-- do arquivo (xref + trailer + %%EOF). Truncado, o arquivo abre, começa com
-- %PDF e não tem página nenhuma.
--
-- A CAUSA NO CÓDIGO (esc-autos, ação `arquivar`)
--     const magic = new TextDecoder().decode(buf.slice(0, 5));
--     if (!magic.startsWith("%PDF")) throw ...
-- Conferia os 5 primeiros bytes e concluía que o arquivo estava inteiro. É a
-- mesma família de defeito que esta sessão já encontrou três vezes: a etapa se
-- dá por bem-sucedida porque RODOU, não porque FEZ. Aqui: porque o arquivo
-- COMEÇA como PDF, não porque É um PDF completo.
--
-- E o preço do silêncio: o defeito nasceu no degrau do download, em agosto, e
-- só apareceu semanas depois, do outro lado do sistema, disfarçado de erro do
-- Gemini. Quem olhasse o erro procuraria no lugar errado.
--
-- O CONSERTO (deploy esc-autos v33, junto com esta migration)
--   1. o que chegou tem que bater com o Content-Length declarado pelo servidor;
--   2. o arquivo tem que terminar com %%EOF, procurado nos últimos 2 KB
--      (há PDF com lixo depois do marcador).
-- Falhando qualquer uma, NÃO grava: fica com `storage_error` e volta para a
-- fila. Arquivo pela metade guardado como bom é pior que ausente — some do
-- radar e reaparece como defeito de outro degrau.
--
-- ESTA MIGRATION guarda o estado anterior das onze, para dar para comparar o
-- que voltou do re-download com o que estava lá. Sem o tamanho de antes, "o
-- arquivo mudou" vira palpite.
--
-- ROLLBACK: drop table if exists public.zz_pdf_sem_pagina_bkp_20260907;
--           (e redeploy da versão 32 do esc-autos)
-- =============================================================================

create table if not exists public.zz_pdf_sem_pagina_bkp_20260907 (
  documento_id      bigint primary key,
  storage_path      text,
  bytes_antes       bigint,
  paginas_esperadas integer,
  gravado_em        timestamptz not null default now()
);

comment on table public.zz_pdf_sem_pagina_bkp_20260907 is
  'Estado anterior das 11 pecas que o Gemini recusava com "The document has no pages" (07/09/2026). Guarda o tamanho do arquivo truncado e quantas paginas o Escavador dizia haver, para comparar com o que voltar do re-download.';

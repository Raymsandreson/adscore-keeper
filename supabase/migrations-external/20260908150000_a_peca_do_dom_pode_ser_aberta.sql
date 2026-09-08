-- =============================================================================
-- A peça citada no painel do Dom passa a poder ser ABERTA
--
-- O PEDIDO (08/09/2026)
-- No painel "De onde saiu (para conferir)", a seção "Documento lido" lista as
-- peças que entraram no prompt, cada uma com o resumo feito pela IA. Falta
-- poder clicar e VER o documento, com zoom, como já se faz na aba Documentos
-- do processo.
--
-- POR QUE ISSO EXIGE MEXER NA RPC
-- O contexto é um retrato gravado junto com o rascunho
-- (`dom_rascunhos.contexto_usado`) e até aqui guardava, por peça, apenas
-- título, data e resumo. Isso NÃO identifica um documento. Medido neste banco
-- em 08/09/2026 sobre os 9.151 documentos com leitura:
--
--     8.630 chaves (processo_cnj, titulo, data_documento) distintas
--       251 chaves repetidas, cobrindo 772 documentos em 48 processos
--        17 documentos na mesma chave, no pior caso
--
-- Abrir "a peça de mesmo título e mesma data" erraria em ~6% dos cliques, sem
-- avisar ninguém. Peça errada ao lado de um resumo é prova falsa — pior que
-- botão nenhum, porque tem cara de conferência. Por isso o contexto passa a
-- carregar o que identifica de verdade: `id` e `arquivo`
-- (`jm_documentos.storage_path`).
--
-- O QUE MUDA, EXATAMENTE
-- Duas chaves a mais dentro de cada item de `processos[].documentos[]`. Nada
-- mais. Em particular NÃO muda o prompt: quem monta o texto do system prompt é
-- a `dom-contexto`, e de cada documento ela lê apenas `data`, `peca` e
-- `resumo` (supabase/functions/_external/dom-contexto/index.ts, bloco "O que as
-- peças do processo dizem"). Chave nova em JSON que ninguém lê não vira token.
--
-- `arquivo` é o CAMINHO dentro do bucket privado `jm-autos`, não uma URL. Para
-- abrir é preciso sessão autenticada e a policy do bucket, que então assina uma
-- URL de 10 minutos. O caminho sozinho não dá acesso a nada.
--
-- O QUE NÃO MUDA
-- Nenhuma outra chave do contexto, nenhuma outra CTE, nenhum índice, nenhuma
-- tabela. Os rascunhos já gravados continuam como estão — o painel sabe lidar
-- com contexto sem `id`/`arquivo` (procura a peça e só abre se for única).
--
-- ROTA DE FUGA
-- `dom_contexto_processual_antes_peca_clicavel` guarda a versão de agora,
-- criada por este mesmo arquivo ANTES de qualquer alteração. Rollback: ler o
-- def dela, trocar o nome de volta e executar. Remover a cópia só depois de
-- 24h de uso verde.
-- =============================================================================

-- ── 0. Rota de fuga, antes de mexer ──────────────────────────────────────────
--
-- A GUARDA `emite_arquivo` NÃO É ENFEITE, e aprendi isso do jeito ruim: na
-- aplicação de 08/09/2026 este bloco rodou uma segunda vez DEPOIS do bloco 1 e
-- sobrescreveu a cópia com o corpo NOVO. Resultado: por alguns minutos a
-- "rota de fuga" era uma cópia da própria versão nova — rollback nenhum, com
-- cara de rollback. Descobri porque a conferência de não-regressão acusou 86
-- de 86 documentos "divergentes": os dois lados emitiam `arquivo`.
--
-- Rota de fuga que se sobrescreve sozinha é pior que rota de fuga nenhuma,
-- porque some sem avisar. Com a guarda, rodar este arquivo de novo é inócuo.
do $mig$
declare def text; copia text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';
  if def is null then raise exception 'dom_contexto_processual não existe'; end if;

  -- A função viva já é a nova? Então a cópia (se existir) é a antiga e não pode
  -- ser tocada; e se não existir, copiar a nova não guardaria nada.
  if position('''arquivo''' in def) > 0 then
    raise notice 'a função viva já é a versão nova — a rota de fuga não será sobrescrita';
    return;
  end if;

  copia := replace(def,
                   'FUNCTION public.dom_contexto_processual(',
                   'FUNCTION public.dom_contexto_processual_antes_peca_clicavel(');
  if copia = def then raise exception 'não achei o nome da função para copiar'; end if;
  execute copia;
end $mig$;

-- ── 1. O bloco `documentos` passa a dizer QUAL peça é ────────────────────────
do $mig$
declare
  def   text;
  velho text := $a$            'documentos', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'peca',   dd.titulo,
                       'data',   dd.data_documento,
                       'resumo', left(dom_texto_limpo(dd.resumo), 500)) order by dd.data_documento desc)
              from (
                select d2.titulo, d2.data_documento, l2.resumo
                from jm_documentos d2$a$;
  novo  text := $a$            'documentos', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'id',      dd.id,
                       'arquivo', dd.storage_path,
                       'peca',    dd.titulo,
                       'data',    dd.data_documento,
                       'resumo',  left(dom_texto_limpo(dd.resumo), 500)) order by dd.data_documento desc)
              from (
                select d2.id, d2.storage_path, d2.titulo, d2.data_documento, l2.resumo
                from jm_documentos d2$a$;
  novo_def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  if position(novo in def) > 0 then
    raise notice 'já aplicado — o bloco documentos já emite id e arquivo';
    return;
  end if;
  if position(velho in def) = 0 then
    raise exception 'o bloco documentos não está como esperado; não vou substituir no escuro';
  end if;

  novo_def := replace(def, velho, novo);
  execute novo_def;
end $mig$;

-- ── 2. Conferência (rodar depois de aplicar) ─────────────────────────────────
--   select d->>'peca', d->>'data', d->>'id', d->>'arquivo'
--   from jsonb_array_elements(
--          dom_contexto_processual('<group_jid de um grupo com peça lida>')
--            -> 'processos') p,
--        jsonb_array_elements(p -> 'documentos') d;
--   Esperado: `id` e `arquivo` preenchidos em toda peça; `arquivo` apontando
--   para um objeto existente no bucket jm-autos.
--
-- APLICADA em 08/09/2026. Conferido nos 25 primeiros grupos do piloto com peça
-- lida, contra dom_contexto_processual_antes_peca_clicavel:
--     tudo fora de `processos` .................... 0 diferenças
--     39 processos, fora de `documentos` .......... 0 diferenças
--     contagem de documentos por processo ......... 0 mudanças
--     93 documentos, tirando `id` e `arquivo` ..... 0 diferenças
--     documentos sem `id` ou sem `arquivo` ........ 0
-- Ou seja: as duas chaves novas entraram e nada mais mudou.
-- Tamanho da cópia de fuga: 13.066 = 13.046 (a função medida antes de qualquer
-- alteração) + 20 do nome mais longo.

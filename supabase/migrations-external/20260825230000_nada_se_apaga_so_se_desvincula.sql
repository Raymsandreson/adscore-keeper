-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 25/08/2026.
-- ============================================================================
-- Decisao do Raym: "em vez de apagar so desvincular".
--
-- A migration 20260825170000 tinha aberto DELETE para peca com origem =
-- 'manual', e a 20260825210000 trouxe o desvincular (oculta_em) para a peca do
-- tribunal. Com o desvincular resolvendo os dois casos, o DELETE virou
-- permissao que ninguem exerce — e permissao que ninguem usa nao deve existir.
--
-- POR QUE DESVINCULAR BASTA
--
--   O que se quer, em todos os casos, e que a peca errada PARE DE APARECER
--   naquele marco. Nao que ela deixe de existir. A tela fica igualmente certa
--   nas duas solucoes; so uma delas e reversivel.
--
--   E o que veio do tribunal custou uma solicitacao ao Escavador, que hoje
--   funciona em UM tribunal de oito (secao 15 do jurimetria-fluxo-carteira.md).
--   Apagar por engano nao se conserta com um clique.
--
-- O QUE SOBRA, e e o minimo para o fluxo funcionar:
--
--   jm_documentos    SELECT · INSERT · UPDATE (so oculta_em e oculta_motivo)
--   bucket jm-autos  SELECT · INSERT
--
--   Nenhum DELETE em lugar nenhum. Arquivo que entrou no acervo nao sai por
--   caminho de tela.
--
-- REVERSAO: recriar as policies que a 20260825170000 trazia. Nao ha perda de
-- dado — este arquivo so retira permissao.
-- ============================================================================

drop policy if exists jm_doc_del_manual   on public.jm_documentos;
drop policy if exists jm_autos_del_manual on storage.objects;
revoke delete on public.jm_documentos from authenticated;

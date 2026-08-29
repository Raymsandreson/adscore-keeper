-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 25/08/2026.
-- ============================================================================
-- O Raym: "mesmo sendo peca do tribunal anexada pelo sistema do Escavador, tem
-- casos que e anexado de forma errada e precisa ser substituida."
--
-- Ele esta certo, e a migration anterior (20260825170000) bloqueava isso: so
-- peca com origem = 'manual' podia sair. Mas HA DOIS problemas diferentes ai:
--
--   arquivo errado   o Escavador baixou peca trocada, ou o tribunal juntou no
--                    lugar errado. O PDF em si nao serve.
--   vinculo errado   o PDF e bom, mas o casamento POR DATA o pegou para o marco
--                    errado. Apagar seria pior: perde documento valido.
--
-- Em nenhum dos dois apagar e a resposta certa. Apagar peca do acervo custa uma
-- solicitacao nova ao Escavador — que hoje funciona em UM tribunal de oito
-- (secao 15 do jurimetria-fluxo-carteira.md). Destruir o que custou caro para
-- corrigir uma exibicao e trocar um problema pequeno por um caro.
--
-- A RESPOSTA: ocultar, nao apagar. A peca sai do casamento e da tela, o arquivo
-- continua no bucket, e desfazer e um clique. `oculta_motivo` guarda POR QUE —
-- sem isso, seis meses depois ninguem sabe se foi engano ou decisao.
--
-- POR QUE COLUNA E NAO TABELA A PARTE: e atributo da peca, nao evento proprio.
-- Uma peca esta oculta ou nao esta; nao ha historico a manter.
--
-- A TRAVA DE COLUNA, que e o ponto desta migration
--
--   RLS sozinha nao restringe QUAIS colunas o UPDATE alcanca. Uma policy de
--   UPDATE aberta deixaria qualquer sessao reescrever `storage_path` e apontar
--   o registro de uma peca para outro arquivo — pior que apagar, porque a
--   mentira fica plausivel.
--
--   Por isso o GRANT e por COLUNA. RLS diz QUAIS LINHAS; o GRANT diz QUAIS
--   COLUNAS. As duas juntas fecham: o autenticado so consegue mexer em
--   `oculta_em` e `oculta_motivo`, e em mais nada.
--
-- REVERSAO:
--   drop policy if exists jm_doc_upd_ocultar on public.jm_documentos;
--   revoke update (oculta_em, oculta_motivo) on public.jm_documentos from authenticated;
--   alter table public.jm_documentos drop column if exists oculta_em, drop column if exists oculta_motivo;
-- ============================================================================

alter table public.jm_documentos
  add column if not exists oculta_em     timestamptz,
  add column if not exists oculta_motivo text;

comment on column public.jm_documentos.oculta_em is
  'Quando a peça saiu de cena. Preenchido = não entra em casamento de marco nem na tela; o arquivo continua no bucket e desfazer é um clique.';
comment on column public.jm_documentos.oculta_motivo is
  'Por que foi ocultada. Sem isso, meses depois ninguém sabe se foi engano ou decisão.';

-- Achar rápido o que está visível — é o caso de 99% das consultas.
create index if not exists idx_jm_doc_visivel
  on public.jm_documentos (processo_cnj) where oculta_em is null;

-- RLS diz QUAIS LINHAS. Todas, porque peça do tribunal também erra.
create policy jm_doc_upd_ocultar on public.jm_documentos
  for update to authenticated using (true) with check (true);

-- GRANT diz QUAIS COLUNAS. Só estas duas — storage_path e titulo ficam fora do
-- alcance de qualquer sessão, e é isso que impede apontar o registro de uma
-- peça para outro arquivo.
revoke update on public.jm_documentos from authenticated;
grant update (oculta_em, oculta_motivo) on public.jm_documentos to authenticated;

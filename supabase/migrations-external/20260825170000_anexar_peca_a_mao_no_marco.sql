-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 25/08/2026, a pedido expresso do Raym: "pode anexar peca e ate
-- excluir" na trilha de marcos da conferencia.
-- ============================================================================
-- POR QUE: o certificado digital abre UM tribunal em oito (secao 15 do
-- jurimetria-fluxo-carteira.md). A peca que decide dinheiro — termo de acordo,
-- planilha de calculo homologada — quase sempre e restrita e nao vem sozinha.
-- Sem caminho manual, a carteira fica esperando um certificado que pode nunca
-- funcionar.
--
-- O caso que motivou: o termo de acordo do 0011351-63.2022.5.15.0031 mostrou
-- que a cota do cliente lancada estava certa ao centavo e o honorario divergia
-- em R$ 59.561,26. Sem o termo, ninguem tinha como saber qual dos dois numeros
-- confiar.
--
-- O QUE ESTA MIGRATION CONCEDE
--
--   INSERT em jm_documentos e no bucket jm-autos, para usuario autenticado.
--   DELETE apenas do que foi anexado A MAO.
--
-- A TRAVA DO DELETE, que e o ponto desta migration
--
--   Peca colhida do tribunal e ACERVO: apagar perde o arquivo e ele so volta
--   com uma nova solicitacao paga. Peca anexada a mao e trabalho de pessoa, que
--   erra o arquivo e precisa corrigir.
--
--   Por isso o DELETE e travado nos dois lados, e a trava mora no BANCO e nao na
--   tela — botao escondido nao protege nada:
--
--     jm_documentos    so apaga linha com origem = 'manual'
--     storage.objects  so apaga arquivo cuja pasta seja <cnj>/manual/...
--
--   Nao ha UPDATE. Peca errada se apaga e se anexa de novo; nao se edita o
--   registro do que ja foi lido.
--
-- LEMBRETE do que ja estava aberto: o Externo entra por signInAnonymously(), e
-- 81 das 96 tabelas ja liberam SELECT sem condicao (docs/sistema/
-- acesso-externo-sessao-anonima.md). Este INSERT herda essa fragilidade — quem
-- alcanca o projeto pode anexar peca. Nao inaugura o problema, mas amplia o
-- estrago possivel de leitura para ESCRITA, e por isso e mais um motivo para a
-- edge de sessao real sair do papel.
--
-- REVERSAO (nenhum dado e tocado):
--   drop policy if exists jm_doc_ins            on public.jm_documentos;
--   drop policy if exists jm_doc_del_manual     on public.jm_documentos;
--   drop policy if exists jm_autos_ins          on storage.objects;
--   drop policy if exists jm_autos_del_manual   on storage.objects;
-- ============================================================================

create policy jm_doc_ins on public.jm_documentos
  for insert to authenticated with check (true);

-- Acervo do tribunal nao se apaga: so o que foi anexado a mao.
create policy jm_doc_del_manual on public.jm_documentos
  for delete to authenticated using (origem = 'manual');

create policy jm_autos_ins on storage.objects
  for insert to authenticated with check (bucket_id = 'jm-autos');

-- Mesma trava no arquivo: a pasta <cnj>/manual/ e a unica apagavel.
create policy jm_autos_del_manual on storage.objects
  for delete to authenticated
  using (bucket_id = 'jm-autos' and (storage.foldername(name))[2] = 'manual');

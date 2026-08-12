-- Eventos do push do tribunal dentro da linha do feed do sino.
--
-- O e-mail do PJe/TST/TRT traz o teor num bloco "Eventos:" em linha corrida
-- ("06/08/2026 00:14 Decorrido o prazo de CGB ENERGIA LTDA ..."), sem a tabela
-- de `|` que o parser lia. Resultado medido em 12/08/2026: 862 das 1.157 linhas
-- de origem email_push (74,5%) tinham como descrição só o ASSUNTO do e-mail, e
-- o card do sino mostrava "aviso por e-mail · TST" sem dizer o que aconteceu.
--
-- Agora o e-mail vira UMA linha (título + resumo) com a lista de eventos aqui,
-- consultável no card. Null nas linhas do Escavador e do layout de tabela, onde
-- cada movimento já é uma linha própria.
--
-- Aplicada no Externo (kmedldlepwiityjsdahz) em 12/08/2026.
alter table public.process_updates
  add column if not exists eventos jsonb;

comment on column public.process_updates.eventos is
  'Eventos do push do tribunal ([{data,hora,texto}]) quando o e-mail vem no layout "Eventos:" em linha corrida.';

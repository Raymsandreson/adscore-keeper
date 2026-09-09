-- Um escopo para o dinheiro — porque quem responde valor não é quem acolhe
--
-- APLICAR no projeto EXTERNO (kmedldlepwiityjsdahz).
--
-- POR QUÊ
-- `dom_atendentes.escopo` nasceu com três valores: 'reclamacao',
-- 'saida_de_grupo' e 'geral'. Pergunta sobre dinheiro caía em 'reclamacao'
-- junto com tudo o mais que precisa de gente — e dinheiro não é reclamação:
-- é a única família em que responder errado custa dinheiro de verdade, e a
-- pessoa certa para ela quase nunca é a mesma que acompanha o cliente no
-- grupo.
--
-- Medido em 09/09/2026 sobre os 394 rascunhos já gerados:
--   E17  pergunta sobre dinheiro ou prazo ... 18
--   E21  pediu dinheiro adiantado ..........   3
--   COBRANCA ...............................   2
--                                            ----
--                                              23  (5,8%)
--
-- Ressalva registrada, para quem ler isto depois: E17 é "dinheiro OU prazo",
-- e são 18 dos 23. Enquanto o classificador não separar as duas coisas, a
-- pergunta de prazo vai para o financeiro junto — decisão tomada com o custo
-- à vista, e o conserto é separar a intenção, não mexer aqui.
--
-- O QUE MUDA
-- Só a lista de valores aceitos. Nenhuma linha existente é tocada: hoje há um
-- único atendente cadastrado, escopo 'geral', e ele continua igual. Sem
-- ninguém no escopo 'financeiro', a `pick_dom_atendente` já cai sozinha no
-- 'geral' — quer dizer que ligar isto ANTES de cadastrar alguém não muda
-- comportamento nenhum.
--
-- ROLLBACK
--   alter table dom_atendentes drop constraint dom_atendentes_escopo_check;
--   alter table dom_atendentes add constraint dom_atendentes_escopo_check
--     check (escopo in ('reclamacao', 'saida_de_grupo', 'geral'));
-- Só volta limpo se nenhuma linha tiver ficado com escopo 'financeiro'; com
-- alguma, mover para 'reclamacao' antes.

alter table dom_atendentes
  drop constraint if exists dom_atendentes_escopo_check;

alter table dom_atendentes
  add constraint dom_atendentes_escopo_check
  check (escopo in ('reclamacao', 'saida_de_grupo', 'geral', 'financeiro'));

comment on column dom_atendentes.escopo is
  'Que tipo de pendência esta pessoa recebe. financeiro = valor, cobrança e '
  'pedido de dinheiro; reclamacao = o resto do que precisa de gente; '
  'saida_de_grupo = quem sai do grupo; geral = pega o que sobrar dos outros '
  'escopos (é o fallback da pick_dom_atendente).';

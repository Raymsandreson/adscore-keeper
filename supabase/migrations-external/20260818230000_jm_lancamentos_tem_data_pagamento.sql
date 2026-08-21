-- =============================================================================
-- LANÇAMENTOS — desfaz a categoria "Honorários condenação" e põe o fato numa
-- COLUNA PRÓPRIA.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- POR QUE VOLTAR ATRÁS (Raym, 18/08/2026): a migration 20260818210000 tinha
-- criado a categoria 'Honorários condenação' para as 31 linhas cuja data é a da
-- DECISÃO, não de vencimento. Resolvia o sintoma pelo lugar errado — no
-- vocabulário do escritório, CATEGORIA diz QUE TIPO de dinheiro é (honorário,
-- indenização, custas) e ESTÁGIO diz ONDE o dinheiro está (a receber, vencido,
-- condenação). "Condenação" é estágio; enfiá-lo na categoria misturou as duas
-- gavetas. E pior: a categoria vem da planilha, então a reclassificação só
-- sobrevivia com um guarda no importador para não ser desfeita em silêncio.
--
-- O FATO QUE FALTAVA não é a categoria — é o SIGNIFICADO DA DATA. Em quase toda
-- linha, `data` é o vencimento. Nestas 31, é o dia em que o juiz decidiu, e não
-- existe cronograma de pagamento nenhum (todas com `n_parcela = 1` e observação
-- "Condenação em 1º/2º grau"). É essa a pergunta que a régua faz — "tem data
-- certa?" — e agora ela tem uma coluna para responder.
--
-- `tem_data_pagamento`:
--   true  (padrão)  a `data` da linha é o vencimento
--   false           não há cronograma; a `data` é a da decisão. A régua lê isso
--                   como CONDENAÇÃO: valor certo, data incerta — nunca vencido.
--
-- Ganho de brinde: a coluna NÃO existe na planilha, então o importador não a
-- toca e a marcação sobrevive a qualquer reimportação sozinha. O guarda
-- `preservaCategoria` sai do script por ter deixado de ser necessário.
--
-- IDEMPOTENTE: a reversão da categoria vem da tabela de backup, que sobra
-- intacta; rodar duas vezes não muda nada na segunda.
--
-- REVERSÃO: alter table public.jm_lancamentos drop column tem_data_pagamento;
--           (a categoria já volta ao original nesta própria migration)
-- =============================================================================

-- 1. Categoria volta a ser o que a planilha diz.
update public.jm_lancamentos l
   set categoria = b.categoria_anterior
  from public.jm_lancamentos_categoria_backup_20260818 b
 where b.id = l.id
   and l.categoria is distinct from b.categoria_anterior;

-- 2. O fato ganha coluna própria.
alter table public.jm_lancamentos
  add column if not exists tem_data_pagamento boolean not null default true;

comment on column public.jm_lancamentos.tem_data_pagamento is
  'false = a coluna `data` desta linha e a data da DECISAO, nao de vencimento: o valor esta fixado mas nao ha cronograma de pagamento (estagio CONDENACAO da regua). true (padrao) = `data` e o vencimento. Nao existe na planilha de proposito — assim a marcacao sobrevive a reimportacao.';

-- 3. As 31 linhas identificadas em 18/08/2026. Vêm da tabela de backup, que
--    guardou exatamente quais foram — sem repetir a busca por texto na
--    observação, que poderia pegar linha diferente se a planilha tiver mudado.
update public.jm_lancamentos
   set tem_data_pagamento = false
 where id in (select id from public.jm_lancamentos_categoria_backup_20260818);

-- Índice parcial: são poucas linhas (31 de 4.742) e a carteira filtra por elas
-- ao montar o chip de condenação.
create index if not exists idx_jm_lanc_sem_data_pagamento
  on public.jm_lancamentos (tem_data_pagamento)
  where tem_data_pagamento = false;

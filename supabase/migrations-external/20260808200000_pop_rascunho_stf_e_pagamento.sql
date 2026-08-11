-- =============================================================================
-- Aprofunda as duas fases que nasceram rasas no POP original.
--
-- Recurso Extraordinário (STF) tinha 2 passos: "Pendente intimação" e
-- "Intimação realizada". Levantamento / pagamento também tinha 2: "Recebimento
-- de Valores" e "Prestação de Contas ao Cliente". Nas duas o POP terminava
-- justamente onde o assunto começa — e a segunda é onde o dinheiro entra.
--
-- Só o rascunho é afetado: os templates de lá são cópias (ver migration
-- 20260808190000), então editar aqui não toca no POP em uso.
--
-- -----------------------------------------------------------------------------
-- STF: 2 → 13 passos
-- -----------------------------------------------------------------------------
-- Os dois originais viram a abertura, e entra o caminho real: prazo de 15 dias
-- úteis, demonstração de REPERCUSSÃO GERAL (art. 102, §3º da CF — sem a
-- preliminar o RE nem é conhecido), juízo de admissibilidade feito na origem
-- pelo TST, agravo do art. 1.042 do CPC quando a presidência barra, e a decisão
-- final do STF.
--
-- O passo que explica silêncio: "verificar sobrestamento por tema de
-- repercussão geral". Processo afetado a leading case fica parado por meses sem
-- movimentação nenhuma — e sem esse passo marcado, parece abandono da equipe.
--
-- -----------------------------------------------------------------------------
-- PAGAMENTO: 2 → 10 passos
-- -----------------------------------------------------------------------------
-- Os dois passos originais não distinguiam três coisas que a régua financeira
-- (skill whatsjud-fluxo-vocabulario) trata como separadas:
--
--   1. COTA DO CLIENTE ≠ HONORÁRIO — recebíveis distintos, donos distintos.
--      Somar os dois num "recebimento de valores" impede saber o que é do
--      escritório e o que é do cliente.
--   2. LITISCONSÓRCIO — o valor é rateado por pessoa. A régua é por
--      (processo × cliente); um passo por processo não dá conta.
--   3. COTA DE MENOR — fica depositada em juízo até os 18 e NÃO é valor
--      disponível, mesmo já estando no processo.
--
-- Fecha com "atualizar a planilha de jurimetria": o valor realizado alimenta a
-- curva que projeta os próximos.
--
-- RESULTADO FINAL DO RASCUNHO: 25 fases, 0 vazias, 199 passos.
-- =============================================================================

create or replace function pg_temp.passo(lbl text, descr text, doc text default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', gen_random_uuid()::text, 'label', lbl, 'description', descr,
    'activityType', 'GERENCIAR TRABALHISTA',
    'docChecklist', case when doc is null then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'type', 'documentos', 'label', doc)) end)
$$;

update public.checklist_templates t
set items = (
  select jsonb_agg(x.value order by x.ord) from jsonb_array_elements(t.items) with ordinality x(value, ord)
) || jsonb_build_array(
  pg_temp.passo('Prazo para apresentar Recurso Extraordinário (15 dias úteis)','Art. 1.003, §5º do CPC.'),
  pg_temp.passo('Recurso Extraordinário apresentado','','Petição do RE'),
  pg_temp.passo('Demonstrar repercussão geral','Requisito de admissibilidade — art. 102, §3º da CF. Sem preliminar de repercussão geral o RE não passa.'),
  pg_temp.passo('Intimação para contrarrazões ao RE',''),
  pg_temp.passo('Contrarrazões ao RE apresentadas',''),
  pg_temp.passo('Pendente juízo de admissibilidade do RE','Feito na origem, pelo TST.'),
  pg_temp.passo('Decisão sobre a admissibilidade do RE','','Decisão de admissibilidade'),
  pg_temp.passo('Agravo em RE, se inadmitido (art. 1.042 CPC)','Único caminho quando a presidência barra o RE.'),
  pg_temp.passo('Verificar sobrestamento por tema de repercussão geral','Se o tema estiver afetado, o processo fica parado aguardando o leading case — e isso explica meses sem movimentação.'),
  pg_temp.passo('Processo remetido ao STF',''),
  pg_temp.passo('Decisão do STF proferida','','Acórdão / decisão monocrática')
),
name = 'Recurso Extraordinário — apresentação, admissibilidade e julgamento'
from public.checklist_stage_links l
where l.checklist_template_id = t.id and l.stage_id = 'm_recurso_extraordinario'
  and l.board_id = (select id from kanban_boards where name='Trabalhistas judicial — marcos (rascunho)');

update public.checklist_templates t
set items = jsonb_build_array(
  pg_temp.passo('Valor disponibilizado em conta judicial',''),
  pg_temp.passo('Conferir valor recebido com o cálculo homologado','Diferença vira execução do saldo remanescente.'),
  pg_temp.passo('Identificar a cota de cada cliente','Em litisconsórcio (cônjuge, filhos, pais) o valor é rateado por pessoa — a régua financeira é por processo x cliente, não por processo.'),
  pg_temp.passo('Separar honorário contratual e sucumbencial','São recebíveis distintos, com donos distintos: a cota é do cliente, o honorário é do escritório.'),
  pg_temp.passo('Conferir cota de cliente menor de idade','Fica depositada em juízo até os 18 anos — não entra como valor disponível.'),
  pg_temp.passo('Transferência ao cliente realizada','','Comprovante de transferência'),
  pg_temp.passo('Recibo de quitação assinado pelo cliente','','Recibo de quitação'),
  pg_temp.passo('Prestação de contas ao cliente','','Demonstrativo de prestação de contas'),
  pg_temp.passo('Registrar o recebimento no financeiro',''),
  pg_temp.passo('Atualizar a planilha de jurimetria','Fecha o ciclo: o valor realizado alimenta a curva que projeta os próximos.')
)
from public.checklist_stage_links l
where l.checklist_template_id = t.id and l.stage_id = 'm_pagamento'
  and l.board_id = (select id from kanban_boards where name='Trabalhistas judicial — marcos (rascunho)');

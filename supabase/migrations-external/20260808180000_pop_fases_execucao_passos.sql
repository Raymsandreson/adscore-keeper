-- =============================================================================
-- Passos das fases que o POP não cobria + separação da execução em duas saídas.
-- Aplicado no POP RASCUNHO. O POP em uso segue intacto.
--
-- CONTEXTO: ao promover marco a fase, sete etapas ficaram sem procedimento
-- nenhum — Saneamento, Trânsito, Liquidação, Execução, Alvará, Arquivamento e
-- Suspensão. Não era erro do mapa: o POP atual simplesmente terminava em
-- "Recebimento e Prestação de Contas" e não dizia o que fazer da sentença até o
-- dinheiro entrar. A reconstrução expôs o buraco; o usuário decidiu preencher
-- antes de migrar.
--
-- -----------------------------------------------------------------------------
-- DECISÃO: EXECUÇÃO VIRA DUAS FASES (usuário, 08/08/2026)
-- -----------------------------------------------------------------------------
-- Depois da citação do executado, o processo toma um de dois caminhos que a
-- régua financeira trata de forma OPOSTA:
--
--   Pagamento espontâneo → A_RECEBER    o devedor concordou e vai pagar
--   Constrição / penhora → EM_EXECUCAO  ninguém prometeu nada; está sendo forçado
--
-- Pela régua v4 a diferença é quem falhou: no vencido a promessa foi quebrada,
-- na constrição nunca houve promessa. Manter os dois na mesma fase obrigaria a
-- escolher um único estágio financeiro para situações de risco diferente.
--
-- -----------------------------------------------------------------------------
-- O PASSO QUE PARECE BUROCRACIA E NÃO É
-- -----------------------------------------------------------------------------
-- Em "Alvará expedido": "Conferir se há cota de cliente menor de idade".
-- Crédito de menor fica DEPOSITADO EM JUÍZO até os 18 (art. 1.691 CC) — é
-- garantido e inacessível ao mesmo tempo. Sem esse passo marcado, o valor entra
-- no relatório do fundo como disponível e o número mente. No
-- 0016074-62.2016.5.16.0014 há uma filha nascida em 2011 exatamente nessa
-- situação.
--
-- scope = 'processo': estas etapas são do processo, não do cliente. Os 980
-- templates existentes estão todos como 'cliente' — o CHECK aceita os dois, e
-- aqui 'processo' é o correto (um cliente com dois processos tem duas execuções).
--
-- REVERSÃO: os templates e links caem com o board rascunho (ON DELETE CASCADE
-- nos links; os templates ficam órfãos e podem ser removidos pelo nome).
-- =============================================================================

create or replace function pg_temp.passo(lbl text, descr text, doc text default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', gen_random_uuid()::text,
    'label', lbl,
    'description', descr,
    'activityType', 'GERENCIAR TRABALHISTA',
    'docChecklist', case when doc is null then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'type', 'documentos', 'label', doc)) end
  )
$$;

with novos(nome, stage_id, items) as (values
 ('Saneamento','m_saneamento', jsonb_build_array(
   pg_temp.passo('Pendente decisão de saneamento e organização','Aguardando o juízo sanear o processo e fixar os pontos controvertidos.'),
   pg_temp.passo('Decisão de saneamento proferida','Decisão publicada.','Decisão de saneamento'),
   pg_temp.passo('Prazo para especificação de provas','Acompanhar o prazo aberto às partes.'),
   pg_temp.passo('Provas especificadas pelas partes','Petição de especificação protocolada.'))),

 ('Trânsito em julgado','m_transito_julgado', jsonb_build_array(
   pg_temp.passo('Conferir se há recurso pendente em qualquer instância','Antes de tratar como definitivo, checar 1º grau, TRT, TST e STF.'),
   pg_temp.passo('Pendente certidão de trânsito em julgado','Aguardando a certidão do cartório.'),
   pg_temp.passo('Certidão de trânsito em julgado expedida','','Certidão de trânsito em julgado'),
   pg_temp.passo('Notificar cliente do trânsito','Comunicar que a decisão é definitiva e explicar o próximo passo.'),
   pg_temp.passo('Preencher planilha de jurimetria','Alimenta a base que sustenta os marcos e o fluxo da carteira.'))),

 ('Liquidação','m_liquidacao', jsonb_build_array(
   pg_temp.passo('Pendente início da liquidação','Aguardando abertura da fase de liquidação.'),
   pg_temp.passo('Cálculos de liquidação apresentados','','Planilha de cálculos'),
   pg_temp.passo('Intimação para impugnação aos cálculos',''),
   pg_temp.passo('Prazo para impugnação (8 dias úteis)','Art. 879, §2º da CLT.'),
   pg_temp.passo('Impugnação aos cálculos apresentada',''),
   pg_temp.passo('Cálculos homologados','Valor passa a ser certo e exigível.','Decisão de homologação'))),

 ('Execução iniciada','m_execucao', jsonb_build_array(
   pg_temp.passo('Citação do executado para pagamento (48h)','Art. 880 da CLT.'),
   pg_temp.passo('Pendente manifestação do executado','Define o caminho: pagamento espontâneo ou constrição.'))),

 ('Pagamento espontâneo','m_pagamento_espontaneo', jsonb_build_array(
   pg_temp.passo('Executado efetuou o pagamento no prazo','Sem necessidade de constrição.'),
   pg_temp.passo('Comprovante de depósito juntado','','Comprovante de depósito'),
   pg_temp.passo('Conferir valor depositado com o cálculo homologado','Diferença aqui vira execução do saldo.'))),

 ('Constrição / penhora','m_constricao', jsonb_build_array(
   pg_temp.passo('Bloqueio de valores (SISBAJUD)',''),
   pg_temp.passo('Penhora de bens','Quando não há saldo suficiente em conta.'),
   pg_temp.passo('Prazo para embargos à execução (5 dias)','Art. 884 da CLT.'),
   pg_temp.passo('Embargos à execução apresentados',''),
   pg_temp.passo('Decisão dos embargos','','Decisão'))),

 ('Alvará expedido','m_alvara', jsonb_build_array(
   pg_temp.passo('Pendente expedição de alvará',''),
   pg_temp.passo('Alvará expedido','Requisição saiu; o dinheiro ainda não caiu.','Alvará'),
   pg_temp.passo('Conferir dados bancários do cliente',''),
   pg_temp.passo('Conferir se há cota de cliente menor de idade','Cota de menor fica DEPOSITADA EM JUÍZO até os 18 anos (art. 1.691 CC). Sem marcar aqui, o valor entra no relatório como disponível e o número mente.'),
   pg_temp.passo('Alvará disponibilizado / valor levantado',''))),

 ('Arquivamento definitivo','m_arquivamento', jsonb_build_array(
   pg_temp.passo('Prestação de contas final ao cliente','','Recibo de prestação de contas'),
   pg_temp.passo('Pendente baixa definitiva',''),
   pg_temp.passo('Processo arquivado definitivamente',''),
   pg_temp.passo('Encerrar acompanhamento e monitoramento','Tirar do push e dos monitores.'))),

 ('Suspensão','m_suspensao', jsonb_build_array(
   pg_temp.passo('Registrar motivo da suspensão','IRDR, prejudicial externa, acordo em negociação.'),
   pg_temp.passo('Anotar prazo ou condição para retomada',''),
   pg_temp.passo('Acompanhar o levantamento da suspensão',''),
   pg_temp.passo('Suspensão levantada — retomar a fase anterior','')))
),
ins as (
  insert into public.checklist_templates (name, description, is_mandatory, items, scope)
  select n.nome, 'Passos da fase ' || n.nome || ' — POP Trabalhistas judicial (marcos)', false, n.items, 'processo'
  from novos n
  returning id, name
)
insert into public.checklist_stage_links (board_id, stage_id, checklist_template_id)
select (select id from kanban_boards where name='Trabalhistas judicial — marcos (rascunho)'), n.stage_id, ins.id
from ins join novos n on n.nome = ins.name;

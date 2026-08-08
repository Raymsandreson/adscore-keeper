-- =============================================================================
-- Régua de marcos do POP "Trabalhistas judicial" (board b436c043-…624816).
-- Validada com o usuário em 08/08/2026 sobre as 8 fases do próprio POP.
--
-- ESTÁGIO FINANCEIRO — regra de herança (decisão do usuário, 08/08/2026):
-- marco com estagio_financeiro_sugerido NULL NÃO zera o estágio: o recebível
-- continua no estágio do último marco preenchido. Por isso audiência inicial,
-- saneamento e perícia ficam vazios — são PROJETADO por herança do ajuizamento.
-- Preencher os quatro seria redundante e obrigaria a editar 4 linhas no dia em
-- que o estágio de entrada mudar.
--
-- Os 7 estágios são os da skill whatsjud-fluxo-vocabulario (v4), sem invenção:
-- PROJETADO, CONDENACAO, A_RECEBER, VENCIDO, EM_EXECUCAO, DEPOSITADO_EM_JUIZO,
-- PAGO (+ INDEFERIDO como saída lateral). Notar:
--   trânsito em julgado -> CONDENACAO, não A_RECEBER: valor certo, data ainda não;
--   alvará expedido     -> A_RECEBER, não PAGO: requisição expedida não é dinheiro
--                          na mão, mesma lógica do precatório/RPV.
--
-- AUDIÊNCIA SÓ CONTA SE REALIZADA. Medido na base: 840 movimentações "designada",
-- 338 "cancelada", 526 "realizada". Sem o complemento_pattern a régua marcava
-- audiência pela data em que foi DESIGNADA (e contava até audiência cancelada),
-- o que produzia mediana de 7 dias entre ajuizamento e audiência. Com o filtro,
-- 84 dias — que é o intervalo real.
--
-- PERÍCIA FICA SEM SINAL DE PROPÓSITO: não há código TPU que a identifique com
-- segurança nesta base. O marco existe na régua (aparece como estação prevista),
-- mas nenhuma movimentação o dispara. Inventar um código seria pior que a
-- lacuna visível.
--
-- REVERSÃO: delete from pop_marcos where board_id = 'b436c043-…624816';
-- (os sinais caem junto por ON DELETE CASCADE)
-- =============================================================================

with b as (select 'b436c043-3ddb-4900-8800-dc4063624816'::uuid as id),
m(chave, rotulo, ordem, stage_id, terminal, eventual, estagio) as (values
 ('ajuizamento','Ajuizamento / Distribuição',1,'fase_conhecimento_auto_gen',false,false,'PROJETADO'),
 ('audiencia_inicial','Audiência inicial / conciliação',2,'fase_conhecimento_auto_gen',false,false,null),
 ('saneamento','Saneamento',3,'fase_conhecimento_auto_gen',false,true,null),
 ('pericia','Perícia',4,'fase_conhecimento_auto_gen',false,true,null),
 ('audiencia_instrucao','Audiência de instrução',5,'fase_conhecimento_auto_gen',false,false,null),
 ('sentenca','Sentença (1º grau)',6,'fase_conhecimento_auto_gen',false,false,'CONDENACAO'),
 ('acordo_homologado','Acordo homologado',7,'cumprimento_sentenca_auto_gen',false,true,'A_RECEBER'),
 ('acordao_2grau','Acórdão (2º grau)',8,'recurso_segunda_instancia_auto_gen',false,true,'CONDENACAO'),
 ('embargos_declaracao','Embargos de declaração',9,'recurso_segunda_instancia_auto_gen',false,true,null),
 ('admissibilidade_rr','Admissibilidade do Recurso de Revista',10,'recurso_segunda_instancia_auto_gen',false,true,null),
 ('decisao_superior','Decisão TST / STJ',11,'recurso_instancia_superior_auto_gen',false,true,'CONDENACAO'),
 ('recurso_extraordinario','Recurso Extraordinário (STF)',12,'fase_recursal_(supremo_tribunal_federal)_1783524166776',false,true,null),
 ('transito_julgado','Trânsito em julgado',13,'conclusao_arquivamento_auto_gen',false,false,'CONDENACAO'),
 ('liquidacao_iniciada','Liquidação iniciada',14,'cumprimento_sentenca_auto_gen',false,true,null),
 ('execucao_iniciada','Execução / cumprimento iniciado',15,'cumprimento_sentenca_auto_gen',false,true,'EM_EXECUCAO'),
 ('alvara_expedido','Alvará expedido',16,'cumprimento_sentenca_auto_gen',false,true,'A_RECEBER'),
 ('pagamento','Levantamento / pagamento',17,'cumprimento_sentenca_auto_gen',false,true,'PAGO'),
 ('arquivamento_definitivo','Arquivamento definitivo',18,'conclusao_arquivamento_auto_gen',true,false,null),
 ('suspensao','Suspensão / sobrestamento',19,'suspensao_auto_gen',false,true,null)
)
insert into public.pop_marcos (board_id, chave, rotulo, ordem, stage_id, terminal, eventual, estagio_financeiro_sugerido)
select b.id, m.chave, m.rotulo, m.ordem, m.stage_id, m.terminal, m.eventual, m.estagio
from m cross join b
on conflict (board_id, chave) do nothing;

-- Sinais TPU. confirmado = false: seed por código+nome, ainda não validado
-- processo a processo contra gabarito.
with s(chave, codigo, grau, pattern) as (values
 ('ajuizamento',26,'G1',null),
 ('audiencia_inicial',12747,null,'realizada'),('audiencia_inicial',12740,null,'realizada'),
 ('audiencia_inicial',970,null,'realizada'),
 ('saneamento',12387,'G1',null),
 ('audiencia_instrucao',12749,null,'realizada'),('audiencia_instrucao',12750,null,'realizada'),
 ('audiencia_instrucao',12751,null,'realizada'),('audiencia_instrucao',12743,null,'realizada'),
 ('sentenca',219,'G1',null),('sentenca',220,'G1',null),('sentenca',221,'G1',null),
 ('acordo_homologado',466,null,null),('acordo_homologado',14099,null,null),
 ('acordao_2grau',237,'G2',null),('acordao_2grau',238,'G2',null),('acordao_2grau',239,'G2',null),
 ('acordao_2grau',235,'G2',null),('acordao_2grau',236,'G2',null),('acordao_2grau',230,'G2',null),
 ('embargos_declaracao',198,null,null),('embargos_declaracao',871,null,null),('embargos_declaracao',200,null,null),
 ('admissibilidade_rr',434,'G2',null),('admissibilidade_rr',431,'G2',null),
 ('decisao_superior',237,'SUP',null),('decisao_superior',238,'SUP',null),('decisao_superior',239,'SUP',null),
 ('decisao_superior',235,'SUP',null),('decisao_superior',236,'SUP',null),
 ('recurso_extraordinario',432,null,null),
 ('transito_julgado',848,null,null),
 ('liquidacao_iniciada',11384,null,null),
 ('execucao_iniciada',11385,null,null),
 ('alvara_expedido',60,null,'alvar'),
 ('pagamento',277,null,null),
 ('arquivamento_definitivo',246,null,null),('arquivamento_definitivo',22,null,null),
 ('arquivamento_definitivo',196,null,null),
 ('suspensao',14985,null,null),('suspensao',272,null,null)
)
insert into public.pop_marco_sinais (pop_marco_id, tipo, codigo, grau, complemento_pattern, origem, confirmado, motivo)
select pm.id, 'tpu', s.codigo, s.grau, s.pattern, 'manual', false,
       'seed inicial 08/08/2026 - pendente calibragem contra gabarito'
from s join public.pop_marcos pm
  on pm.chave = s.chave
 and pm.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'::uuid
on conflict do nothing;

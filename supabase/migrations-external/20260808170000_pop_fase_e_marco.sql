-- =============================================================================
-- FASE DO POP = MARCO
--
-- Decisões do usuário (08/08/2026), depois de olhar o POP Trabalhistas por dentro:
--
--   1. "o marco tem que ser uma fase do POP, cada um deles. O POP é feito a
--      partir dos marcos" — a fase deixa de ser agrupador e passa a ser a
--      estação da régua. Os objetivos e passos ficam DENTRO dela.
--   2. "Instrução e Julgamento se parte em três" — Perícia, Audiência de
--      instrução e Sentença viram fases separadas. Um processo parado na perícia
--      e um esperando sentença são situações diferentes, e hoje pareciam iguais.
--   3. "acordo é um estado que atravessa fases, então deveria estar nos
--      resultados" — vira marco com atravessa_fases = true, não vira fase.
--      Acordo acontece antes da audiência, depois do acórdão ou no TST;
--      representá-lo como fase obrigaria a mostrar passo atrás no fluxo.
--   4. Trânsito, execução, alvará e arquivamento entram como fases.
--   5. Todas as fases visíveis sempre (nada de eventual neste POP).
--
-- O QUE JUSTIFICOU: os objetivos que a equipe já usava JÁ ERAM os marcos.
-- "Protocolo e citação" é o ajuizamento; "Julgamento do Recurso" é o acórdão;
-- "Recebimento e Prestação de Contas" é o pagamento. Não se inventou régua —
-- promoveu-se o que já existia.
--
-- POR QUE EM CÓPIA E NÃO NO POP EM USO: o POP Trabalhistas judicial tem 677
-- processos e 7.229 instâncias de checklist ancoradas nos stage_id atuais.
-- Trocar as fases sem remapear apaga o que a equipe já marcou. A cópia deixa
-- conferir a régua inteira antes de qualquer migração — e a migração das
-- instâncias vira passo separado, com backup.
--
-- REVERSÃO: delete from kanban_boards where id = '0bcd8be6-…c47e15';
-- (pop_marcos e pop_marco_sinais caem por ON DELETE CASCADE)
-- =============================================================================

alter table public.pop_marcos
  add column if not exists atravessa_fases boolean not null default false;

comment on column public.pop_marcos.atravessa_fases is
  'true = marco que acontece em qualquer ponto (acordo). E resultado do POP, nao fase.';
comment on column public.pop_marcos.eventual is
  'Marco que so aparece na linha se acontecer. No POP Trabalhistas o usuario pediu TODAS as fases visiveis (08/08/2026); a coluna segue valendo para outros POPs.';

-- ---------------------------------------------------------------------------
-- A cópia com as 23 fases. Cor por bloco: pré-processual, conhecimento,
-- recursal 2º grau, superior, STF, execução/conclusão, suspensão.
-- ---------------------------------------------------------------------------
insert into public.kanban_boards (name, description, board_type, stages, settings, color, icon, display_order)
select
  'Trabalhistas judicial — marcos (rascunho)',
  'Reconstrução do POP com fase = marco. Rascunho para conferência; o POP em uso não foi tocado.',
  'workflow',
  jsonb_build_array(
    jsonb_build_object('id','m_pre_processual','name','Pré-Processual','color','#FFD700'),
    jsonb_build_object('id','m_ajuizamento','name','Ajuizamento','color','#3B82F6'),
    jsonb_build_object('id','m_audiencia_inicial','name','Audiência inicial','color','#3B82F6'),
    jsonb_build_object('id','m_saneamento','name','Saneamento','color','#3B82F6'),
    jsonb_build_object('id','m_pericia','name','Perícia','color','#3B82F6'),
    jsonb_build_object('id','m_audiencia_instrucao','name','Audiência de instrução','color','#3B82F6'),
    jsonb_build_object('id','m_sentenca','name','Sentença','color','#3B82F6'),
    jsonb_build_object('id','m_embargos_1grau','name','Embargos de declaração (1º grau)','color','#3B82F6'),
    jsonb_build_object('id','m_remessa_2grau','name','Remessa ao 2º grau','color','#8B5CF6'),
    jsonb_build_object('id','m_acordao_2grau','name','Acórdão (2º grau)','color','#8B5CF6'),
    jsonb_build_object('id','m_embargos_2grau','name','Embargos de declaração (2º grau)','color','#8B5CF6'),
    jsonb_build_object('id','m_admissibilidade_rr','name','Admissibilidade do RR','color','#8B5CF6'),
    jsonb_build_object('id','m_agravo_instrumento','name','Agravo de instrumento em RR','color','#EC4899'),
    jsonb_build_object('id','m_decisao_superior','name','Decisão TST / STJ','color','#EC4899'),
    jsonb_build_object('id','m_agravo_interno','name','Agravo interno','color','#EC4899'),
    jsonb_build_object('id','m_recurso_extraordinario','name','Recurso Extraordinário (STF)','color','#EF4444'),
    jsonb_build_object('id','m_transito_julgado','name','Trânsito em julgado','color','#10B981'),
    jsonb_build_object('id','m_liquidacao','name','Liquidação','color','#10B981'),
    jsonb_build_object('id','m_execucao','name','Execução iniciada','color','#10B981'),
    jsonb_build_object('id','m_alvara','name','Alvará expedido','color','#10B981'),
    jsonb_build_object('id','m_pagamento','name','Levantamento / pagamento','color','#10B981'),
    jsonb_build_object('id','m_arquivamento','name','Arquivamento definitivo','color','#10B981'),
    jsonb_build_object('id','m_suspensao','name','Suspensão','color','#6B7280')
  ),
  b.settings, b.color, b.icon, 999
from public.kanban_boards b
where b.id = 'b436c043-3ddb-4900-8800-dc4063624816'
  and not exists (
    select 1 from public.kanban_boards x
     where x.name = 'Trabalhistas judicial — marcos (rascunho)'
  );

-- Os marcos: um por fase, mais o acordo que atravessa.
-- Estágio financeiro segue a régua v4 (skill whatsjud-fluxo-vocabulario):
--   trânsito = CONDENACAO (valor certo, data ainda não)
--   alvará   = A_RECEBER (requisição expedida não é dinheiro na mão)
-- Vazio HERDA do marco anterior preenchido — decisão do usuário.
with b as (select id from public.kanban_boards where name = 'Trabalhistas judicial — marcos (rascunho)' limit 1),
m(chave, rotulo, ordem, stage_id, terminal, atravessa, estagio) as (values
 ('pre_processual','Pré-Processual',1,'m_pre_processual',false,false,null),
 ('ajuizamento','Ajuizamento',2,'m_ajuizamento',false,false,'PROJETADO'),
 ('audiencia_inicial','Audiência inicial',3,'m_audiencia_inicial',false,false,null),
 ('saneamento','Saneamento',4,'m_saneamento',false,false,null),
 ('pericia','Perícia',5,'m_pericia',false,false,null),
 ('audiencia_instrucao','Audiência de instrução',6,'m_audiencia_instrucao',false,false,null),
 ('sentenca','Sentença',7,'m_sentenca',false,false,'CONDENACAO'),
 ('embargos_1grau','Embargos de declaração (1º grau)',8,'m_embargos_1grau',false,false,null),
 ('remessa_2grau','Remessa ao 2º grau',9,'m_remessa_2grau',false,false,null),
 ('acordao_2grau','Acórdão (2º grau)',10,'m_acordao_2grau',false,false,'CONDENACAO'),
 ('embargos_2grau','Embargos de declaração (2º grau)',11,'m_embargos_2grau',false,false,null),
 ('admissibilidade_rr','Admissibilidade do RR',12,'m_admissibilidade_rr',false,false,null),
 ('agravo_instrumento','Agravo de instrumento em RR',13,'m_agravo_instrumento',false,false,null),
 ('decisao_superior','Decisão TST / STJ',14,'m_decisao_superior',false,false,'CONDENACAO'),
 ('agravo_interno','Agravo interno',15,'m_agravo_interno',false,false,null),
 ('recurso_extraordinario','Recurso Extraordinário (STF)',16,'m_recurso_extraordinario',false,false,null),
 ('transito_julgado','Trânsito em julgado',17,'m_transito_julgado',false,false,'CONDENACAO'),
 ('liquidacao','Liquidação',18,'m_liquidacao',false,false,null),
 ('execucao_iniciada','Execução iniciada',19,'m_execucao',false,false,'EM_EXECUCAO'),
 ('alvara_expedido','Alvará expedido',20,'m_alvara',false,false,'A_RECEBER'),
 ('pagamento','Levantamento / pagamento',21,'m_pagamento',false,false,'PAGO'),
 ('arquivamento_definitivo','Arquivamento definitivo',22,'m_arquivamento',true,false,null),
 ('suspensao','Suspensão',23,'m_suspensao',false,false,null),
 ('acordo_homologado','Acordo homologado',24,null,false,true,'A_RECEBER')
)
insert into public.pop_marcos (board_id, chave, rotulo, ordem, stage_id, terminal, eventual, atravessa_fases, estagio_financeiro_sugerido)
select b.id, m.chave, m.rotulo, m.ordem, m.stage_id, m.terminal, false, m.atravessa, m.estagio
from m cross join b
on conflict (board_id, chave) do nothing;

-- ATENÇÃO ao copiar sinais entre POPs: `codigo not in (...)` DESCARTA as linhas
-- de sinal documental, porque nelas codigo é NULL e NULL not in (...) é NULL,
-- não true. Foi assim que os 4 sinais de documento sumiram na primeira carga —
-- por isso o filtro aqui é explícito por tipo.

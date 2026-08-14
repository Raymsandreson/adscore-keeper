-- =============================================================================
-- MARCOS DOS PROCESSOS VIA ESCAVADOR — para TODA a carteira judicial, não só
-- o POP trabalhista.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- O QUE MOTIVOU (14/08/2026): 285 dos 681 processos com CNJ estão sem marco
-- NENHUM em process_pop_marcos — e 217 deles TÊM movimentação do Escavador já
-- baixada em lead_processes.movimentacoes. Não falta dado; falta leitor:
--
--   POP do processo                                  sem marco   com movimentação
--   Trabalhistas judicial — marcos (em uso) ........      94            66
--   POP - BPC - Administrativo .....................      93            87
--   BPC JUDICIAL ...................................      25            16
--   Justiça Comum ..................................      18            15
--   (sem POP vinculado) ............................      16            10
--   Salário Maternidade Urbano .....................      10             9
--   Auxílio Doença / Acidente / Pensão / Seguro ....      16            14
--   Inquérito Policial + Relatório SRTE ............      13             0
--
-- A régua (refresh_process_pop_marcos) só materializa marco para processo cujo
-- POP tenha pop_marcos cadastrados — e só o board trabalhista tem. Os POPs
-- previdenciários e cíveis têm ZERO marcos: 175 processos judiciais invisíveis
-- para a régua com a movimentação parada no banco.
--
-- Os 66 trabalhistas sem marco são outro fenômeno: a janela de 20 movimentações
-- só tem expediente (Conclusão, DJE, Certidão, Decurso de Prazo — medido nesta
-- data, zero "Distribuição" entre eles). O marco de verdade já saiu da janela.
-- Para esses, o ajuizamento passa a poder vir do CAMPO do processo
-- (data_distribuicao / data_inicio, que o Escavador preenche na capa) — fonte
-- 'campo_processo', a decisão pendente nº 3 de docs/sistema/marcos-processuais-
-- regras.md. Só 31 dos 285 têm o campo hoje, mas ele chega de graça em toda
-- consulta futura ao Escavador.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Cria a régua PREVIDENCIÁRIA JUDICIAL (14 fases + 2 estados) nos 6 POPs
--      de benefício: BPC JUDICIAL, POP - BPC - Administrativo, Salário
--      Maternidade Urbano, Auxílio Doença Acidentário, Auxílio Acidente
--      (board judicial), Pensão por Morte. Sem audiência de conciliação —
--      rito previdenciário não a tem (regra de marcos por rito, 13/07/2026).
--   2. Cria a régua CÍVEL (15 fases + 2 estados) em Justiça Comum e
--      Requerimento de Seguro — com audiência de conciliação (art. 334 CPC).
--   3. Copia os SINAIS (tpu, texto, grau, documento) do board trabalhista em
--      uso (0bcd8be6) para os marcos de mesma chave nos boards novos. As
--      chaves são as mesmas de propósito: o sinal "Distribuição → ajuizamento"
--      vale igual no TRT, no JEF e na vara cível. Chaves exclusivas do
--      trabalhista (admissibilidade_rr, agravo…) não existem nas réguas novas
--      e ficam de fora sozinhas pelo join.
--   4. Recria vw_pop_marcos_regua com a QUARTA fonte: 'campo_processo' —
--      ajuizamento pela menor entre data_distribuicao e data_inicio da capa.
--      Prioridade 3: só vale quando nenhuma fonte de movimentação detectou o
--      ajuizamento. Fonte de capa nunca sobrepõe fonte de movimento.
--
-- O QUE NÃO TOCA (de propósito):
--   - O board trabalhista em uso e o rascunho: nenhuma linha deles muda.
--   - vw_pop_marcos_detectados (v1) e vw_pop_carteira_por_fase: intactas.
--   - Inquérito Policial e Relatório SRTE: ritos sem régua definida (pendência
--     nº 5 do doc de regras) e 0 processos com movimentação — nada a ler.
--   - Os 16 processos sem POP vinculado: régua exige workflow_id; vincular o
--     POP é gesto do usuário, não desta migration.
--   - Nenhum passo de checklist, nenhuma fase manual é rebaixada
--     (aplicar_fase_por_marco só avança — inalterado).
--
-- ESTADO vs FASE (checklist da skill marcos-pop-e-captura): acordo_homologado
-- e suspensao nascem com atravessa_fases = TRUE nas réguas novas. Foi o erro
-- dos 61 processos de julho e dos 9 do primeiro tick — não repetir.
--
-- CUSTO: zero chamada de API. Tudo aqui lê movimentação JÁ baixada. A consulta
-- dos 67 processos nunca consultados (67 × R$ 0,20 = R$ 13,40) é ação separada
-- e pendente de OK do usuário — não está nesta migration.
--
-- REVERSÃO (testada em conceito, <5 min):
--   delete from public.pop_marco_sinais
--    where pop_marco_id in (select id from public.pop_marcos where board_id in (
--      'cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded','8377ee1b-97a2-4777-9b51-3af9e630b3c6',
--      'd5276364-f7a9-4c9f-a04b-8c634628ca98','113305f3-38a1-41b1-ba1e-f55ac8391957',
--      'b922f490-3600-4652-a629-5d63110501ca','41e44a5a-e2e7-42eb-b67b-8492ee46f09c',
--      '91778d9c-d60e-461a-a763-839410166f00','26a46944-abb8-4807-9a9e-0c7ed75cf881'));
--   delete from public.pop_marcos where board_id in (…mesma lista…);
--   -- e recriar vw_pop_marcos_regua com a definição de 20260812190000 (sem o
--   -- ramo campo_processo). Depois: select public.refresh_process_pop_marcos();
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. As réguas novas
--
-- Template único com flag de rito. Chaves idênticas às do board trabalhista —
-- é isso que permite copiar os sinais por chave no passo 3.
--
-- eventual = true para o que nem todo processo tem (perícia, embargos, cada
-- degrau recursal, execução): entra no denominador do percentual só quando
-- acontece — mesma lógica das 12 estações de src/lib/processStations.ts.
-- Obrigatórios: ajuizamento, sentença, trânsito, pagamento, arquivamento
-- (+ audiência de conciliação no cível, art. 334 CPC).
-- ---------------------------------------------------------------------------
with boards(board_id, rito) as (
  values
    ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'prev'),  -- BPC JUDICIAL
    ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'prev'),  -- POP - BPC - Administrativo (93 CNJ judicializados)
    ('d5276364-f7a9-4c9f-a04b-8c634628ca98'::uuid, 'prev'),  -- Salário Maternidade Urbano
    ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'prev'),  -- Fluxo Auxílio Doença Acidentário
    ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'prev'),  -- Auxílio Acidente (board judicial FASE 1-6)
    ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'prev'),  -- Fluxo de Pensão por Morte
    ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'civel'), -- Justiça Comum
    ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'civel')  -- Requerimento de Seguro
),
template(chave, rotulo, ordem_prev, ordem_civel, eventual, terminal, atravessa, descricao) as (
  values
    ('ajuizamento',             'Ajuizamento',                    1,  1, false, false, false, 'Distribuição da ação. Vem da movimentação ou da capa do processo (campo_processo).'),
    ('audiencia_inicial',       'Audiência de conciliação',    null,  2, false, false, false, 'Art. 334 CPC. Só realizada conta — designação não é marco.'),
    ('pericia',                 'Perícia',                        2,  3, true,  false, false, 'Laudo juntado. No previdenciário é o coração da instrução.'),
    ('audiencia_instrucao',     'Audiência de instrução',         3,  4, true,  false, false, 'Só realizada conta.'),
    ('sentenca',                'Sentença',                       4,  5, false, false, false, null),
    ('embargos_1grau',          'Embargos de declaração (1º grau)', 5, 6, true, false, false, null),
    ('remessa_2grau',           'Remessa ao 2º grau',             6,  7, true,  false, false, 'A chegada na instância recursal, não o julgamento.'),
    ('acordao_2grau',           'Acórdão (2º grau)',              7,  8, true,  false, false, 'TRF / Turma Recursal / TJ.'),
    ('remessa_superior',        'Remessa à instância superior',   8,  9, true,  false, false, null),
    ('decisao_superior',        'Decisão superior (STJ/TNU/STF)', 9, 10, true,  false, false, null),
    ('transito_julgado',        'Trânsito em julgado',           10, 11, false, false, false, null),
    ('execucao_iniciada',       'Execução / cumprimento',        11, 12, true,  false, false, 'No previdenciário, em regra via RPV.'),
    ('alvara_expedido',         'Alvará expedido',               12, 13, true,  false, false, null),
    ('pagamento',               'Levantamento / pagamento',      13, 14, false, false, false, null),
    ('arquivamento_definitivo', 'Arquivamento definitivo',       14, 15, false, true,  false, null),
    ('acordo_homologado',       'Acordo homologado',             20, 20, false, false, true,  'ESTADO, não fase: atravessa_fases evita o sequestro da fase atual (erro de jul/2026).'),
    ('suspensao',               'Suspensão',                     21, 21, false, false, true,  'ESTADO, não fase.')
)
insert into public.pop_marcos
  (board_id, chave, rotulo, ordem, eventual, terminal, atravessa_fases, descricao)
select b.board_id, t.chave, t.rotulo,
       case b.rito when 'prev' then t.ordem_prev else t.ordem_civel end,
       t.eventual, t.terminal, t.atravessa, t.descricao
from boards b
join template t
  on (b.rito = 'prev'  and t.ordem_prev  is not null)
  or (b.rito = 'civel' and t.ordem_civel is not null)
on conflict (board_id, chave) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Marco → fase de cada board (só onde o mapeamento é inequívoco)
--
-- Boards com fase judicial própria ganham o stage_id; Salário Maternidade é
-- 100% administrativo e fica com stage_id null — a régua aparece na ficha e o
-- percentual anda, mas a fase do POP não é movida por marco. aplicar_fase_por_
-- marco ignora marco sem stage_id, e "só avança" continua valendo.
-- ---------------------------------------------------------------------------
update public.pop_marcos pm
   set stage_id = m.stage_id
from (
  values
  -- BPC JUDICIAL (cbaa0dfb): FASE 2 Distribuição · FASE 3 Instrução · FASE 5 Sentença/Recursos/Execução · FASE 6 Pós-Decisão
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'ajuizamento',             'stage_dist_mon'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'pericia',                 'stage_instrucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'audiencia_instrucao',     'stage_instrucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'sentenca',                'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'embargos_1grau',          'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'remessa_2grau',           'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'acordao_2grau',           'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'remessa_superior',        'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'decisao_superior',        'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'transito_julgado',        'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'execucao_iniciada',       'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'alvara_expedido',         'stage_sentenca_execucao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'pagamento',               'stage_pos_decisao'),
  ('cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded'::uuid, 'arquivamento_definitivo', 'stage_pos_decisao'),
  -- POP - BPC - Administrativo (8377ee1b): 4. Fase Judicial · 5. Concessão/Financeiro/Pós-Deferimento
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'ajuizamento',             'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'pericia',                 'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'audiencia_instrucao',     'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'sentenca',                'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'embargos_1grau',          'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'remessa_2grau',           'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'acordao_2grau',           'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'remessa_superior',        'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'decisao_superior',        'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'transito_julgado',        'stage_fase_judicial'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'execucao_iniciada',       'stage_pos_deferimento'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'alvara_expedido',         'stage_pos_deferimento'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'pagamento',               'stage_pos_deferimento'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6'::uuid, 'arquivamento_definitivo', 'stage_pos_deferimento'),
  -- Auxílio Doença (113305f3): Ação Judicial · Pós-Decisão/Encerramento
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'ajuizamento',             'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'pericia',                 'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'audiencia_instrucao',     'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'sentenca',                'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'embargos_1grau',          'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'remessa_2grau',           'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'acordao_2grau',           'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'remessa_superior',        'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'decisao_superior',        'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'transito_julgado',        'ação_judicial_1774296978899_j94k'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'execucao_iniciada',       'pós-decisão_/_encerramento_1774296978899_276v'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'alvara_expedido',         'pós-decisão_/_encerramento_1774296978899_276v'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'pagamento',               'pós-decisão_/_encerramento_1774296978899_276v'),
  ('113305f3-38a1-41b1-ba1e-f55ac8391957'::uuid, 'arquivamento_definitivo', 'pós-decisão_/_encerramento_1774296978899_276v'),
  -- Auxílio Acidente judicial (b922f490): FASE 2 Citação · FASE 3 Instrução · FASE 5 Sentença/Recursos/Execução · FASE 6 Pós
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'ajuizamento',             'fase_2_citacao_defesa'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'pericia',                 'fase_3_instrucao_probatoria'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'audiencia_instrucao',     'fase_3_instrucao_probatoria'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'sentenca',                'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'embargos_1grau',          'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'remessa_2grau',           'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'acordao_2grau',           'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'remessa_superior',        'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'decisao_superior',        'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'transito_julgado',        'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'execucao_iniciada',       'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'alvara_expedido',         'fase_5_sentenca_recursos_execucao'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'pagamento',               'fase_6_pos_decisao_encerramento'),
  ('b922f490-3600-4652-a629-5d63110501ca'::uuid, 'arquivamento_definitivo', 'fase_6_pos_decisao_encerramento'),
  -- Pensão por Morte (41e44a5a): Fase Judicial · Conclusão e Execução
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'ajuizamento',             'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'pericia',                 'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'audiencia_instrucao',     'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'sentenca',                'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'embargos_1grau',          'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'remessa_2grau',           'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'acordao_2grau',           'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'remessa_superior',        'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'decisao_superior',        'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'transito_julgado',        'fase_judicial_1783621610617_kcs4'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'execucao_iniciada',       'conclusão_e_execução_1783621610617_wwah'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'alvara_expedido',         'conclusão_e_execução_1783621610617_wwah'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'pagamento',               'conclusão_e_execução_1783621610617_wwah'),
  ('41e44a5a-e2e7-42eb-b67b-8492ee46f09c'::uuid, 'arquivamento_definitivo', 'conclusão_e_execução_1783621610617_wwah'),
  -- Justiça Comum (91778d9c): Processo Judicial · Execução/Pós-Sentença · Encerrado
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'ajuizamento',             'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'audiencia_inicial',       'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'pericia',                 'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'audiencia_instrucao',     'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'sentenca',                'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'embargos_1grau',          'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'remessa_2grau',           'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'acordao_2grau',           'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'remessa_superior',        'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'decisao_superior',        'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'transito_julgado',        'processo_judicial_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'execucao_iniciada',       'execucao_pos_sentenca_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'alvara_expedido',         'execucao_pos_sentenca_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'pagamento',               'execucao_pos_sentenca_jc'),
  ('91778d9c-d60e-461a-a763-839410166f00'::uuid, 'arquivamento_definitivo', 'encerrado_jc'),
  -- Requerimento de Seguro (26a46944): Processo Judicial (Pós-Negativa) · Execução e Encerramento
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'ajuizamento',             'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'audiencia_inicial',       'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'pericia',                 'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'audiencia_instrucao',     'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'sentenca',                'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'embargos_1grau',          'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'remessa_2grau',           'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'acordao_2grau',           'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'remessa_superior',        'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'decisao_superior',        'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'transito_julgado',        'processo_judicial_(pós-negativa)_1774442412603_owyh'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'execucao_iniciada',       'execução_e_encerramento_1774442412603_u7pr'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'alvara_expedido',         'execução_e_encerramento_1774442412603_u7pr'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'pagamento',               'execução_e_encerramento_1774442412603_u7pr'),
  ('26a46944-abb8-4807-9a9e-0c7ed75cf881'::uuid, 'arquivamento_definitivo', 'execução_e_encerramento_1774442412603_u7pr')
) as m(board_id, chave, stage_id)
where pm.board_id = m.board_id and pm.chave = m.chave
  and pm.stage_id is null;

-- ---------------------------------------------------------------------------
-- 3. Sinais: copiar do board trabalhista em uso, por chave
--
-- tpu, texto, grau e documento. O guard "marco ainda sem sinal" torna o passo
-- idempotente. Chaves que só existem no trabalhista ficam de fora pelo join.
-- ---------------------------------------------------------------------------
insert into public.pop_marco_sinais
  (pop_marco_id, tipo, codigo, grau, complemento_pattern, padrao, padrao_excluir, origem, confirmado, motivo)
select novo.id, s.tipo, s.codigo, s.grau, s.complemento_pattern, s.padrao, s.padrao_excluir,
       'manual', s.confirmado,
       coalesce(s.motivo, '') || ' [copiado do board trabalhista em uso em 14/08/2026]'
from public.pop_marcos ref
join public.pop_marco_sinais s on s.pop_marco_id = ref.id
join public.pop_marcos novo
  on novo.chave = ref.chave
 and novo.board_id in (
   'cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded','8377ee1b-97a2-4777-9b51-3af9e630b3c6',
   'd5276364-f7a9-4c9f-a04b-8c634628ca98','113305f3-38a1-41b1-ba1e-f55ac8391957',
   'b922f490-3600-4652-a629-5d63110501ca','41e44a5a-e2e7-42eb-b67b-8492ee46f09c',
   '91778d9c-d60e-461a-a763-839410166f00','26a46944-abb8-4807-9a9e-0c7ed75cf881')
where ref.board_id = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'
  and not exists (select 1 from public.pop_marco_sinais x where x.pop_marco_id = novo.id);

-- ---------------------------------------------------------------------------
-- 4. A quarta fonte: ajuizamento pela capa do processo ('campo_processo')
--
-- data_distribuicao/data_inicio vêm preenchidos pelo Escavador na capa. A
-- movimentação de distribuição some da janela de 20 nos processos antigos —
-- nesta data, 66 trabalhistas com movimentação só têm expediente na janela e
-- ficam sem marco nenhum. A capa não envelhece.
--
-- Prioridade 3: qualquer fonte de MOVIMENTAÇÃO que detecte o ajuizamento
-- vence a capa (distinct on ordena por prioridade). Guard de formato ISO no
-- campo texto: valor fora de AAAA-MM-DD é ignorado, não quebra a view.
-- ---------------------------------------------------------------------------
create or replace view public.vw_pop_marcos_regua as
with capa as (
  select pm.board_id, pm.chave as marco_chave, pm.ordem, pm.rotulo, pm.stage_id,
         regexp_replace(coalesce(p.process_number,''), '[^0-9]', '', 'g') as cnj_num,
         least(
           case when nullif(p.data_distribuicao,'') ~ '^\d{4}-\d{2}-\d{2}'
                then substring(p.data_distribuicao, 1, 10)::date end,
           case when nullif(p.data_inicio::text,'') ~ '^\d{4}-\d{2}-\d{2}'
                then substring(p.data_inicio::text, 1, 10)::date end
         ) as data_detectada
  from public.lead_processes p
  join public.pop_marcos pm
    on pm.board_id = p.workflow_id::uuid and pm.chave = 'ajuizamento'
  where p.deleted_at is null
    and length(regexp_replace(coalesce(p.process_number,''), '[^0-9]', '', 'g')) >= 15
),
todas as (
  select d.board_id, d.marco_chave, d.ordem, d.rotulo, d.stage_id,
         regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
         d.data_detectada, d.fonte_deteccao, d.tem_prova_documental, 1 as prioridade
  from public.vw_pop_marcos_detectados d
  where d.data_detectada is not null
  union all
  select e.board_id, e.marco_chave, e.ordem, e.rotulo, e.stage_id,
         e.cnj_num, e.data_detectada, e.fonte_deteccao, false, 2
  from public.vw_pop_marcos_escavador e
  union all
  select c.board_id, c.marco_chave, c.ordem, c.rotulo, c.stage_id,
         c.cnj_num, c.data_detectada, 'campo_processo', false, 3
  from capa c
  where c.data_detectada is not null
)
select distinct on (board_id, cnj_num, marco_chave)
       board_id, cnj_num, marco_chave, ordem, rotulo, stage_id,
       data_detectada, fonte_deteccao, tem_prova_documental
from todas
order by board_id, cnj_num, marco_chave, prioridade, data_detectada;

comment on view public.vw_pop_marcos_regua is
  'Uniao das quatro fontes de marco: DataJud (TPU), documento, Escavador (texto/grau) e capa do processo (campo_processo, so ajuizamento). Movimentacao vence capa. E a fonte da regua da ficha do processo.';

-- ---------------------------------------------------------------------------
-- 5. Materializar agora (o cron pop-marcos-tick repetiria em ate 30 min)
-- ---------------------------------------------------------------------------
select public.refresh_process_pop_marcos();
select count(*) as fases_movidas from public.aplicar_fase_por_marco();

-- =============================================================================
-- "Não existem mais fases, só marcos" — objetivos e passos moram no marco
--
-- Decisão do usuário (02/09/2026). O que muda de estrutura:
--
-- TRABALHISTA (0bcd8be6): as 24 fases já eram 1:1 com os marcos (`m_<chave>`).
--   Saem do catálogo `pericia` (o usuário não quis na régua de 24), `remessa_stf`
--   e `decisao_stf` (0 detecções, 0 sinais; o marco "Recurso Extraordinário
--   (STF)" fica como a única parada do STF). Resultado: 24 marcos posicionais =
--   24 stages. A régua deste POP passa a ser "marco N de 24".
--
-- BPC (8377ee1b): tinha 5 fases e 31 marcos, 6 marcos sem fase. Passa a ter
--   UM stage por marco posicional (`m_<chave>`, nome = rótulo do marco).
--   Entram dois marcos que só existiam como fase, sem detecção: `triagem` e
--   `saneamento_cadunico` (ordem 1 e 2; os demais deslocam +2 — a unique de
--   ordem é DEFERRABLE, então o deslocamento e a inserção fecham juntos). Os 21
--   objetivos das 5 fases são REDISTRIBUÍDOS pelo marco que o trâmite pede
--   (tabela zz_bpc_mapa_objetivos_20260902, mantida como registro). Instância
--   de checklist já marcada acompanha o objetivo — é UPDATE do stage_id, não
--   recriação: passo marcado continua marcado, com autoria.
--
-- Fora deste arquivo (vem na sequência): objetivos e passos para os marcos que
-- ficaram sem nenhum (20260902170000).
--
-- Backups (padrão zz_*_bkp_<data>, RLS ligada, sem policy):
--   zz_pop_marcos_bkp_20260902, zz_checklist_stage_links_bkp_20260902,
--   zz_lead_checklist_instances_stage_bkp_20260902 (id + stage_id),
--   zz_kanban_boards_stages_bkp_20260902 (id + stages),
--   zz_lead_processes_stage_bkp_20260902 (id + workflow_stage_id).
-- Rollback: restaurar as cinco a partir dos backups e
--   `select refresh_process_pop_marcos(); select aplicar_fase_por_marco();`.
-- =============================================================================

-- 0. Fotos
create table if not exists public.zz_pop_marcos_bkp_20260902 as select * from public.pop_marcos;
create table if not exists public.zz_checklist_stage_links_bkp_20260902 as select * from public.checklist_stage_links;
create table if not exists public.zz_lead_checklist_instances_stage_bkp_20260902 as
  select id, board_id, stage_id, checklist_template_id from public.lead_checklist_instances;
create table if not exists public.zz_kanban_boards_stages_bkp_20260902 as select id, stages from public.kanban_boards;
create table if not exists public.zz_lead_processes_stage_bkp_20260902 as
  select id, workflow_id, workflow_stage_id from public.lead_processes;
alter table public.zz_pop_marcos_bkp_20260902 enable row level security;
alter table public.zz_checklist_stage_links_bkp_20260902 enable row level security;
alter table public.zz_lead_checklist_instances_stage_bkp_20260902 enable row level security;
alter table public.zz_kanban_boards_stages_bkp_20260902 enable row level security;
alter table public.zz_lead_processes_stage_bkp_20260902 enable row level security;

-- 1. Trabalhista: 27 posicionais viram 24.
delete from public.pop_marcos
 where board_id = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'
   and chave in ('pericia', 'remessa_stf', 'decisao_stf');

-- 2. BPC: dois marcos novos na frente, os demais posicionais deslocam +2.
update public.pop_marcos set ordem = ordem + 2
 where board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6' and not atravessa_fases;

insert into public.pop_marcos (board_id, chave, rotulo, ordem, descricao, stage_id, terminal, eventual, atravessa_fases)
values
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'triagem', 'Atendimento e triagem', 1,
   'Primeiro contato, análise de requisitos do BPC e documentação preliminar. Marco de trabalho interno: não tem detecção automática.',
   'm_triagem', false, false, false),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'saneamento_cadunico', 'Saneamento do CadÚnico e CNIS', 2,
   'CadÚnico atualizado, CNIS conferido e encaminhamento ao CRAS antes do protocolo. Marco de trabalho interno: não tem detecção automática.',
   'm_saneamento_cadunico', false, false, false)
on conflict (board_id, chave) do nothing;

-- Todo marco posicional do BPC ganha o seu stage `m_<chave>`.
update public.pop_marcos set stage_id = 'm_' || chave
 where board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6' and not atravessa_fases;

-- 3. BPC: stages do board = marcos posicionais, na ordem da régua.
update public.kanban_boards b
   set stages = (
     select jsonb_agg(jsonb_build_object('id', x.sid, 'name', x.nome, 'color', x.cor) order by x.ordem)
     from (
       select 'm_' || m.chave as sid, m.rotulo as nome, m.ordem,
              (array['#03A9F4','#FF9800','#9C27B0','#E91E63','#4CAF50','#3F51B5','#009688','#795548'])
                [(1 + ((row_number() over (order by m.ordem)) - 1) % 8)::int] as cor
       from public.pop_marcos m
       where m.board_id = b.id and not m.atravessa_fases
     ) x
   )
 where b.id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6';

-- 4. BPC: cada objetivo vai para o marco que o trâmite pede.
create table if not exists public.zz_bpc_mapa_objetivos_20260902 (stage_antigo text, objetivo text, stage_novo text);
alter table public.zz_bpc_mapa_objetivos_20260902 enable row level security;
insert into public.zz_bpc_mapa_objetivos_20260902 values
  ('stage_fase1_triagem',       'Análise Inicial e Documentação Preliminar',        'm_triagem'),
  ('stage_saneamento_cadunico', 'Saneamento do CadÚnico, CNIS e Preparo para o CRAS','m_saneamento_cadunico'),
  ('stage_fase_administrativa', 'Protocolo Administrativo no INSS',                 'm_requerimento_protocolado'),
  ('stage_fase_judicial',       'Viabilidade e Saneamento',                          'm_indeferimento_administrativo'),
  ('stage_fase_judicial',       'Análise Preliminar e Parecer de Viabilidade',       'm_indeferimento_administrativo'),
  ('stage_fase_judicial',       'Coleta Inicial de Documentos',                      'm_indeferimento_administrativo'),
  ('stage_fase_judicial',       'Obtenção de Assinaturas',                           'm_indeferimento_administrativo'),
  ('stage_fase_judicial',       'Elaboração e Propositura',                          'm_indeferimento_administrativo'),
  ('stage_fase_judicial',       'Elaboração da Petição Inicial',                     'm_indeferimento_administrativo'),
  ('stage_fase_judicial',       'Ação Judicial de BPC',                              'm_ajuizamento'),
  ('stage_fase_judicial',       'Protocolo Judicial da Ação',                        'm_ajuizamento'),
  ('stage_fase_judicial',       'Acompanhamento Inicial do Processo',                'm_ajuizamento'),
  ('stage_fase_judicial',       'Monitoramento e Tutela',                            'm_ajuizamento'),
  ('stage_fase_judicial',       'Perícia Médica Judicial',                           'm_pericia'),
  ('stage_fase_judicial',       'Perícia Social (Estudo Social)',                    'm_pericia_social'),
  ('stage_fase_judicial',       'Contestação e réplica',                             'm_contestacao'),
  ('stage_fase_judicial',       'Sentença',                                          'm_sentenca'),
  ('stage_fase_judicial',       'Fase Recursal',                                     'm_remessa_2grau'),
  ('stage_fase_judicial',       'Cumprimento de Sentença',                           'm_execucao_iniciada'),
  ('stage_pos_deferimento',     'Acompanhamento de Pagamento e Quitação',            'm_pagamento'),
  ('stage_pos_deferimento',     'Prestação de Contas e Manutenção',                  'm_arquivamento_definitivo');

-- 4a. links (o vínculo objetivo→marco)
update public.checklist_stage_links l
   set stage_id = mp.stage_novo, display_order = 0
  from public.checklist_templates ct, public.zz_bpc_mapa_objetivos_20260902 mp
 where l.board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6'
   and ct.id = l.checklist_template_id
   and mp.stage_antigo = l.stage_id and mp.objetivo = ct.name;

-- 4b. instâncias já criadas (passo marcado acompanha o objetivo)
update public.lead_checklist_instances i
   set stage_id = mp.stage_novo
  from public.checklist_templates ct, public.zz_bpc_mapa_objetivos_20260902 mp
 where i.board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6'
   and ct.id = i.checklist_template_id
   and mp.stage_antigo = i.stage_id and mp.objetivo = ct.name;

-- 4c. fase gravada no processo: piso do marco da fase antiga; a régua avança
--     quem tem marco detectado (aplicar_fase_por_marco só anda para frente).
update public.lead_processes p
   set workflow_stage_id = case p.workflow_stage_id
         when 'stage_fase1_triagem'       then 'm_triagem'
         when 'stage_saneamento_cadunico' then 'm_saneamento_cadunico'
         when 'stage_fase_administrativa' then 'm_requerimento_protocolado'
         when 'stage_fase_judicial'       then 'm_indeferimento_administrativo'
         when 'stage_pos_deferimento'     then 'm_implantacao_beneficio'
       end
 where p.workflow_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6'
   and p.workflow_stage_id in ('stage_fase1_triagem','stage_saneamento_cadunico','stage_fase_administrativa','stage_fase_judicial','stage_pos_deferimento');

-- 5. Rematerializa e move fases.
select public.refresh_process_pop_marcos() as marcos,
       (select count(*) from public.aplicar_fase_por_marco()) as fases_movidas;

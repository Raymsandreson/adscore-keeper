-- =============================================================================
-- ⛔ OBSOLETO — NÃO RODAR. Substituído em 12/08/2026 por
--    PLANO_20260812_migrar_checklists_para_marco.sql
--
-- Motivo: este plano mapeia template_id ANTIGO -> stage novo, assumindo que o
-- board rascunho reaproveitaria os templates existentes. Ele ganhou 26
-- templates PRÓPRIOS — a interseção com os do board em uso é ZERO. Rodando
-- hoje, o `on conflict do nothing` da ETAPA 1 engoliria tudo em silêncio e o
-- resultado pareceria sucesso.
--
-- Mantido só como registro do raciocínio original.
-- =============================================================================
--
-- PLANO DE MIGRAÇÃO — checklists das 8 fases atuais para as 23 fases-marco
--
-- ESTE ARQUIVO NÃO FOI EXECUTADO. Prefixo PLANO_ de propósito: é para ler,
-- corrigir o mapa e só então rodar, em transação, com o backup feito.
--
-- -----------------------------------------------------------------------------
-- O TAMANHO REAL DO PROBLEMA (medido em 08/08/2026)
-- -----------------------------------------------------------------------------
-- O POP tem 8.628 instâncias de checklist, e o número assusta à toa:
--
--   8.628 instâncias no board
--     703 com ALGUM passo marcado  (8%)
--     367 concluídas
--     101 sem items
--
-- 92% são esqueleto criado automaticamente ao abrir o lead — nada dentro.
-- A migração precisa preservar 703 instâncias, não 8.628. Isso muda o risco de
-- "perigoso" para "administrável", desde que o mapa esteja certo.
--
-- -----------------------------------------------------------------------------
-- MAPA — objetivo de hoje → fase-marco nova
-- -----------------------------------------------------------------------------
-- (instâncias com trabalho real entre parênteses)
--
--   Consulta e Acolhimento Inicial ............ m_pre_processual        (135)
--   Preparação da Petição Inicial ............. m_pre_processual        (122)
--   Mediação e Autocomposição MPT (NUPIA) ..... m_pre_processual         (30)
--   Protocolo e citação ....................... m_ajuizamento           (117)
--   Audiência e Réplica ....................... m_audiencia_inicial      (74)
--   Instrução e Julgamento .................... PARTE EM TRÊS ↓          (59)
--   Embargos de declaração .................... m_embargos_1grau         (31)
--   Envio do processo para o 2º grau .......... m_remessa_2grau          (27)
--   Julgamento do Recurso  [2ª instância] ..... m_acordao_2grau
--   Embargos de Declaração 2º grau ............ m_embargos_2grau         (20)
--   Apresentar Recurso e remessa à Inst. Sup. . m_admissibilidade_rr      (4)
--   Agravo de Instrumento em RR ............... m_agravo_instrumento      (7)
--   Julgamento do Recurso  [superior] ......... m_decisao_superior
--   Agravo Interno ............................ m_agravo_interno          (5)
--   Apresentar Recurso e remessa ao STF ....... m_recurso_extraordinario  (1)
--   Recebimento e Prestação de Contas ......... m_pagamento               (3)
--
-- ARMADILHA: existem DOIS objetivos chamados "Julgamento do Recurso", um em
-- cada instância recursal (templates a4b97849… e 2dd31f17…). Agrupar por NOME
-- na migração juntaria os dois e mandaria os dois para a mesma fase. O script
-- abaixo casa por template_id, nunca por nome.
--
-- FASES NOVAS QUE FICAM SEM PROCEDIMENTO (nenhum objetivo aponta para elas):
--   Saneamento · Trânsito em julgado · Liquidação · Execução iniciada ·
--   Alvará expedido · Arquivamento definitivo · Suspensão
-- Não é erro do mapa: o POP atual não cobre essas etapas. São a lacuna que a
-- reconstrução expõe — decidir o que a equipe faz em cada uma é trabalho do
-- jurídico, não do script.
--
-- -----------------------------------------------------------------------------
-- O CASO DIFÍCIL — "Instrução e Julgamento", 20 passos, vira três fases
-- -----------------------------------------------------------------------------
-- Os 20 passos se separam com clareza pelo próprio texto:
--
--   → m_pericia            Nomeação de perito · Intimação do perito · Prazo para
--                          quesitos · Quesitos apresentados · Realização da
--                          perícia · Entrega do Laudo · Reavaliação e Proposta
--                          de Acordo Pós-Laudo · Intimação para manifestação do
--                          laudo (pendente e realizada) · Manifestação apresentada
--
--   → m_audiencia_instrucao  Concluso para despacho do juiz · Pendente despacho ·
--                          Despacho para razões finais · Prazo para razões finais ·
--                          Razões finais apresentadas · Envio ao MPT para parecer ·
--                          Parecer do MPT apresentado
--
--   → m_sentenca           Pendente envio do processo para Sentença · Processo
--                          enviado para Sentença · Sentença proferida
--
-- Partir o template exige criar três templates novos e dividir os `items` de
-- cada uma das 551 instâncias preservando o que está marcado. É o único ponto
-- do plano que mexe no conteúdo da instância, e não só no ponteiro de fase —
-- por isso vai separado, depois que o resto estiver conferido.
--
-- =============================================================================


-- ETAPA 0 — BACKUP. Sem isto, nada roda.
-- ---------------------------------------------------------------------------
create table if not exists public.zz_checklist_instances_bkp_20260808 as
select * from public.lead_checklist_instances
where board_id = 'b436c043-3ddb-4900-8800-dc4063624816';

create table if not exists public.zz_checklist_stage_links_bkp_20260808 as
select * from public.checklist_stage_links
where board_id = 'b436c043-3ddb-4900-8800-dc4063624816';

-- Conferência obrigatória antes de seguir: os dois números têm que bater com
-- 8.628 instâncias e 16 links.
--   select count(*) from zz_checklist_instances_bkp_20260808;
--   select count(*) from zz_checklist_stage_links_bkp_20260808;


-- ETAPA 1 — Ligar os objetivos às fases novas, no POP rascunho.
-- Aditivo: cria os links no board novo sem tocar nos do board em uso.
-- ---------------------------------------------------------------------------
with novo as (
  select id from public.kanban_boards
   where name = 'Trabalhistas judicial — marcos (rascunho)' limit 1
),
mapa(template_id, stage_novo) as (values
  ('20a7ccbe-8b8d-4dd9-a344-c45ed798df4a'::uuid, 'm_pre_processual'),
  ('056e1d19-736f-4d51-b41c-249bfb5118e4'::uuid, 'm_pre_processual'),
  ('3074b3b5-bf42-4766-b471-169c5ae80c8f'::uuid, 'm_pre_processual'),
  ('e7eb161c-edd8-45e8-b715-4bb5a4554c63'::uuid, 'm_ajuizamento'),
  ('f8e3944f-2002-4b89-a77a-2f028b1155b7'::uuid, 'm_audiencia_inicial'),
  ('0cfabf3c-d467-4c1a-817c-2fd3940bcc4e'::uuid, 'm_embargos_1grau'),
  ('09060de5-d660-48fa-8743-dd228b7663d8'::uuid, 'm_remessa_2grau'),
  -- "Julgamento do Recurso" da 2ª instância
  ('a4b97849-dbab-4a6a-8778-27acffc60cb9'::uuid, 'm_acordao_2grau'),
  ('f73e6193-f2a6-449b-bcd1-b32fe168bec3'::uuid, 'm_embargos_2grau'),
  ('305210fb-31dd-4e02-add3-f57faff5a0bf'::uuid, 'm_admissibilidade_rr'),
  ('84e98967-1307-46ee-97e0-04da8307d975'::uuid, 'm_agravo_instrumento'),
  -- "Julgamento do Recurso" da instância superior — MESMO NOME, outro template
  ('2dd31f17-638f-4df8-a678-648c224d3d60'::uuid, 'm_decisao_superior'),
  ('46c6ce24-ce8f-4db0-9051-41e5f299fc12'::uuid, 'm_agravo_interno'),
  ('d778424d-4a2c-4bbb-97e9-3baed8ff1685'::uuid, 'm_recurso_extraordinario'),
  ('f72ef1e6-d231-4e0e-91fd-805257a9a925'::uuid, 'm_pagamento')
)
insert into public.checklist_stage_links (board_id, stage_id, checklist_template_id)
select novo.id, mapa.stage_novo, mapa.template_id
from mapa cross join novo
on conflict do nothing;


-- ETAPA 2 — Mover as instâncias para o POP novo.
-- SÓ as que têm trabalho. As vazias são recriadas sozinhas ao abrir o lead;
-- arrastar 7.900 esqueletos só aumentaria a superfície de erro.
-- ---------------------------------------------------------------------------
-- RODAR PRIMEIRO COMO SELECT e conferir a contagem (esperado: ~703):
--
-- with novo as (select id from public.kanban_boards
--                where name = 'Trabalhistas judicial — marcos (rascunho)' limit 1)
-- select count(*)
--   from public.lead_checklist_instances i
--  where i.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'
--    and exists (select 1 from jsonb_array_elements(coalesce(i.items,'[]'::jsonb)) x
--                 where (x.value->>'checked')::boolean is true);
--
-- Só depois trocar por UPDATE, dentro de BEGIN/COMMIT, com o mapa acima.


-- ETAPA 3 — Partir "Instrução e Julgamento" em três. Só depois da 1 e 2 conferidas.
-- ---------------------------------------------------------------------------
-- Template de origem: 988c232e-25f6-47ab-9ba9-f121069d16ec (20 passos, 551 inst,
-- 59 com trabalho). Passo a passo previsto:
--   a) criar 3 templates novos com os items separados conforme o quadro acima;
--   b) para cada instância com trabalho, criar 3 instâncias novas distribuindo
--      os items e preservando `checked`;
--   c) conferir que a soma dos items marcados nas 3 bate com a original —
--      é a conciliação que prova que nada se perdeu;
--   d) só então marcar a instância antiga como substituída.


-- ROLLBACK
-- ---------------------------------------------------------------------------
--   delete from public.checklist_stage_links
--    where board_id = (select id from public.kanban_boards
--                       where name = 'Trabalhistas judicial — marcos (rascunho)');
--   update public.lead_checklist_instances i
--      set board_id = b.board_id, stage_id = b.stage_id
--     from public.zz_checklist_instances_bkp_20260808 b
--    where b.id = i.id;

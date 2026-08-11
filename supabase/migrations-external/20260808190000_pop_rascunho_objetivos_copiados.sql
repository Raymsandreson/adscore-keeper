-- =============================================================================
-- Traz os objetivos do POP em uso para o RASCUNHO, e parte "Instrução e
-- Julgamento" em três — deixando o rascunho completo para conferência.
--
-- POR QUE DUPLICAR E NÃO LIGAR O MESMO TEMPLATE NOS DOIS POPs:
-- checklist_stage_links aponta para checklist_templates. Ligar o mesmo template
-- ao POP em uso e ao rascunho faria qualquer edição no rascunho — reordenar
-- passo, mudar texto, remover item — cair direto no POP que roda com 677
-- processos. O rascunho tem que ser descartável; se compartilhasse template,
-- não seria.
--
-- A PARTIÇÃO DE "INSTRUÇÃO E JULGAMENTO" (20 passos → 3 fases):
--   passos  1-10  → Perícia          (nomeação, quesitos, laudo, manifestação)
--   passos 11-17  → Instrução        (razões finais, parecer do MPT)
--   passos 18-20  → Sentença         (envio e publicação)
-- 10 + 7 + 3 = 20. A soma bater é a prova de que nenhum passo se perdeu; se
-- alguém mexer nos intervalos, é isso que precisa ser reconferido.
--
-- Aqui a partição é barata porque mexe só em TEMPLATE. Na migração de verdade,
-- o mesmo corte terá de ser aplicado às instâncias — preservando o `checked` de
-- cada passo nas 59 que têm trabalho. É a etapa 3 do PLANO_20260808.
--
-- RESULTADO: 25 fases, todas com objetivo e passos, 180 passos no total.
--
-- REVERSÃO: apagar o board rascunho leva os links junto (cascade); os templates
-- copiados ficam órfãos e se identificam pela description
-- ('Copia para o POP marcos (rascunho)' / 'partida em tres no POP marcos').
-- =============================================================================

-- A) Objetivos que vão 1:1 para uma fase-marco.
with alvo as (select id from kanban_boards where name='Trabalhistas judicial — marcos (rascunho)'),
mapa(origem, stage_novo) as (values
 ('20a7ccbe-8b8d-4dd9-a344-c45ed798df4a'::uuid,'m_pre_processual'),   -- Consulta e Acolhimento Inicial
 ('056e1d19-736f-4d51-b41c-249bfb5118e4'::uuid,'m_pre_processual'),   -- Preparação da Petição Inicial
 ('3074b3b5-bf42-4766-b471-169c5ae80c8f'::uuid,'m_pre_processual'),   -- Mediação NUPIA
 ('e7eb161c-edd8-45e8-b715-4bb5a4554c63'::uuid,'m_ajuizamento'),      -- Protocolo e citação
 ('f8e3944f-2002-4b89-a77a-2f028b1155b7'::uuid,'m_audiencia_inicial'),-- Audiência e Réplica
 ('0cfabf3c-d467-4c1a-817c-2fd3940bcc4e'::uuid,'m_embargos_1grau'),
 ('09060de5-d660-48fa-8743-dd228b7663d8'::uuid,'m_remessa_2grau'),
 ('a4b97849-dbab-4a6a-8778-27acffc60cb9'::uuid,'m_acordao_2grau'),    -- "Julgamento do Recurso" 2ª inst.
 ('f73e6193-f2a6-449b-bcd1-b32fe168bec3'::uuid,'m_embargos_2grau'),
 ('305210fb-31dd-4e02-add3-f57faff5a0bf'::uuid,'m_admissibilidade_rr'),
 ('84e98967-1307-46ee-97e0-04da8307d975'::uuid,'m_agravo_instrumento'),
 ('2dd31f17-638f-4df8-a678-648c224d3d60'::uuid,'m_decisao_superior'), -- "Julgamento do Recurso" superior
 ('46c6ce24-ce8f-4db0-9051-41e5f299fc12'::uuid,'m_agravo_interno'),
 ('d778424d-4a2c-4bbb-97e9-3baed8ff1685'::uuid,'m_recurso_extraordinario'),
 ('f72ef1e6-d231-4e0e-91fd-805257a9a925'::uuid,'m_pagamento')         -- Recebimento e Prestação de Contas
),
copiados as (
  insert into public.checklist_templates (name, description, is_mandatory, items, scope)
  select t.name, 'Copia para o POP marcos (rascunho) — original: ' || t.id, t.is_mandatory, t.items, 'processo'
  from mapa m join public.checklist_templates t on t.id = m.origem
  returning id, description
)
insert into public.checklist_stage_links (board_id, stage_id, checklist_template_id)
select (select id from alvo), m.stage_novo, c.id
from copiados c
join mapa m on c.description like '%' || m.origem::text;

-- B) "Instrução e Julgamento" parte em três.
with alvo as (select id from kanban_boards where name='Trabalhistas judicial — marcos (rascunho)'),
orig as (select items from public.checklist_templates where id='988c232e-25f6-47ab-9ba9-f121069d16ec'),
partes(nome, stage_novo, ini, fim) as (values
 ('Perícia — nomeação, laudo e manifestação','m_pericia',0,10),
 ('Instrução — razões finais e parecer do MPT','m_audiencia_instrucao',10,7),
 ('Sentença — envio e publicação','m_sentenca',17,3)
),
novos as (
  insert into public.checklist_templates (name, description, is_mandatory, items, scope)
  select p.nome,
         'Parte de "Instrucao e Julgamento" (20 passos) partida em tres no POP marcos — original 988c232e',
         false,
         (select jsonb_agg(x.value order by x.ord)
            from orig, jsonb_array_elements(orig.items) with ordinality x(value, ord)
           where x.ord > p.ini and x.ord <= p.ini + p.fim),
         'processo'
  from partes p
  returning id, name
)
insert into public.checklist_stage_links (board_id, stage_id, checklist_template_id)
select (select id from alvo), p.stage_novo, n.id
from novos n join partes p on p.nome = n.name;

-- Conferência: nenhuma fase pode ficar com 0 objetivos.
--   select pm.ordem, pm.rotulo,
--          (select count(*) from checklist_stage_links l
--            where l.board_id = pm.board_id and l.stage_id = pm.stage_id) as objetivos
--     from pop_marcos pm
--    where pm.board_id = (select id from kanban_boards
--                          where name='Trabalhistas judicial — marcos (rascunho)')
--      and not pm.atravessa_fases
--    order by pm.ordem;

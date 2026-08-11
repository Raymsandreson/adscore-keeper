-- =============================================================================
-- Suspensão não é fase — é estado.
--
-- Correção do usuário (08/08/2026). O raciocínio é o mesmo do acordo, e eu
-- tinha aplicado num e não no outro: um processo suspenso está suspenso DENTRO
-- de uma fase — suspenso na fase recursal, suspenso na execução. Tratar como
-- fase própria faria o processo "sair" de onde estava, e ao levantar a suspensão
-- ninguém saberia para onde voltar.
--
-- Fica como marco com atravessa_fases = true: continua sendo detectável (códigos
-- 14985 IRDR e 272 prejudicial externa), continua registrando data, e não move o
-- processo de lugar.
--
-- Marcos que atravessam agora: Acordo homologado · Suspensão.
--
-- CONSEQUÊNCIA EM ABERTO: os 4 passos que eu tinha escrito para a Suspensão
-- (registrar motivo, anotar prazo, acompanhar, levantar) ficaram sem lugar — o
-- modelo pendura objetivo em fase (checklist_stage_links.stage_id), e marco que
-- atravessa não tem fase. O template segue existindo, sem vínculo, para ser
-- reaproveitado quando decidirmos onde o procedimento de um marco-que-atravessa
-- deve morar. O acordo tem o mesmo problema, resolvido por acidente: o passo
-- "Negociação de Acordos" já vive dentro de "Audiência e Réplica".
--
-- RASCUNHO AGORA: 24 fases, 0 vazias, 2 marcos que atravessam.
-- =============================================================================

update public.kanban_boards k
set stages = (select jsonb_agg(s order by ord)
                from jsonb_array_elements(k.stages) with ordinality x(s, ord)
               where s->>'id' <> 'm_suspensao')
where k.name = 'Trabalhistas judicial — marcos (rascunho)';

update public.pop_marcos
set atravessa_fases = true, stage_id = null, ordem = 27
where board_id = (select id from kanban_boards where name='Trabalhistas judicial — marcos (rascunho)')
  and chave = 'suspensao';

delete from public.checklist_stage_links
where board_id = (select id from kanban_boards where name='Trabalhistas judicial — marcos (rascunho)')
  and stage_id = 'm_suspensao';

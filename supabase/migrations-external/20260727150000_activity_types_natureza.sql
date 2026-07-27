-- Fundação da taxonomia de NATUREZAS de atividade em activity_types.
-- Banco: EXTERNO (kmedldlepwiityjsdahz) — mesma instância de lead_activities e da rotina.
-- Conceito completo: docs/juridico/naturezas-atividade.md
--
-- IMPORTANTE (decisão do usuário, jul/2026): activity_types é um catálogo
-- sobrecarregado (categorias de rotina + tipos juridicos + lixo). Esta migration NÃO
-- classifica tudo — só adiciona a coluna (nullable) e marca os 5 tipos jurídicos
-- inequívocos (lote n_teams=3). O resto fica natureza=null e mantém o comportamento
-- atual (front cai no fallback isMeetingType). Limpeza e classificação em massa são
-- tarefas separadas.

alter table public.activity_types
  add column if not exists natureza text
  check (natureza in ('compromisso','prazo','tarefa','diligencia'));

-- Classifica SÓ os tipos jurídicos canônicos. Resto permanece null.
update public.activity_types set natureza = 'compromisso' where key = 'custom_1778676337509'; -- Audiência
update public.activity_types set natureza = 'compromisso' where key = 'custom_1778676578465'; -- Reunião
update public.activity_types set natureza = 'prazo'       where key = 'custom_1778676343311'; -- Prazo
update public.activity_types set natureza = 'tarefa'      where key = 'custom_1778676331097'; -- Tarefa
update public.activity_types set natureza = 'tarefa'      where key = 'custom_1778676355309'; -- Acompanhamento

-- Rollback: alter table public.activity_types drop column natureza;

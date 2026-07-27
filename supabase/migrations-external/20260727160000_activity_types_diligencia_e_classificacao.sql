-- Cria os tipos jurídicos que faltavam e classifica os inequívocos existentes.
-- Banco: EXTERNO (kmedldlepwiityjsdahz). Conceito: docs/juridico/naturezas-atividade.md
-- team_ids = mesmo lote jurídico de Tarefa/Audiência/Prazo (aparecem no mesmo lugar).

-- 1) Tipos novos (Diligência confirmada pelo usuário; Perícia Médica e Avaliação Social
--    são os compromissos que faltavam — motivo desta branch).
insert into public.activity_types (key, label, color, display_order, is_active, team_ids, natureza)
values
  ('custom_1785200000001', 'Diligência',      'bg-amber-500',  (select coalesce(max(display_order),0)+1 from public.activity_types), true,
     array['c258bb4c-3cf5-4331-a337-a6ce40b7afc4','b6608407-3b16-4acf-932b-9f5267d870a8','821c7d57-5a9d-45f3-b3c5-bf3663910401'], 'diligencia'),
  ('custom_1785200000002', 'Perícia Médica',  'bg-rose-500',   (select coalesce(max(display_order),0)+2 from public.activity_types), true,
     array['c258bb4c-3cf5-4331-a337-a6ce40b7afc4','b6608407-3b16-4acf-932b-9f5267d870a8','821c7d57-5a9d-45f3-b3c5-bf3663910401'], 'compromisso'),
  ('custom_1785200000003', 'Avaliação Social','bg-violet-500', (select coalesce(max(display_order),0)+3 from public.activity_types), true,
     array['c258bb4c-3cf5-4331-a337-a6ce40b7afc4','b6608407-3b16-4acf-932b-9f5267d870a8','821c7d57-5a9d-45f3-b3c5-bf3663910401'], 'compromisso')
on conflict (key) do nothing;

-- 2) Classificação dos tipos jurídicos INEQUÍVOCOS já existentes. Ambíguos/rotina ficam null.
update public.activity_types set natureza = 'compromisso' where key = 'custom_1784047277015'; -- INSTRUÇÃO DE PERICIA
update public.activity_types set natureza = 'compromisso' where key = 'custom_1779887904378'; -- INSTRUÇÃO, INICIAL OU UNA.
update public.activity_types set natureza = 'diligencia'  where key = 'custom_1784135461651'; -- PEGAR SENHAS INSS
update public.activity_types set natureza = 'diligencia'  where key = 'custom_1779828804479'; -- Buscar Ass Social

-- Rollback: delete dos 3 keys custom_17852000000XX; e set natureza=null nos 4 acima.

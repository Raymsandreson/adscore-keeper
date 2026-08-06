-- Backfill retroativo do responsável dos casos PREV — ago/2026.
--
-- Regra (mesma de src/lib/processAssignment.ts):
--   administrativo, pelo último dígito do número do PREV
--     0-1 Andressa · 2-3 Keliane · 4-5 José · 6-7 Maria Lydia · 8-9 Vanessa
--   caso com QUALQUER processo judicial: ímpar → Gisele, par → Isabela
--
-- Escopo, decidido pelo usuário em 06/08/2026:
--   - legal_cases vivos do funil PREV .............. 900 linhas mudam
--   - lead_activities status pendente/em_andamento . 424 linhas mudam (de 837 no escopo)
--   - atividades CONCLUÍDAS ficam INTOCADAS: assigned_to é o único registro de
--     quem executou o trabalho, e reescrevê-lo apagaria 3.737 autorias reais.
--   - o mapa fixo (Natasha/Wanessa/João Vitor/Abderaman) NÃO é preservado dentro
--     de caso PREV: o caso tem um dono só. O código foi alinhado a isso.
--
-- Rollback: backfill_prev_responsavel_20260806 guarda o valor anterior de cada
-- linha. Ver o bloco comentado no fim do arquivo.

begin;

-- Rota de fuga. Sem policy: só service_role enxerga. Não guarda dado de cliente,
-- apenas uuid e nome de funcionário.
create table if not exists public.backfill_prev_responsavel_20260806 (
  entidade              text        not null check (entidade in ('caso','atividade')),
  row_id                uuid        not null,
  case_id               uuid        not null,
  prev_num              text        not null,
  judicial              boolean     not null,
  old_assigned_to       uuid,
  old_assigned_to_name  text,
  new_assigned_to       uuid        not null,
  new_assigned_to_name  text        not null,
  aplicado_em           timestamptz not null default now(),
  primary key (entidade, row_id)
);
alter table public.backfill_prev_responsavel_20260806 enable row level security;

create temporary table _alvo_prev on commit drop as
with prev as (
  select c.id,
         coalesce(
           substring(upper(coalesce(c.case_number,'')) from 'PREV[^0-9A-Z]{0,4}([0-9]{1,6})'),
           substring(upper(coalesce(c.title,''))       from 'PREV[^0-9A-Z]{0,4}([0-9]{1,6})')
         ) as prev_num
  from legal_cases c
  where c.deleted_at is null
    and (upper(coalesce(c.case_number,'')) like '%PREV%'
      or upper(coalesce(c.title,''))       like '%PREV%')
), base as (
  select p.id as case_id, p.prev_num, (right(p.prev_num,1))::int as d,
         exists(select 1 from lead_processes pr
                 where pr.case_id = p.id
                   and lower(coalesce(pr.process_type,'')) like 'jud%') as judicial
  from prev p
  where p.prev_num is not null
)
select b.case_id, b.prev_num, b.judicial,
  case
    when b.judicial and b.d % 2 = 1 then '74207dc6-af1a-4eda-a715-efd718749a9c'::uuid
    when b.judicial                 then '461d55d7-7185-4b47-98fb-f4f1505cba1d'::uuid
    else (array[
      '7910a0c1-b90b-49e2-bec0-7490435823da','7910a0c1-b90b-49e2-bec0-7490435823da',
      '5b5ac716-69de-4f4a-9370-0bc63816cda3','5b5ac716-69de-4f4a-9370-0bc63816cda3',
      'e1849012-7d6b-49b9-a5e5-36a2332e6eb8','e1849012-7d6b-49b9-a5e5-36a2332e6eb8',
      'fdb5c9af-ec75-45c5-a6a3-a1b8a4dd84fe','fdb5c9af-ec75-45c5-a6a3-a1b8a4dd84fe',
      '1d6f6602-5274-427c-8b70-54b6e19dc524','1d6f6602-5274-427c-8b70-54b6e19dc524'
    ]::uuid[])[b.d + 1]
  end as novo,
  case
    when b.judicial and b.d % 2 = 1 then 'Gisele Borges dos Santos'
    when b.judicial                 then 'ISABELA MARIA DE SOUSA ANDRADE'
    else (array[
      'Andressa Leão da Silva Duarte','Andressa Leão da Silva Duarte',
      'Keliane Sousa Amorim Araújo','Keliane Sousa Amorim Araújo',
      'Jose Francisco Campos de Oliveira','Jose Francisco Campos de Oliveira',
      'Maria Lydia Ribeiro','Maria Lydia Ribeiro',
      'Vanessa Miranda Macêdo','Vanessa Miranda Macêdo'
    ])[b.d + 1]
  end as novo_nome
from base b;

-- ---------------------------------------------------------------- 1. CASOS
insert into public.backfill_prev_responsavel_20260806
  (entidade, row_id, case_id, prev_num, judicial, old_assigned_to, old_assigned_to_name,
   new_assigned_to, new_assigned_to_name)
select 'caso', c.id, c.id, a.prev_num, a.judicial, c.assigned_to, null, a.novo, a.novo_nome
from legal_cases c join _alvo_prev a on a.case_id = c.id
where c.assigned_to is distinct from a.novo
on conflict (entidade, row_id) do nothing;

update legal_cases c
   set assigned_to = a.novo
  from _alvo_prev a
 where a.case_id = c.id
   and c.assigned_to is distinct from a.novo;

-- ----------------------------------------------------------- 2. ATIVIDADES
-- Só trabalho vivo. 'concluida' fora do escopo de propósito.
insert into public.backfill_prev_responsavel_20260806
  (entidade, row_id, case_id, prev_num, judicial, old_assigned_to, old_assigned_to_name,
   new_assigned_to, new_assigned_to_name)
select 'atividade', act.id, act.case_id, a.prev_num, a.judicial,
       act.assigned_to, act.assigned_to_name, a.novo, a.novo_nome
from lead_activities act join _alvo_prev a on a.case_id = act.case_id
where act.deleted_at is null
  and act.status in ('pendente','em_andamento')
  and act.assigned_to is distinct from a.novo
on conflict (entidade, row_id) do nothing;

update lead_activities act
   set assigned_to = a.novo,
       assigned_to_name = a.novo_nome
  from _alvo_prev a
 where a.case_id = act.case_id
   and act.deleted_at is null
   and act.status in ('pendente','em_andamento')
   and act.assigned_to is distinct from a.novo;

commit;

-- ROLLBACK (rodar manualmente se precisar desfazer):
--
--   update legal_cases c set assigned_to = b.old_assigned_to
--     from public.backfill_prev_responsavel_20260806 b
--    where b.entidade = 'caso' and b.row_id = c.id;
--
--   update lead_activities a
--      set assigned_to = b.old_assigned_to, assigned_to_name = b.old_assigned_to_name
--     from public.backfill_prev_responsavel_20260806 b
--    where b.entidade = 'atividade' and b.row_id = a.id;

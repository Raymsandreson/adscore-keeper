-- Responsável dos casos PREV: duas trilhas + backfill retroativo — 06/08/2026.
--
-- Um caso PREV pode ter frente administrativa e judicial ao mesmo tempo, e aí
-- tem DOIS responsáveis, um por trilha:
--   legal_cases.assigned_to ............ administrativo, rodízio pelo último
--                                        dígito do PREV: 0-1 Andressa · 2-3
--                                        Keliane · 4-5 José · 6-7 Maria Lydia ·
--                                        8-9 Vanessa
--   legal_cases.assigned_to_judicial ... judicial: ímpar Gisele, par Isabela
--
-- Escopo do backfill:
--   - 900 casos ganham responsável administrativo
--   -  72 casos (os que têm ao menos um lead_processes judicial) ganham o judicial
--   - 430 atividades pendente/em_andamento, cada uma pela trilha do SEU processo
--     (sem process_id = administrativo)
--   -   2 atividades PULADAS: são duplicatas que colidiriam no índice único
--     lead_activities_dedup_pending_idx (lead_id, lower(trim(title)),
--     activity_type, assigned_to) WHERE status='pendente'. Ver query no fim.
--   - atividades CONCLUÍDAS ficam INTOCADAS: assigned_to é o único registro de
--     quem executou o trabalho, e reescrevê-lo apagaria 3.737 autorias reais.
--   - o mapa fixo (Natasha/Wanessa/João Vitor/Abderaman) NÃO vale dentro de caso
--     PREV; o código foi alinhado a isso.
--
-- backfill_prev_responsavel_20260806 é ao mesmo tempo o plano e a rota de fuga:
-- guarda o valor anterior de cada linha. Rollback comentado no fim.

alter table public.legal_cases
  add column if not exists assigned_to_judicial uuid;

comment on column public.legal_cases.assigned_to_judicial is
  'Responsável pela trilha JUDICIAL do caso (UUID do auth Externo). A trilha administrativa fica em assigned_to. Ver src/lib/processAssignment.ts.';

create table if not exists public.backfill_prev_responsavel_20260806 (
  entidade              text        not null check (entidade in ('caso_adm','caso_jud','atividade')),
  row_id                uuid        not null,
  case_id               uuid        not null,
  prev_num              text        not null,
  old_assigned_to       uuid,
  old_assigned_to_name  text,
  new_assigned_to       uuid        not null,
  new_assigned_to_name  text        not null,
  aplicado_em           timestamptz not null default now(),
  primary key (entidade, row_id)
);

-- Sem policy: só service_role enxerga. Não guarda dado de cliente, apenas uuid
-- e nome de funcionário.
alter table public.backfill_prev_responsavel_20260806 enable row level security;


-- O plano inteiro sai de uma view temporária para casos e atividades usarem
-- exatamente o mesmo alvo.
create or replace view public._alvo_prev_20260806 as
with prev as (
  select c.id as case_id,
         coalesce(
           substring(upper(coalesce(c.case_number,'')) from 'PREV[^0-9A-Z]{0,4}([0-9]{1,6})'),
           substring(upper(coalesce(c.title,''))       from 'PREV[^0-9A-Z]{0,4}([0-9]{1,6})')
         ) as prev_num
  from legal_cases c
  where c.deleted_at is null
    and (upper(coalesce(c.case_number,'')) like '%PREV%'
      or upper(coalesce(c.title,''))       like '%PREV%')
)
select p.case_id, p.prev_num,
  exists(select 1 from lead_processes pr
          where pr.case_id = p.case_id
            and lower(coalesce(pr.process_type,'')) like 'jud%') as tem_judicial,
  (array[
    '7910a0c1-b90b-49e2-bec0-7490435823da','7910a0c1-b90b-49e2-bec0-7490435823da',
    '5b5ac716-69de-4f4a-9370-0bc63816cda3','5b5ac716-69de-4f4a-9370-0bc63816cda3',
    'e1849012-7d6b-49b9-a5e5-36a2332e6eb8','e1849012-7d6b-49b9-a5e5-36a2332e6eb8',
    'fdb5c9af-ec75-45c5-a6a3-a1b8a4dd84fe','fdb5c9af-ec75-45c5-a6a3-a1b8a4dd84fe',
    '1d6f6602-5274-427c-8b70-54b6e19dc524','1d6f6602-5274-427c-8b70-54b6e19dc524'
  ]::uuid[])[(right(p.prev_num,1))::int + 1] as adm,
  (array[
    'Andressa Leão da Silva Duarte','Andressa Leão da Silva Duarte',
    'Keliane Sousa Amorim Araújo','Keliane Sousa Amorim Araújo',
    'Jose Francisco Campos de Oliveira','Jose Francisco Campos de Oliveira',
    'Maria Lydia Ribeiro','Maria Lydia Ribeiro',
    'Vanessa Miranda Macêdo','Vanessa Miranda Macêdo'
  ])[(right(p.prev_num,1))::int + 1] as adm_nome,
  case when (right(p.prev_num,1))::int % 2 = 1
       then '74207dc6-af1a-4eda-a715-efd718749a9c'::uuid
       else '461d55d7-7185-4b47-98fb-f4f1505cba1d'::uuid end as jud,
  case when (right(p.prev_num,1))::int % 2 = 1
       then 'Gisele Borges dos Santos'
       else 'ISABELA MARIA DE SOUSA ANDRADE' end as jud_nome
from prev p
where p.prev_num is not null;


-- ================================================== 1. PLANO: CASOS (2 trilhas)
insert into public.backfill_prev_responsavel_20260806
  (entidade, row_id, case_id, prev_num, old_assigned_to, old_assigned_to_name,
   new_assigned_to, new_assigned_to_name)
select 'caso_adm', c.id, c.id, v.prev_num, c.assigned_to, null, v.adm, v.adm_nome
from legal_cases c join public._alvo_prev_20260806 v on v.case_id = c.id
where c.assigned_to is distinct from v.adm
on conflict (entidade, row_id) do nothing;

insert into public.backfill_prev_responsavel_20260806
  (entidade, row_id, case_id, prev_num, old_assigned_to, old_assigned_to_name,
   new_assigned_to, new_assigned_to_name)
select 'caso_jud', c.id, c.id, v.prev_num, c.assigned_to_judicial, null, v.jud, v.jud_nome
from legal_cases c join public._alvo_prev_20260806 v on v.case_id = c.id
where v.tem_judicial
  and c.assigned_to_judicial is distinct from v.jud
on conflict (entidade, row_id) do nothing;


-- ======================================================= 2. PLANO: ATIVIDADES
-- Cada atividade segue a trilha do SEU processo; sem process_id, administrativa.
-- Só trabalho vivo — 'concluida' fora do escopo de propósito.
with plano as (
  select a.id, a.lead_id, a.case_id, lower(btrim(a.title)) as k, a.activity_type,
         a.created_at, a.assigned_to, a.assigned_to_name, v.prev_num,
         case when lower(coalesce(pr.process_type,'')) like 'jud%' then v.jud      else v.adm      end as novo,
         case when lower(coalesce(pr.process_type,'')) like 'jud%' then v.jud_nome else v.adm_nome end as novo_nome
  from lead_activities a
  join public._alvo_prev_20260806 v on v.case_id = a.case_id
  left join lead_processes pr on pr.id = a.process_id
  where a.deleted_at is null
    and a.status in ('pendente','em_andamento')
), estado_final as (
  -- Estado do índice dedup DEPOIS do update, incluindo pendentes fora do escopo.
  select a.id, a.lead_id, lower(btrim(a.title)) as k, a.activity_type, a.created_at,
         coalesce(p.novo, a.assigned_to, '00000000-0000-0000-0000-000000000000'::uuid) as dono,
         (p.novo is not null and a.assigned_to is not distinct from p.novo) as ja_e_o_alvo
  from lead_activities a
  left join plano p on p.id = a.id
  where a.deleted_at is null and a.status = 'pendente' and a.lead_id is not null
), pulados as (
  -- Duplicatas: quem já está no alvo fica com a vaga; empate desempata pela mais
  -- antiga. As demais NÃO são movidas, senão o índice único estoura (23505).
  select id from (
    select id, row_number() over (
             partition by lead_id, k, activity_type, dono
             order by ja_e_o_alvo desc, created_at) as rn
    from estado_final
  ) x where rn > 1
)
insert into public.backfill_prev_responsavel_20260806
  (entidade, row_id, case_id, prev_num, old_assigned_to, old_assigned_to_name,
   new_assigned_to, new_assigned_to_name)
select 'atividade', p.id, p.case_id, p.prev_num, p.assigned_to, p.assigned_to_name,
       p.novo, p.novo_nome
from plano p
where p.assigned_to is distinct from p.novo
  and p.id not in (select id from pulados)
on conflict (entidade, row_id) do nothing;


-- ================================================================ 3. APLICA
update legal_cases c
   set assigned_to = b.new_assigned_to
  from public.backfill_prev_responsavel_20260806 b
 where b.entidade = 'caso_adm' and b.row_id = c.id
   and c.assigned_to is distinct from b.new_assigned_to;

update legal_cases c
   set assigned_to_judicial = b.new_assigned_to
  from public.backfill_prev_responsavel_20260806 b
 where b.entidade = 'caso_jud' and b.row_id = c.id
   and c.assigned_to_judicial is distinct from b.new_assigned_to;

update lead_activities act
   set assigned_to      = b.new_assigned_to,
       assigned_to_name = b.new_assigned_to_name
  from public.backfill_prev_responsavel_20260806 b
 where b.entidade = 'atividade' and b.row_id = act.id
   and act.assigned_to is distinct from b.new_assigned_to;

drop view if exists public._alvo_prev_20260806;


-- AS 2 ATIVIDADES PULADAS (duplicatas a resolver à mão):
--   select a.id, a.title, a.assigned_to_name, a.created_at, c.case_number
--     from lead_activities a join legal_cases c on c.id = a.case_id
--    where a.status = 'pendente' and a.deleted_at is null
--      and a.id not in (select row_id from public.backfill_prev_responsavel_20260806
--                        where entidade = 'atividade')
--      and c.id in (select case_id from public._alvo_prev_20260806);
--
-- ROLLBACK (rodar manualmente se precisar desfazer):
--
--   update legal_cases c set assigned_to = b.old_assigned_to
--     from public.backfill_prev_responsavel_20260806 b
--    where b.entidade = 'caso_adm' and b.row_id = c.id;
--
--   update legal_cases c set assigned_to_judicial = b.old_assigned_to
--     from public.backfill_prev_responsavel_20260806 b
--    where b.entidade = 'caso_jud' and b.row_id = c.id;
--
--   update lead_activities a
--      set assigned_to = b.old_assigned_to, assigned_to_name = b.old_assigned_to_name
--     from public.backfill_prev_responsavel_20260806 b
--    where b.entidade = 'atividade' and b.row_id = a.id;

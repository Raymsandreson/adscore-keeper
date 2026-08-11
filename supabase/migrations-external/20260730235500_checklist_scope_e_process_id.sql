-- =============================================================================
-- POP por processo — parte 1: limpeza + estrutura
-- Banco: EXTERNO (kmedldlepwiityjsdahz)
--
-- CONTEXTO
-- O POP é do processo (lead_processes.workflow_id), mas o estado dos passos e
-- dos checklists dentro deles vive em lead_checklist_instances, chaveada só por
-- lead_id. Dois processos do mesmo lead no mesmo POP dividem os mesmos
-- checkboxes (230 pares nessa situação em 30/07/2026).
--
-- Nem tudo é do processo: o POP mistura objetivo de nível CLIENTE (CTPS,
-- procuração, RG — o cliente entrega uma vez, tenha ele 1 ou 3 processos) com
-- objetivo de nível PROCESSO (sentença, prazos recursais, acórdão). Por isso o
-- nível é declarado por objetivo em checklist_templates.scope.
--
-- ESTA MIGRATION NÃO MUDA COMPORTAMENTO:
--   scope nasce 'cliente' (= exatamente como funciona hoje)
--   process_id nasce NULL
-- A classificação dos objetivos e o backfill vêm em migrations separadas,
-- depois da UI de classificação.
--
-- PRÉ-REQUISITO JÁ NO AR: commit c49b55f26 fez o insert de instância tolerar
-- 23505. Sem ele, os índices únicos do passo 5 quebram a criação de checklist.
--
-- ROLLBACK (< 5 min):
--   drop index if exists uniq_lci_por_processo;
--   drop index if exists uniq_lci_por_lead;
--   alter table lead_checklist_instances drop column if exists process_id;
--   alter table checklist_templates drop column if exists scope;
--   -- dado: delete from lead_checklist_instances;
--   --       insert into lead_checklist_instances select * from zz_lci_bkp_20260730;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Backup completo antes de qualquer escrita (29.288 linhas em 30/07/2026).
-- -----------------------------------------------------------------------------
create table if not exists public.zz_lci_bkp_20260730 as
  select * from public.lead_checklist_instances;

-- -----------------------------------------------------------------------------
-- 1. Nível do objetivo: cliente (dono = lead) ou processo (dono = processo).
-- -----------------------------------------------------------------------------
alter table public.checklist_templates
  add column if not exists scope text not null default 'cliente';

alter table public.checklist_templates
  drop constraint if exists checklist_templates_scope_check;
alter table public.checklist_templates
  add constraint checklist_templates_scope_check check (scope in ('cliente','processo'));

comment on column public.checklist_templates.scope is
  'cliente = os passos valem para o cliente/caso (documentos, procuração, onboarding); '
  'processo = os passos valem para um processo específico (sentença, recurso, prazo). '
  'Instância de objetivo cliente tem process_id NULL; a de processo tem process_id preenchido.';

-- -----------------------------------------------------------------------------
-- 2. Dono opcional por processo.
--    set null (não cascade): apagar um processo não pode levar junto o
--    histórico de passos que hoje pertence ao lead.
-- -----------------------------------------------------------------------------
alter table public.lead_checklist_instances
  add column if not exists process_id uuid null
  references public.lead_processes(id) on delete set null;

comment on column public.lead_checklist_instances.process_id is
  'Processo dono desta instância (objetivos scope=processo). NULL = instância do '
  'lead/caso, que é o comportamento histórico e continua valendo para scope=cliente.';

-- -----------------------------------------------------------------------------
-- 3. Duplicatas: eleger sobrevivente por tupla (a mais antiga).
--    Origem: createLeadInstances fazia SELECT-existentes -> INSERT sem
--    constraint; duas abas no mesmo lead inseriam as duas.
--    Em 30/07/2026: 3.893 tuplas, 7.336 linhas excedentes (25% da tabela).
-- -----------------------------------------------------------------------------
-- Tabelas de apoio normais (não temporary): a migration pode ser aplicada por
-- um caminho que não garante transação única, e temporary on commit drop
-- sumiria entre os statements. São dropadas no passo 6.
drop table if exists public.zz_dedup_dup;
create table public.zz_dedup_dup as
  select
    (array_agg(id order by created_at, id))[1] as manter,
    array_agg(id order by created_at, id)      as todos
  from public.lead_checklist_instances
  group by lead_id, board_id, stage_id, checklist_template_id
  having count(*) > 1;

-- Marcações presentes em QUALQUER cópia — os dois níveis (passo e checklist do
-- passo). Validado em 30/07/2026: 2.946 passos e 164 itens de checklist, e
-- nenhum deles falta no sobrevivente, então o merge não perde marcação.
drop table if exists public.zz_dedup_itens;
create table public.zz_dedup_itens as
  select d.manter, x->>'id' as item_id
  from public.zz_dedup_dup d
  cross join unnest(d.todos) as inst_id
  join public.lead_checklist_instances i on i.id = inst_id
  cross join lateral jsonb_array_elements(i.items) x
  where coalesce((x->>'checked')::boolean, false)
  group by 1, 2;

drop table if exists public.zz_dedup_docs;
create table public.zz_dedup_docs as
  select d.manter, x->>'id' as item_id, dd->>'id' as doc_id
  from public.zz_dedup_dup d
  cross join unnest(d.todos) as inst_id
  join public.lead_checklist_instances i on i.id = inst_id
  cross join lateral jsonb_array_elements(i.items) x
  cross join lateral jsonb_array_elements(coalesce(x->'docChecklist', '[]'::jsonb)) dd
  where coalesce((dd->>'checked')::boolean, false)
  group by 1, 2, 3;

-- -----------------------------------------------------------------------------
-- 4. Merge OR no sobrevivente: passo marcado em qualquer cópia fica marcado.
--    A ordem dos itens é a do sobrevivente (with ordinality preserva).
-- -----------------------------------------------------------------------------
with merged as (
  select
    d.manter as id,
    (
      select jsonb_agg(
        case
          when x ? 'docChecklist' then
            x
              || jsonb_build_object('checked', im.item_id is not null)
              || jsonb_build_object('docChecklist', (
                   select coalesce(jsonb_agg(
                     dd || jsonb_build_object('checked', exists (
                       select 1 from public.zz_dedup_docs dm
                       where dm.manter = d.manter
                         and dm.item_id = x->>'id'
                         and dm.doc_id  = dd->>'id'
                     )) order by didx), '[]'::jsonb)
                   from jsonb_array_elements(x->'docChecklist') with ordinality td(dd, didx)
                 ))
          else
            x || jsonb_build_object('checked', im.item_id is not null)
        end
        order by idx
      )
      from public.lead_checklist_instances a
      cross join lateral jsonb_array_elements(a.items) with ordinality t(x, idx)
      left join public.zz_dedup_itens im
        on im.manter = d.manter and im.item_id = x->>'id'
      where a.id = d.manter
    ) as items
  from public.zz_dedup_dup d
)
update public.lead_checklist_instances i
   set items        = m.items,
       is_completed = (
         select bool_and(coalesce((y->>'checked')::boolean, false))
         from jsonb_array_elements(m.items) y
       ),
       updated_at   = now()
  from merged m
 where i.id = m.id
   and m.items is not null;

-- completed_at coerente com o is_completed recalculado (sem inventar data:
-- aproveita a mais antiga entre as cópias que já estavam concluídas).
update public.lead_checklist_instances i
   set completed_at = sub.dt
  from (
    select d.manter as id, min(c.completed_at) as dt
    from public.zz_dedup_dup d
    cross join unnest(d.todos) as inst_id
    join public.lead_checklist_instances c on c.id = inst_id
    where c.completed_at is not null
    group by d.manter
  ) sub
 where i.id = sub.id and i.is_completed and i.completed_at is null;

-- -----------------------------------------------------------------------------
-- 5. Apaga as excedentes e cria os índices que nunca existiram.
--    Sem concurrently de propósito: 29k linhas, índice sai em milissegundos, e
--    concurrently não roda dentro da transação da migration.
-- -----------------------------------------------------------------------------
delete from public.lead_checklist_instances i
 using public.zz_dedup_dup d
 where i.id = any(d.todos)
   and i.id <> d.manter;

create unique index if not exists uniq_lci_por_lead
  on public.lead_checklist_instances (lead_id, board_id, stage_id, checklist_template_id)
  where process_id is null;

create unique index if not exists uniq_lci_por_processo
  on public.lead_checklist_instances (process_id, board_id, stage_id, checklist_template_id)
  where process_id is not null;

create index if not exists idx_lci_process
  on public.lead_checklist_instances (process_id)
  where process_id is not null;

-- -----------------------------------------------------------------------------
-- 6. Limpa as tabelas de apoio. O backup zz_lci_bkp_20260730 FICA — é a rota de
--    volta enquanto a mudança não estiver confirmada em produção.
-- -----------------------------------------------------------------------------
drop table if exists public.zz_dedup_docs;
drop table if exists public.zz_dedup_itens;
drop table if exists public.zz_dedup_dup;

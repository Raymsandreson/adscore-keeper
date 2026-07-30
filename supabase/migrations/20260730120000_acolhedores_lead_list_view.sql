-- Lista (visualização em tabela) do board de acolhimento "Acidente de Trabalho".
-- 1) Tabela `acolhedores`: cadastro canônico dos acolhedores (avatar, aliases,
--    ativo) — leads.acolhedor continua texto livre; o match é feito por
--    nome_canonico/aliases no frontend.
-- 2) View `lead_list_view` (security_invoker): leads + stage_entered_at
--    calculado com a MESMA semântica do kanban (último lead_stage_history com
--    to_stage = status, fallback updated_at), colunas display_* para ordenação
--    server-side e kanban_visible espelhando a visibilidade do DynamicKanbanBoard
--    (exclui deletados e status noticias/viavel, mantém colunas fixas por
--    lead_status closed/refused/inviavel/cancelled).
-- 3) Índice composto em lead_stage_history para o lateral da view.
--
-- Rollback:
--   drop view if exists public.lead_list_view;
--   drop table if exists public.acolhedores;
--   drop index if exists idx_lead_stage_history_lead_stage_changed;
--
-- Pendente de aplicação no Externo (WhatsJUD, kmedldlepwiityjsdahz).

-- 1) Tabela de acolhedores
create table if not exists public.acolhedores (
  id uuid primary key default gen_random_uuid(),
  nome_canonico text not null unique,
  foto_url text,
  aliases text[] not null default '{}',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.acolhedores enable row level security;

create policy "Anyone can read acolhedores"
  on public.acolhedores for select using (true);
create policy "Authenticated can insert acolhedores"
  on public.acolhedores for insert with check (auth.uid() is not null);
create policy "Authenticated can update acolhedores"
  on public.acolhedores for update using (auth.uid() is not null);
create policy "Authenticated can delete acolhedores"
  on public.acolhedores for delete using (auth.uid() is not null);

-- Seed: lista canônica atual (src/lib/trabalhistaAcolhedores.ts) com os aliases
-- já usados em leads.acolhedor (src/lib/acolhedorPhotos.ts).
insert into public.acolhedores (nome_canonico, aliases) values
  ('Analyne Sousa de Oliveira', array['Analyne Oliveira', 'Analyne']),
  ('João Manoel Cavalcante Santana', array['João Manoel', 'Joao Manoel']),
  ('Bruno Wenner Dantas Nunes', array['Bruno Dantas']),
  ('Juliana Clara Santos Pimentel', array['Juliana Pimentel']),
  ('Luiz Ricardo', array[]::text[]),
  ('Grazielle Aline Moreira da Silva', array['Grazielle Aline', 'Grazielle'])
on conflict (nome_canonico) do nothing;

-- 2) Índice para o lateral (lead atual -> última entrada na etapa vigente)
create index if not exists idx_lead_stage_history_lead_stage_changed
  on public.lead_stage_history (lead_id, to_stage, changed_at desc);

-- 3) View da lista
create or replace view public.lead_list_view
with (security_invoker = on) as
select
  l.id,
  l.board_id,
  l.status,
  l.lead_status,
  l.lead_name,
  l.lead_number,
  l.victim_name,
  nullif(btrim(l.victim_name), '') as victim_name_trim,
  l.victim_age,
  l.lead_phone,
  l.case_number,
  l.case_type,
  l.acolhedor,
  nullif(btrim(l.acolhedor), '') as acolhedor_trim,
  l.accident_date,
  l.created_at,
  l.updated_at,
  l.created_by,
  l.updated_by,
  l.visit_state,
  l.visit_city,
  l.visit_region,
  l.deleted_at,
  coalesce(l.main_company, l.contractor_company) as display_company,
  coalesce(l.visit_city, l.city) as display_city,
  coalesce(l.visit_state, l.state) as display_state,
  regexp_replace(coalesce(l.lead_phone, ''), '\D', '', 'g') as phone_digits,
  coalesce(h.changed_at, l.updated_at) as stage_entered_at,
  sp.stage_position,
  (
    l.deleted_at is null
    and (
      (
        (l.lead_status is null
          or l.lead_status in ('no_response', 'in_progress', 'active', 'novo', 'new', 'open'))
        and coalesce(l.status, '') not in ('noticias', 'viavel')
      )
      or l.lead_status in ('closed', 'refused', 'inviavel', 'cancelled')
    )
  ) as kanban_visible
from public.leads l
left join lateral (
  select h2.changed_at
  from public.lead_stage_history h2
  where h2.lead_id = l.id
    and h2.to_stage = l.status
  order by h2.changed_at desc
  limit 1
) h on true
left join lateral (
  select arr.ord::int as stage_position
  from public.kanban_boards b
  cross join lateral jsonb_array_elements(b.stages) with ordinality arr(elem, ord)
  where b.id = l.board_id
    and arr.elem ->> 'id' = l.status
  limit 1
) sp on true;

-- =============================================================================
-- Sino v3: esfera (ramo da Justiça) + etiqueta "Notificado" + atividade gerada.
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- 1) process_updates.esfera — permite filtrar o sino por Trabalhista /
--    Previdenciário JF / Administrativo Prev. / Comum. A equipe trabalhista não
--    tem por que ver movimentação de INSS e vice-versa.
-- 2) process_update_notifications — registro de que o CLIENTE foi avisado.
--    Diferente de process_update_reads (leitura, por usuário), este é GLOBAL:
--    "o cliente foi notificado" é fato do caso, não estado pessoal de quem abriu
--    o sino. É o que evita duas pessoas mandarem a mesma movimentação no grupo.
-- 3) lead_activities.process_update_id — a notificação passa a criar a atividade
--    do próximo passo; a coluna liga uma coisa à outra e impede duplicata quando
--    a mesma movimentação é reenviada ou já virou atividade pelo botão "Criar atv".
--
-- Rollback:
--   drop index if exists lead_activities_process_update_uidx;
--   alter table public.lead_activities drop column if exists process_update_id;
--   drop table if exists public.process_update_notifications;
--   alter table public.process_updates drop column if exists esfera;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Esfera
-- ---------------------------------------------------------------------------
alter table public.process_updates
  add column if not exists esfera text;

create index if not exists process_updates_esfera_idx
  on public.process_updates (esfera);

-- Backfill. Mesma régua de src/lib/esferaJustica.ts:
--   dígito J do CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) manda; 4 = Federal, 5 = Trabalho,
--   8 = Estadual. Matéria previdenciária só separa Federal prev. de Federal cível.
--   Sem CNJ, vale o process_type do processo.
with ctx as (
  select
    u.id,
    substring(coalesce(u.numero_cnj, '') from '\d{7}-?\d{2}\.\d{4}\.(\d)\.') as ramo,
    p.process_type,
    lower(
      coalesce(p.area, '') || ' ' ||
      array_to_string(coalesce(p.assuntos, '{}'), ' ') || ' ' ||
      coalesce(p.classe, '') || ' ' ||
      coalesce(l.case_type, '') || ' ' ||
      -- Título e partes: medido em 11/08/2026, 199 dos 207 feeds da Justiça
      -- Federal tinham área/assuntos/classe/case_type vazios, e o que revelava
      -- previdenciário era o título ou o INSS no polo passivo.
      coalesce(p.title, '') || ' ' ||
      coalesce(u.processo_titulo, '') || ' ' ||
      coalesce(p.polo_ativo, '') || ' ' ||
      coalesce(p.polo_passivo, '')
    ) as materia
  from public.process_updates u
  left join public.lead_processes p on p.id = u.process_id
  left join public.leads l on l.id = u.lead_id
)
update public.process_updates u
set esfera = case
  when c.ramo = '5' then 'trabalhista'
  when c.ramo = '4' then
    case when c.materia ~ 'previdenc|bpc|loas|auxilio|auxílio|aposentad|pensao|pensão|incapacidade|maternidade|inss|seguro social|beneficio|benefício|assistencial|deficien|rural'
      then 'federal_prev' else 'federal_civel' end
  when c.ramo = '8' then 'comum'
  when c.ramo is not null then 'outros'
  when c.process_type = 'administrativo' then
    case when c.materia ~ 'previdenc|bpc|loas|auxilio|auxílio|aposentad|pensao|pensão|incapacidade|maternidade|inss|seguro social|beneficio|benefício|assistencial|deficien|rural'
      then 'administrativo_prev' else 'administrativo' end
  else 'outros'
end
from ctx c
where c.id = u.id
  and u.esfera is null;

-- ---------------------------------------------------------------------------
-- 2) Etiqueta "Notificado"
-- ---------------------------------------------------------------------------
create table if not exists public.process_update_notifications (
  update_id uuid primary key references public.process_updates(id) on delete cascade,
  notified_at timestamptz not null default now(),
  -- user_id do Externo (remapeado no client, igual a process_update_reads).
  notified_by uuid,
  notified_by_name text,
  -- Atividade criada junto com o aviso (o "próximo passo" vira tarefa).
  activity_id uuid,
  channel text not null default 'whatsapp_grupo',
  group_jid text
);

create index if not exists process_update_notifications_notified_at_idx
  on public.process_update_notifications (notified_at desc);

alter table public.process_update_notifications enable row level security;

-- Mesmo padrão permissivo das demais tabelas de negócio (sessão anônima
-- autenticada; o user_id vem remapeado do app, não do auth.uid()).
create policy "Authenticated users can view update notifications"
  on public.process_update_notifications for select
  to authenticated
  using (auth.uid() is not null);

create policy "Authenticated users can mark updates notified"
  on public.process_update_notifications for insert
  to authenticated
  with check (auth.uid() is not null);

-- Reenvio atualiza a etiqueta (quem reenviou e quando), não cria linha nova.
create policy "Authenticated users can update notification tag"
  on public.process_update_notifications for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 3) Atividade gerada pela movimentação
-- ---------------------------------------------------------------------------
alter table public.lead_activities
  add column if not exists process_update_id uuid;

-- Uma movimentação gera no máximo UMA atividade — o botão "Criar atv" e o
-- "Notificar" consultam por aqui antes de criar.
create unique index if not exists lead_activities_process_update_uidx
  on public.lead_activities (process_update_id)
  where process_update_id is not null;

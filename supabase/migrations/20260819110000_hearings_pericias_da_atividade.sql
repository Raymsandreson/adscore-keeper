-- Perícia vira EVENTO DE AGENDA: a data marcada na atividade passa a nascer em
-- `hearings`, a mesma tabela onde audiência já mora.
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA (medido no Externo em 19/08/2026): a data da perícia estava em três
-- lugares e nenhum cobria o serviço.
--   1. `hearings` com hearing_type de perícia: 75 linhas vivas, 12 futuras —
--      todas vindas da planilha de audiências (created_by nulo em 12/12), e só
--      1 das 12 tem lead/caso/responsável. É perícia JUDICIAL.
--   2. `lead_processes.pericia_medica_at` / `pericia_social_at` (migration
--      20260813120000, chip no cabeçalho da atividade): 1 e 0 linhas no banco
--      inteiro. O chip só aparece em processo intitulado "Benefício INSS", e
--      115 das 326 atividades vivas de perícia (35%) não têm processo nenhum
--      vinculado — não tinham onde salvar.
--   3. Título da atividade ("Audiência Perícia Médica 14/08/2026 14:00"): a
--      data existe só como texto. O `deadline` dessas atividades é o dia de
--      PREPARAR, não o da perícia — a do exemplo tem deadline 21/08.
-- Resultado: 326 atividades de perícia pendentes (235 criadas em 30 dias) e um
-- calendário que enxergava 12.
--
-- DECISÃO: `hearings` é a tabela de eventos do escritório. Já tem data, hora,
-- status (`adiada` é exatamente o "REMARCAR PERÍCIA" que aparece aos montes nos
-- títulos), responsável, local e vínculo com lead/caso — e o calendário
-- (/hearings) e a aba Eventos já leem dela. Faltava só a perícia poder ser
-- criada de dentro da atividade, que é onde a equipe está quando a convocação
-- chega. As colunas abaixo dão à linha de `hearings` a âncora que o chip
-- precisa para achar de volta a perícia que ele mesmo criou.
--
-- POR QUE NÃO manter em lead_processes: a perícia é do benefício, mas 35% das
-- atividades de perícia não têm processo — a coluna do processo deixaria essas
-- de fora por construção. A âncora aqui degrada: processo → caso → lead.
--
-- POR QUE `origem`: o sync diário da planilha (railway-server/src/functions/
-- sync-hearings-from-sheet.ts) casa linhas por `nº do processo|data` e
-- sobrescreve hora/tipo/local/status do que casar. Marcando a procedência, ele
-- pode pular o que nasceu na atividade em vez de sobrescrever a data que a
-- equipe acabou de anotar. Não deleta nada hoje e continua não deletando.
--
-- As colunas pericia_medica_at/pericia_social_at NÃO são removidas: a única
-- linha preenchida é copiada abaixo, e manter a coluna é o rollback (basta
-- reverter o front). Remover fica para depois de o novo caminho rodar.
--
-- Rollback (reversível em <1min):
--   delete from public.hearings where origem = 'atividade';
--   alter table public.hearings drop column process_id, drop column activity_id, drop column origem;
--   drop index if exists hearings_process_id_idx;
--   drop index if exists hearings_pericia_atividade_uk;

alter table public.hearings
  add column if not exists process_id  uuid,
  add column if not exists activity_id uuid,
  add column if not exists origem      text;

comment on column public.hearings.process_id is
  'lead_processes.id do processo a que o evento pertence. Preenchido quando a perícia é marcada de dentro da atividade; a planilha não traz processo interno.';

comment on column public.hearings.activity_id is
  'lead_activities.id da atividade em que a data foi marcada — rastro de origem, não chave: a perícia é do processo/caso, não daquela atividade.';

comment on column public.hearings.origem is
  'Quem criou a linha: planilha (sync-hearings-from-sheet), atividade (chip de perícia no cabeçalho) ou manual (formulário da tela /hearings). O sync usa isto para não sobrescrever o que a equipe anotou.';

-- Procedência das 563 linhas que já existem: só o sync roda sem usuário, então
-- created_by nulo = planilha. Hoje isso é 562 planilha + 1 manual.
update public.hearings
   set origem = case when created_by is null then 'planilha' else 'manual' end
 where origem is null;

-- Sem CONCURRENTLY: 563 linhas, o lock é de milissegundos (mesma justificativa
-- da migration 20260813120000).
create index if not exists hearings_process_id_idx
  on public.hearings (process_id)
  where process_id is not null;

-- Uma perícia por âncora e tipo, e só entre as que nasceram na atividade: a
-- planilha legitimamente tem duas audiências do mesmo caso na mesma semana, e
-- um único índice sobre a tabela inteira quebraria o sync.
create unique index if not exists hearings_pericia_atividade_uk
  on public.hearings (coalesce(process_id, legal_case_id, lead_id), hearing_type)
  where origem = 'atividade' and deleted_at is null;

-- A única perícia que existia no caminho antigo (processo "Benefício INSS",
-- 1009384-22.2026.4.01.4000). timestamptz → data/hora LOCAL: `hearings` guarda
-- hora sem fuso, com o rótulo em timezone_label, e 2026-09-24 11:00+00 é
-- 08:00 em Brasília — que é o que a pessoa digitou.
insert into public.hearings (
  process_id, activity_id, lead_id, legal_case_id, process_number, hearing_type,
  category, hearing_date, hearing_time, timezone_label, status, notes, origem
)
select p.id, null, p.lead_id, p.case_id, p.process_number, 'Perícia Médica (INSS)',
       'previdenciario',
       (p.pericia_medica_at at time zone 'America/Sao_Paulo')::date,
       (p.pericia_medica_at at time zone 'America/Sao_Paulo')::time,
       'Padrão Brasília', 'ativa',
       'Migrada de lead_processes.pericia_medica_at em 19/08/2026.', 'atividade'
  from public.lead_processes p
 where p.pericia_medica_at is not null
   and not exists (
     select 1 from public.hearings h
      where h.origem = 'atividade'
        and h.deleted_at is null
        and h.hearing_type = 'Perícia Médica (INSS)'
        and coalesce(h.process_id, h.legal_case_id, h.lead_id) = coalesce(p.id, p.case_id, p.lead_id)
   );

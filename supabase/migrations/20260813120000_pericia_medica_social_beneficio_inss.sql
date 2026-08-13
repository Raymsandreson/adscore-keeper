-- Datas de PERÍCIA MÉDICA e PERÍCIA SOCIAL do Benefício INSS.
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA: a convocação da perícia chega por e-mail/Meu INSS e não tinha onde
-- morar. Quem trabalha a atividade ("Protocolar recurso administrativo no INSS",
-- "Cobrar perícia"…) anotava a data no corpo do texto ou na cabeça — não dava
-- pra ver a data no cabeçalho da atividade nem cruzar "quem tem perícia essa
-- semana". Benefício por incapacidade tem perícia MÉDICA; BPC/LOAS tem médica
-- + avaliação SOCIAL, e as duas são marcadas em datas diferentes.
--
-- ONDE MORA: no PROCESSO, não na atividade. A perícia é uma só por benefício —
-- gravada na atividade, cada atividade do mesmo processo teria a sua cópia, o
-- dado sumiria ao concluir/clonar a atividade e ninguém saberia qual é a boa.
-- No processo, quem preencher em qualquer atividade faz a data aparecer em
-- todas as outras daquele benefício e na ficha do processo.
--
-- POR QUE NÃO process_movements: aquela tabela é o histórico append-only dos
-- marcos JÁ OCORRIDOS (tipo_movimentacao='pericia', alimentado pelo detector do
-- Escavador) e não distingue médica de social. Aqui o que se guarda é a data
-- AGENDADA, que muda quando o INSS remarca — é estado do processo, não fato
-- histórico. Os dois convivem: a régua de marcos continua registrando a perícia
-- quando ela acontece.
--
-- timestamptz e não date: a convocação do INSS vem com hora marcada
-- (ex.: 14/08/2026 09:20) e a hora é o que decide o deslocamento do cliente.
--
-- Rollback (reversível em <1min, sem perda de dado além do preenchido):
--   alter table public.lead_processes drop column pericia_medica_at;
--   alter table public.lead_processes drop column pericia_social_at;
--   drop index if exists idx_lead_processes_pericia_medica_at;
--   drop index if exists idx_lead_processes_pericia_social_at;

alter table public.lead_processes
  add column if not exists pericia_medica_at timestamptz,
  add column if not exists pericia_social_at timestamptz;

comment on column public.lead_processes.pericia_medica_at is
  'Data/hora AGENDADA da perícia médica do benefício INSS (convocação do Meu INSS). Editável no cabeçalho da atividade vinculada ao processo. Marco já ocorrido continua em process_movements.';

comment on column public.lead_processes.pericia_social_at is
  'Data/hora AGENDADA da avaliação social (perícia social) do benefício INSS — existe em BPC/LOAS. Editável no cabeçalho da atividade vinculada ao processo.';

-- Índices parciais: só as linhas com perícia marcada entram (hoje ~1,5k linhas
-- na tabela inteira, a esmagadora maioria sem perícia). Servem à consulta que
-- vem a seguir — "quais perícias caem nos próximos dias" — sem varrer a tabela.
-- Sem CONCURRENTLY porque a tabela é pequena (o lock é de milissegundos).
create index if not exists idx_lead_processes_pericia_medica_at
  on public.lead_processes (pericia_medica_at)
  where pericia_medica_at is not null;

create index if not exists idx_lead_processes_pericia_social_at
  on public.lead_processes (pericia_social_at)
  where pericia_social_at is not null;

-- Retorno agendado NA ATIVIDADE (data e hora de voltar a falar com alguém).
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA: o front referencia `callback_at` desde jul/2026 — o formulário lê
-- (`setFormCallbackAt`), monta o payload de criação e de update, e o
-- minicalendário de pendentes ordena por ela (keyDate: meeting_at > callback_at
-- > deadline > notification_date). A coluna nunca foi criada. Consequências
-- medidas em 14/08/2026:
--   - `select` pedindo callback_at derrubava a query INTEIRA (PostgREST 42703),
--     zerando a lista de pendentes do SwitchActivityDialog em silêncio — por
--     isso a coluna está fora do select de lá, com um TODO apontando para cá.
--   - o update só inclui a chave quando o valor MUDA, e como nada preenche o
--     campo hoje (a prop `formCallbackAt` chega ao ActivityFormCompact mas
--     nenhum input a usa), o erro está dormente e não quebra o Salvar. Passaria
--     a quebrar no dia em que o input fosse adicionado sem esta coluna.
--
-- SOLUÇÃO: criar a coluna que o código já espera. timestamptz para casar com
-- `meeting_at` — o front grava ISO (`new Date(...).toISOString()`) e lê com
-- `parseISO`, então precisa guardar o instante com fuso, não uma data solta.
--
-- Sem índice de propósito: nenhuma query filtra nem ordena por callback_at no
-- servidor (a ordenação do minicalendário é feita no cliente). Se um dia
-- nascer um job de lembrete varrendo callbacks vencidos, o índice entra junto
-- com ele — parcial, sobre as não concluídas.
--
-- ADD COLUMN de timestamptz anulável não reescreve a tabela (Postgres 11+):
-- as 37.399 linhas existentes ficam NULL, sem lock longo.
--
-- Rollback: alter table public.lead_activities drop column callback_at;

alter table public.lead_activities
  add column if not exists callback_at timestamptz;

comment on column public.lead_activities.callback_at is
  'Retorno agendado (data e hora de voltar a falar com o cliente/parte). Entra no minicalendário de pendentes com prioridade abaixo de meeting_at e acima de deadline.';

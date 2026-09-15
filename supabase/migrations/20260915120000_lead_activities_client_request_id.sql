-- Idempotência da criação de atividade: o retry depois de RESPOSTA PERDIDA
-- precisa devolver a atividade que já existe, em vez de criar a segunda.
-- Aplicada no Supabase EXTERNO (kmedldlepwiityjsdahz) — tabela de negócio.
--
-- POR QUE O ÍNDICE DE DEDUP NÃO BASTAVA. `lead_activities_dedup_pending_idx`
-- (20260714050000) é PARCIAL: `WHERE status = 'pendente' AND deleted_at IS NULL
-- AND lead_id IS NOT NULL`. Dois dos quatro caminhos de criação do app nascem
-- `is_management` e SEM lead — o ditado e o "criar do zero" —, e para essas
-- linhas o índice simplesmente não existe. O tratamento de 23505 nesses dois
-- caminhos era código inalcançável (medido em 14/09/2026, ver
-- `docs/endpoint-criar-atividade.md` §1.1 do repo mobile). E são os dois de
-- maior risco: nascem em audiência, ônibus e sala de espera, que é onde a
-- resposta se perde.
--
-- O uuid é gerado pelo CLIENTE, por tentativa do usuário — o retry manda o
-- mesmo. Quem não passa pelo endpoint continua gravando NULL, e NULL não colide
-- em índice único: nada do que existe hoje muda de comportamento.
ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

-- Único de verdade, e não só consultado antes de inserir: duas tentativas
-- simultâneas do mesmo retry passam as duas pela consulta e chegam juntas ao
-- insert. É o índice que decide quem grava; o endpoint lê o 23505 e devolve a
-- linha que ficou, como `duplicated: true`.
CREATE UNIQUE INDEX IF NOT EXISTS lead_activities_client_request_id_idx
  ON public.lead_activities (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN public.lead_activities.client_request_id IS
  'Idempotência do endpoint create-activity: uuid do cliente, um por tentativa de criação do usuário (o retry repete). NULL em tudo que não passa pelo endpoint.';

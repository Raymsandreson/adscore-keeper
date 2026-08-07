-- Pendência do cliente ganha (1) vínculo com a atividade que nasceu dela e
-- (2) responsável próprio, trocável à mão.
--
-- Problema 1 — "Gerar atividade" não fechava o ciclo. O botão da caixa
-- (ActivitiesPage.openActivityFromCommitment) só pré-preenchia o formulário:
-- nada gravava que aquela pendência virou atividade, então ela continuava na
-- caixa e reaparecia no dia seguinte para quem já tinha resolvido. Sem coluna
-- de vínculo também não existia como voltar da pendência para a ficha da
-- atividade.
--
-- Problema 2 — responsável era 100% derivado. A view resolvia o dono por
-- cascata (processo > responsável processual do lead > último assessor > dono
-- da conversa > dono da linha) e não havia como corrigir um caso específico:
-- para trocar o responsável de UMA pendência era preciso mudar o dono do caso
-- ou da linha inteira. Medido em 07/08/2026 no Externo: 404 pendências
-- abertas, 267 sem responsável resolvido.
--
-- `assigned_to` entra como degrau ZERO do coalesce: quem não for trocado à mão
-- mantém exatamente o dono de hoje — nenhuma pendência muda de pessoa ao
-- aplicar esta migration.
--
-- Namespace: `assigned_to` guarda UUID do auth EXTERNO, igual a
-- `lead_activities.assigned_to` e aos demais degraus da cascata. Não passa por
-- `auth_uuid_mapping`.
--
-- Atenção ao subir: `tv_atividades_ranking` lê esta view, então trocar o
-- responsável de uma pendência move a contagem de pessoa no telão. É o
-- comportamento pretendido.
--
-- A view precisa de DROP + CREATE (não CREATE OR REPLACE): ela expande `c.*`,
-- e as colunas novas entrariam ANTES de `lead_name`/`owner_user_id` — o
-- Postgres recusa mudança de posição/nome de coluna existente.
--
-- Rollback (<1min):
--   reaplicar 20260807120000_owner_por_conversa_e_instancia.sql (recria a view
--   com a cascata de 5 degraus) e, se for o caso:
--   ALTER TABLE public.lead_client_commitments
--     DROP COLUMN activity_id, DROP COLUMN converted_at,
--     DROP COLUMN assigned_to, DROP COLUMN assigned_at;

-- 1. colunas novas (todas nulas: nenhuma linha é reescrita)
ALTER TABLE public.lead_client_commitments
  ADD COLUMN IF NOT EXISTS activity_id uuid
    REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

COMMENT ON COLUMN public.lead_client_commitments.activity_id IS
  'Atividade do escritório aberta a partir desta pendência (botão "Gerar atividade").';
COMMENT ON COLUMN public.lead_client_commitments.converted_at IS
  'Quando virou atividade. Sai da caixa de pendências abertas, mas continua em "Viraram atividade".';
COMMENT ON COLUMN public.lead_client_commitments.assigned_to IS
  'Responsável escolhido à mão (UUID do auth Externo). Degrau 0 da cascata de dono.';

-- A caixa lista as abertas que AINDA não viraram atividade; o filtro
-- "Viraram atividade" faz o caminho inverso.
CREATE INDEX IF NOT EXISTS lcc_convertidas_idx
  ON public.lead_client_commitments (converted_at)
  WHERE converted_at IS NOT NULL;

-- Filtro por responsável na caixa e no telão.
CREATE INDEX IF NOT EXISTS lcc_assigned_abertas_idx
  ON public.lead_client_commitments (assigned_to)
  WHERE status IN ('combinado','cobrado');

-- 2. view: `assigned_to` vira o primeiro degrau da cascata
DROP VIEW IF EXISTS public.vw_client_commitments_owner;

CREATE VIEW public.vw_client_commitments_owner AS
SELECT
  c.*,
  l.lead_name,
  COALESCE(
    -- 0. escolha explícita de quem cuida desta pendência
    c.assigned_to,
    (SELECT pr.responsible_user_id FROM lead_processes pr
      WHERE pr.lead_id = c.lead_id AND pr.responsible_user_id IS NOT NULL
      ORDER BY pr.created_at DESC LIMIT 1),
    (SELECT le.processual_responsible_id FROM leads le WHERE le.id = c.lead_id),
    (SELECT a.assigned_to FROM lead_activities a
      WHERE a.lead_id = c.lead_id AND a.deleted_at IS NULL AND a.assigned_to IS NOT NULL
      ORDER BY a.created_at DESC LIMIT 1),
    (SELECT wca.assigned_user_id FROM whatsapp_cloud_assignees wca
      WHERE wca.phone = c.phone
        AND lower(wca.instance_name) = lower(c.instance_name)
      LIMIT 1),
    (SELECT wi.owner_user_id FROM whatsapp_instances wi
      WHERE lower(wi.instance_name) = lower(c.instance_name)
        AND wi.owner_user_id IS NOT NULL
      LIMIT 1)
  ) AS owner_user_id
FROM public.lead_client_commitments c
LEFT JOIN public.leads l ON l.id = c.lead_id;

ALTER VIEW public.vw_client_commitments_owner SET (security_invoker = true);

GRANT SELECT ON public.vw_client_commitments_owner TO authenticated;

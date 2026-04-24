-- Deduplicar lead_checklist_instances mantendo a mais antiga,
-- preservando qualquer marcação de itens (merge dos checks)
WITH ranked AS (
  SELECT id, lead_id, board_id, stage_id, checklist_template_id, items, is_completed, completed_at, created_at,
         ROW_NUMBER() OVER (
           PARTITION BY lead_id, board_id, stage_id, checklist_template_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.lead_checklist_instances
),
keepers AS (
  SELECT lead_id, board_id, stage_id, checklist_template_id, MIN(id::text) FILTER (WHERE rn = 1) AS keep_id
  FROM ranked
  GROUP BY lead_id, board_id, stage_id, checklist_template_id
),
-- Para cada grupo, agregar todos os itens marcados como TRUE em qualquer duplicata
checked_items AS (
  SELECT r.lead_id, r.board_id, r.stage_id, r.checklist_template_id,
         jsonb_agg(DISTINCT item->>'id') FILTER (WHERE (item->>'checked')::boolean = true) AS checked_ids
  FROM public.lead_checklist_instances r,
       jsonb_array_elements(r.items) AS item
  GROUP BY r.lead_id, r.board_id, r.stage_id, r.checklist_template_id
)
-- Atualizar o keeper para refletir todos os itens marcados em qualquer duplicata
UPDATE public.lead_checklist_instances lci
SET items = (
  SELECT jsonb_agg(
    CASE WHEN ci.checked_ids ? (item->>'id')
      THEN jsonb_set(item, '{checked}', 'true'::jsonb)
      ELSE item
    END
  )
  FROM jsonb_array_elements(lci.items) AS item
)
FROM keepers k
JOIN checked_items ci
  ON ci.lead_id = k.lead_id AND ci.board_id = k.board_id
 AND ci.stage_id = k.stage_id AND ci.checklist_template_id = k.checklist_template_id
WHERE lci.id::text = k.keep_id
  AND ci.checked_ids IS NOT NULL;

-- Apagar duplicatas (manter só rn=1)
DELETE FROM public.lead_checklist_instances lci
USING (
  SELECT id
  FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY lead_id, board_id, stage_id, checklist_template_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
    FROM public.lead_checklist_instances
  ) t
  WHERE rn > 1
) dup
WHERE lci.id = dup.id;

-- Constraint única para impedir duplicatas futuras (race conditions)
ALTER TABLE public.lead_checklist_instances
  ADD CONSTRAINT lead_checklist_instances_unique
  UNIQUE (lead_id, board_id, stage_id, checklist_template_id);
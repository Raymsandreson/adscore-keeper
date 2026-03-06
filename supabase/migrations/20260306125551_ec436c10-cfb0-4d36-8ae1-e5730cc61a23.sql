
-- Remove 'lead' and 'nao_aderente' classifications
DELETE FROM public.contact_classifications WHERE name IN ('lead', 'nao_aderente');

-- Add 'equipe_interna' classification
INSERT INTO public.contact_classifications (name, color, display_order, is_system, show_in_workflow, description)
VALUES ('equipe_interna', 'bg-indigo-500', 14, true, true, 'Membro da equipe interna')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- Remove 'lead' and 'nao_aderente' from contacts classifications arrays
UPDATE public.contacts 
SET classifications = array_remove(classifications, 'lead')
WHERE 'lead' = ANY(classifications);

UPDATE public.contacts 
SET classifications = array_remove(classifications, 'nao_aderente')
WHERE 'nao_aderente' = ANY(classifications);

-- Update classification field
UPDATE public.contacts SET classification = NULL WHERE classification IN ('lead', 'nao_aderente');

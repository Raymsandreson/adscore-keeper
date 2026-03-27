
UPDATE kanban_boards 
SET stages = stages || '[{"id":"inviáveis","name":"Inviável","color":"#6b7280"}]'::jsonb,
    updated_at = now()
WHERE id = '2dcd54b5-502b-413b-b795-5e24a20797d2';

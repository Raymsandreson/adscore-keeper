UPDATE migration_progress
SET status = 'pending',
    -- joga ela pro fim da fila aumentando o ordering
    ordering = (SELECT COALESCE(MAX(ordering),0) + 100 FROM migration_progress),
    updated_at = now()
WHERE table_name = 'whatsapp_messages';
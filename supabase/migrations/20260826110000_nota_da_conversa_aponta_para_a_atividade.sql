-- Nota "Atividade Criada" da conversa passa a guardar qual atividade ela criou.
-- Sem isso o card do chat é só texto: não dá para abrir a ficha nem voltar da
-- ficha para a conversa de origem. Coluna nullable (notas antigas seguem válidas)
-- e sem FK: `lead_activities` vive no Supabase Externo, esta tabela no Cloud.
ALTER TABLE public.whatsapp_internal_notes
  ADD COLUMN IF NOT EXISTS activity_id UUID;

COMMENT ON COLUMN public.whatsapp_internal_notes.activity_id IS
  'Atividade (lead_activities, banco Externo) criada a partir desta conversa. Nulo em notas comuns.';

-- Caminho inverso (ficha -> conversa de origem) filtra por esta coluna.
CREATE INDEX IF NOT EXISTS idx_whatsapp_internal_notes_activity
  ON public.whatsapp_internal_notes(activity_id)
  WHERE activity_id IS NOT NULL;

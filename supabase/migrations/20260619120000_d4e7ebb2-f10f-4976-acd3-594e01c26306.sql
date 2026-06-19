-- Biblioteca de áudios prontos (notas de voz gravadas) para reenvio no chat WhatsApp.
-- Espelha o padrão de RLS de public.activity_message_templates (FOR ALL TO authenticated),
-- pois a sessão do banco externo (kmedldlepwiityjsdahz) opera como role `authenticated`.

CREATE TABLE IF NOT EXISTS public.saved_audios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT,
  file_path TEXT NOT NULL,        -- caminho no bucket whatsapp-media (ex: saved-audios/<id>.ogg)
  public_url TEXT NOT NULL,       -- URL pública usada no campo `file` da UazAPI
  mime_type TEXT NOT NULL DEFAULT 'audio/ogg',
  duration_sec INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Listagem da biblioteca ordena por mais recentes / por categoria.
CREATE INDEX IF NOT EXISTS idx_saved_audios_created_at ON public.saved_audios (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_audios_category ON public.saved_audios (category) WHERE category IS NOT NULL;

ALTER TABLE public.saved_audios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage saved audios" ON public.saved_audios;
CREATE POLICY "Authenticated users can manage saved audios"
ON public.saved_audios
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Testemunho de cliente vira post de Instagram (rascunho → revisão → publicação).
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- PROBLEMA: o agradecimento chega em áudio no WhatsApp, a transcrição fica na
-- conversa e morre ali. Virar post exigia copiar texto, montar arte à mão e
-- publicar pelo celular — ninguém faz. Aqui cada rascunho gerado (citação,
-- legenda e card prontos) fica registrado, passa por revisão humana no app e
-- só publica com clique explícito. NADA publica sozinho.
--
-- Rollback: DROP TABLE public.instagram_testimonial_posts;

CREATE TABLE IF NOT EXISTS public.instagram_testimonial_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- De onde veio o testemunho (mesma chave alternativa das pendências:
  -- conversa sem lead também gera post).
  source_message_id text,
  phone text,
  instance_name text,
  lead_id uuid,
  contact_id uuid,

  -- Nome completo detectado fica só aqui (interno); no card sai display_name,
  -- por padrão apenas o primeiro nome (LGPD — sem sobrenome sem consentimento).
  client_name text,
  display_name text,

  testimonial_text text NOT NULL,   -- transcrição/texto original, na íntegra
  quote_text text NOT NULL,         -- citação que aparece no card
  caption text NOT NULL,            -- legenda proposta (editável na revisão)

  image_path text,                  -- caminho no bucket whatsapp-media
  image_url text,                   -- URL pública usada pela Graph API

  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'publicado', 'descartado')),

  -- Preenchidos na publicação
  ig_user_id text,
  ig_media_id text,
  permalink text,
  published_at timestamptz,
  publish_error text,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS itp_status_idx
  ON public.instagram_testimonial_posts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS itp_source_message_idx
  ON public.instagram_testimonial_posts (source_message_id)
  WHERE source_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS itp_set_updated_at ON public.instagram_testimonial_posts;
CREATE TRIGGER itp_set_updated_at
  BEFORE UPDATE ON public.instagram_testimonial_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.instagram_testimonial_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS itp_authenticated_all ON public.instagram_testimonial_posts;
CREATE POLICY itp_authenticated_all ON public.instagram_testimonial_posts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

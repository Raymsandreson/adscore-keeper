-- Criar índice único em comment_id para permitir upsert
CREATE UNIQUE INDEX IF NOT EXISTS instagram_comments_comment_id_unique 
ON public.instagram_comments(comment_id) 
WHERE comment_id IS NOT NULL;

-- Criar tabela de posts externos (monitorados)
CREATE TABLE public.external_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  post_id TEXT,
  platform TEXT NOT NULL DEFAULT 'instagram',
  title TEXT,
  description TEXT,
  author_username TEXT,
  comments_count INTEGER DEFAULT 0,
  last_fetched_at TIMESTAMP WITH TIME ZONE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  news_links TEXT[],
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índice único para URL
CREATE UNIQUE INDEX external_posts_url_unique ON public.external_posts(url);

-- Habilitar RLS
ALTER TABLE public.external_posts ENABLE ROW LEVEL SECURITY;

-- Políticas RLS - usuários autenticados podem gerenciar
CREATE POLICY "Authenticated users can view external posts" 
ON public.external_posts FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create external posts" 
ON public.external_posts FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update external posts" 
ON public.external_posts FOR UPDATE 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete external posts" 
ON public.external_posts FOR DELETE 
USING (auth.uid() IS NOT NULL);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_external_posts_updated_at
BEFORE UPDATE ON public.external_posts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
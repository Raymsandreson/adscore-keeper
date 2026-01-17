-- Adicionar campos de funil e thread de conversa na tabela instagram_comments
ALTER TABLE public.instagram_comments 
ADD COLUMN IF NOT EXISTS funnel_stage text DEFAULT 'comment',
ADD COLUMN IF NOT EXISTS conversation_thread_id uuid DEFAULT NULL,
ADD COLUMN IF NOT EXISTS prospect_name text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;

-- Criar índices para melhorar performance das queries
CREATE INDEX IF NOT EXISTS idx_instagram_comments_funnel_stage ON public.instagram_comments(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_instagram_comments_thread ON public.instagram_comments(conversation_thread_id);

-- Comentário explicando os estágios do funil
COMMENT ON COLUMN public.instagram_comments.funnel_stage IS 'Estágios: comment, dm, whatsapp, visit_scheduled, visit_done, closed, post_sale';
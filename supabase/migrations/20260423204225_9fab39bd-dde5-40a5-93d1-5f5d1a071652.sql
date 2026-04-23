
-- Restaurar acesso à tabela whatsapp_instances quebrado pela migration anterior
-- O REVOKE total quebrou todas as queries do frontend (permission denied for table)

-- 1. Restaurar SELECT na tabela inteira
GRANT SELECT ON public.whatsapp_instances TO authenticated;

-- 2. Revogar SELECT APENAS na coluna sensível (instance_token)
-- Isso permite SELECT * funcionar (PostgREST faz expand das colunas permitidas),
-- mas bloqueia leitura explícita do token via .select('instance_token')
REVOKE SELECT (instance_token) ON public.whatsapp_instances FROM authenticated;

-- Garantir que anon não tem acesso
REVOKE ALL ON public.whatsapp_instances FROM anon;

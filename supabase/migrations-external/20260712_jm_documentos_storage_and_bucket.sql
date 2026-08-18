-- Arquivamento permanente dos PDFs de autos (Fluxo FIDC) — item #1 da fila viva.
--
-- Por que existe: jm_documentos.link_api guarda o link da API do Escavador, que EXPIRA em
-- ~7 dias (ticket de chapelaria que se autodestrói). PDF perdido = re-gastar crédito Escavador.
-- Solução: baixar o PDF enquanto o link vive e guardar permanente no Supabase Storage
-- (bucket privado), registrando o caminho em jm_documentos.storage_path.
--
-- O download em si NÃO consome crédito Escavador (verificado: header Creditos-Utilizados = 0).
-- O trabalho de baixar+subir é feito pela edge function esc-autos, ação "arquivar"
-- (ver supabase/functions/esc-autos/index.ts).
--
-- Bucket PRIVADO por LGPD: são sentenças/acordos com dado sensível. Acesso só via signed URL.
--
-- Banco: EXTERNO (kmedldlepwiityjsdahz). NÃO aplicar no Cloud.

-- 1) Colunas aditivas (não-destrutivas). Rollback = DROP COLUMN das três.
ALTER TABLE public.jm_documentos
  ADD COLUMN IF NOT EXISTS storage_path  text,
  ADD COLUMN IF NOT EXISTS stored_at     timestamptz,
  ADD COLUMN IF NOT EXISTS storage_error text;

COMMENT ON COLUMN public.jm_documentos.storage_path  IS 'Caminho do PDF arquivado no bucket privado jm-autos (ex: {cnj}/{id}.pdf). NULL = ainda nao arquivado.';
COMMENT ON COLUMN public.jm_documentos.stored_at     IS 'Quando o PDF foi baixado do Escavador e salvo no Storage.';
COMMENT ON COLUMN public.jm_documentos.storage_error IS 'Ultimo erro ao tentar arquivar (NULL = sem erro). Usado para retry direcionado.';

-- 2) Bucket privado, restrito a PDF, teto de 50MB. Rollback = DELETE FROM storage.buckets WHERE id='jm-autos'.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('jm-autos', 'jm-autos', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Retry direcionado dos que falharam (todos HTTP_404 na 1a passada, concentrados em poucos
-- processos): zerar storage_error e rodar de novo a acao "arquivar".
--   UPDATE public.jm_documentos SET storage_error = NULL WHERE storage_error LIKE 'HTTP_404%';

-- Dono ("atendente atribuído") de cada conversa do WhatsApp Cloud (número de gerência).
--
-- Por que existe: o round-robin (whatsapp-cloud-webhook.ts) escolhe um atendente, mas a
-- gravação antiga apontava para leads.assigned_to — coluna que NÃO existe na tabela leads
-- deste banco externo, então a atribuição nunca persistia. Esta tabela é a fonte de verdade
-- filtrável do "dono atual", usada pela inbox da WhatsApp API para visibilidade por atendente.
--
-- Escopo: somente instância cloud_gerencia. Instâncias UazAPI normais não usam esta tabela.
--
-- assigned_user_id é um ID do Supabase Cloud (mesmo espaço de profiles.user_id / auth.users.id),
-- pois eligible_user_ids das regras vêm de perfis Cloud. Compara direto com o user logado.
--
-- Banco: EXTERNO (kmedldlepwiityjsdahz). NÃO aplicar no Cloud.

CREATE TABLE IF NOT EXISTS public.whatsapp_cloud_assignees (
  phone            text NOT NULL,
  instance_name    text NOT NULL,
  assigned_user_id uuid NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, instance_name)
);

ALTER TABLE public.whatsapp_cloud_assignees ENABLE ROW LEVEL SECURITY;

-- Espelha a postura atual de conversations (leitura anon). O enforcement de visibilidade
-- por atendente é feito na UI; fechar por RLS é fase 2.
DROP POLICY IF EXISTS "read assignees" ON public.whatsapp_cloud_assignees;
CREATE POLICY "read assignees" ON public.whatsapp_cloud_assignees
  FOR SELECT USING (true);

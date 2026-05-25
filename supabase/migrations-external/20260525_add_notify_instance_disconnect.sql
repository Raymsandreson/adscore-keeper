-- Adiciona campo para controlar alerta de desconexão de instâncias WhatsApp
-- Default true para manter comportamento existente

ALTER TABLE public.whatsapp_notification_config
ADD COLUMN IF NOT EXISTS notify_instance_disconnect BOOLEAN DEFAULT true;

-- Atualiza registros existentes para manter comportamento atual
UPDATE public.whatsapp_notification_config
SET notify_instance_disconnect = true
WHERE notify_instance_disconnect IS NULL;

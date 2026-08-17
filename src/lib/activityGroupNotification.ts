import { authClient, db } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { isWhatsAppGroupId } from '@/lib/whatsappPhone';
import { resolveGroupSenderInstanceName } from '@/lib/whatsappGroupInstance';
import { toast } from 'sonner';

export interface GroupNotifyOptions {
  groupJid: string;
  message: string;
  sendAudio: boolean;
  audioText?: string;
}

/**
 * Notificação ao grupo do lead disparada pelo "Concluir + próxima"
 * (CompleteAndNotifyDialog).
 *
 * Vivia dentro da ActivitiesPage, o que deixava a ficha em aba lateral
 * (`ActivityFullSheet`) sem como enviar — o dialog oferecia notificar o grupo e
 * nada saía. Extraída aqui para que as duas telas usem exatamente o mesmo
 * caminho de envio (mesma instância remetente para texto e áudio).
 */
export async function sendActivityGroupNotification(
  options: GroupNotifyOptions,
  leadId: string | null,
): Promise<void> {
  try {
    // Instância remetente: grupo NUNCA usa o default pessoal — a mensagem é da
    // firma, não do usuário logado. Incidente 04/08/2026 (FAMÍLIA 250): o texto
    // saiu por "Atendimento Processual" (default legado gravado no Cloud, campo
    // que o ProfilePage nem escreve mais) enquanto o áudio do MESMO envio saiu
    // por "Atendimento Previdenciário", que já usava o helper. Mesmo critério do
    // sendVoiceToWa, pra texto e áudio saírem sempre pela mesma instância.
    let instanceId: string | undefined;
    let instanceName: string | undefined;
    if (isWhatsAppGroupId(options.groupJid)) {
      instanceName = await resolveGroupSenderInstanceName(options.groupJid);
    } else {
      // Alvo pessoa (não ocorre pelo dialog, que só oferece grupos): default do
      // perfil no EXTERNO, fonte da verdade. O homônimo no Cloud é legado.
      try {
        const { data: { user: authUser } } = await authClient.auth.getUser();
        const extUserId = await remapToExternal(authUser?.id || null);
        if (extUserId) {
          const { data: profile } = await db
            .from('profiles')
            .select('default_instance_id')
            .eq('user_id', extUserId)
            .maybeSingle();
          instanceId = (profile as { default_instance_id?: string | null } | null)?.default_instance_id || undefined;
        }
      } catch (e) {
        console.warn('[sendActivityGroupNotification] falha lendo profile:', e);
      }
    }

    // Send text message
    const sendBody: Record<string, unknown> = {
      phone: options.groupJid,
      chat_id: options.groupJid,
      message: options.message,
      lead_id: leadId || null,
    };
    if (instanceId) sendBody.instance_id = instanceId;
    if (instanceName) sendBody.instance_name = instanceName;

    const { data, error } = await cloudFunctions.invoke('send-whatsapp', { body: sendBody });
    if (error || !data?.success) {
      toast.error(data?.error || 'Erro ao enviar mensagem ao grupo');
    } else {
      toast.success('Mensagem enviada ao grupo!');
    }

    // Áudio, quando pedido. Cada etapa avisa o que aconteceu: antes o erro do
    // TTS era descartado e o `send_media` nem era conferido — sem `audio_url` o
    // bloco inteiro era pulado sem toast e sem log, e com URL o "Áudio enviado
    // ao grupo!" saía mesmo que o envio tivesse falhado. Quem usava só via o
    // "Mensagem enviada ao grupo!" do texto e concluía que tinha ido tudo.
    if (options.sendAudio) {
      if (!options.audioText?.trim()) {
        toast.error('Áudio não enviado: o texto da narração ficou vazio.');
        return;
      }

      const { data: ttsData, error: ttsError } = await cloudFunctions.invoke('elevenlabs-tts', {
        body: { text: options.audioText },
      });
      const audioUrl = (ttsData as { audio_url?: string } | null)?.audio_url;
      if (ttsError || !audioUrl) {
        const motivo =
          (ttsData as { error?: string } | null)?.error ||
          (ttsError instanceof Error ? ttsError.message : null) ||
          'a geração de voz não devolveu áudio';
        console.error('[sendActivityGroupNotification] TTS falhou:', ttsError || ttsData);
        toast.error(`Áudio não enviado: ${motivo}`);
        return;
      }

      const { data: mediaData, error: mediaError } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          action: 'send_media',
          phone: options.groupJid,
          chat_id: options.groupJid,
          media_url: audioUrl,
          media_type: 'audio/mpeg',
          lead_id: leadId || null,
          ...(instanceId ? { instance_id: instanceId } : {}),
          ...(instanceName ? { instance_name: instanceName } : {}),
        },
      });
      if (mediaError || !(mediaData as { success?: boolean } | null)?.success) {
        const motivo =
          (mediaData as { error?: string } | null)?.error ||
          (mediaError instanceof Error ? mediaError.message : null) ||
          'o envio ao grupo falhou';
        console.error('[sendActivityGroupNotification] envio do áudio falhou:', mediaError || mediaData);
        toast.error(`Áudio gerado, mas não foi ao grupo: ${motivo}`);
      } else {
        toast.success('Áudio enviado ao grupo!');
      }
    }
  } catch (e) {
    toast.error((e instanceof Error && e.message) || 'Erro ao notificar grupo');
  }
}

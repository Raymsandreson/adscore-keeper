import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/functionRouter';

/**
 * Envia um áudio (URL pública) como mensagem de voz (PTT) no WhatsApp,
 * transcodificando para ogg/opus antes para que apareça como voice-note e não como arquivo.
 *
 * @param audioUrl URL pública do áudio original (webm/mp4 do MediaRecorder).
 * @param target JID de grupo OU número de telefone/E.164.
 * @param leadId Lead vinculado (para atribuição no chat).
 * @param instanceIdOverride Instância a usar. Quando informada, pula a leitura do
 *   default_instance_id do profile (o chamador já escolheu a instância).
 */
export async function sendVoiceToWa(
  audioUrl: string,
  target: string,
  leadId?: string | null,
  instanceIdOverride?: string | null,
): Promise<void> {
  let mediaUrl = audioUrl;
  let mediaType = 'audio/ogg';

  // 1) Transcodifica pra ogg/opus (obrigatório pro WhatsApp reconhecer como PTT).
  try {
    const { data: tx, error: txErr } = await cloudFunctions.invoke('transcode-audio-opus', {
      body: { url: audioUrl, folder: 'activity-audio' },
    });
    if (!txErr && tx?.success && tx?.url) {
      mediaUrl = tx.url;
      mediaType = tx.mime || 'audio/ogg';
    } else {
      console.warn('[sendVoiceToWa] transcode falhou, enviando original:', tx?.error || txErr?.message);
    }
  } catch (txe) {
    console.warn('[sendVoiceToWa] transcode exceção, enviando original:', txe);
  }

  // 2) Descobre instância: usa o override do chamador, ou o default do profile.
  let instanceId: string | undefined = instanceIdOverride || undefined;
  if (!instanceId) {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', authUser.id)
          .maybeSingle();
        instanceId = (profile as any)?.default_instance_id || undefined;
      }
    } catch (e) {
      console.warn('[sendVoiceToWa] falha lendo profile:', e);
    }
  }

  // 3) Envia via edge send-whatsapp como PTT.
  const { data, error: sendErr } = await cloudFunctions.invoke('send-whatsapp', {
    body: {
      action: 'send_media',
      phone: target,
      chat_id: target,
      media_url: mediaUrl,
      media_type: mediaType,
      ptt: true,
      is_voice: true,
      lead_id: leadId || null,
      ...(instanceId ? { instance_id: instanceId } : {}),
    },
  });
  if (sendErr || !data?.success) {
    throw new Error(data?.error || sendErr?.message || 'Falha ao enviar áudio no WhatsApp');
  }
}

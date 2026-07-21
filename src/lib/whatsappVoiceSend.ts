import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/functionRouter';

/**
 * Envia um áudio (URL pública) como mensagem de voz (PTT) no WhatsApp.
 * O arquivo vai como foi gravado — quem converte para ogg/opus é a UazAPI.
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
  // 1) Envia a gravação ORIGINAL, sem transcodificar.
  //    Reencodar localmente com ffmpeg/libopus produz um ogg que o WhatsApp iOS
  //    não reproduz ("Este áudio não está mais disponível"). Verificado em
  //    21/07/2026 com 16k/32k/64k/128k e com -application lowdelay: todos falham
  //    no iPhone e tocam no Android/Web. Mandando o arquivo original, a UazAPI
  //    reencoda no formato dela, que toca nas três plataformas.
  const mediaUrl = audioUrl;
  const ext = (audioUrl.split('?')[0].split('.').pop() || '').toLowerCase();
  const mediaType =
    ext === 'mp4' || ext === 'm4a' ? 'audio/mp4'
    : ext === 'ogg' ? 'audio/ogg'
    : ext === 'mp3' ? 'audio/mpeg'
    : 'audio/webm';

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

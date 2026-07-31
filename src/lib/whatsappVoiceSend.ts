import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/functionRouter';
import { ensureExternalSession, externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { isWhatsAppGroupId } from '@/lib/whatsappPhone';
import { resolveGroupSenderInstanceName } from '@/lib/whatsappGroupInstance';

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

  // 2) Descobre instância: override do chamador > (grupo) instância-membro
  //    preferida > (pessoa) default do perfil no EXTERNO.
  let instanceId: string | undefined = instanceIdOverride || undefined;
  let instanceName: string | undefined;
  if (!instanceId && isWhatsAppGroupId(target)) {
    // Grupo NUNCA usa default pessoal: a mensagem é da firma, não do usuário
    // logado. Incidente 31/07/2026: o default legado gravado no Cloud (campo
    // que o ProfilePage nem escreve mais) mandou áudio de grupo pelo Raym.
    instanceName = await resolveGroupSenderInstanceName(target);
  } else if (!instanceId) {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      // default_instance_id vive no profiles do EXTERNO (fonte da verdade —
      // é lá que o ProfilePage salva). O campo homônimo no Cloud é legado e
      // pode apontar pra instância errada.
      const extUserId = await remapToExternal(authUser?.id || null);
      if (extUserId) {
        await ensureExternalSession();
        const { data: profile } = await externalSupabase
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', extUserId)
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
      ...(instanceName ? { instance_name: instanceName } : {}),
    },
  });
  if (sendErr || !data?.success) {
    throw new Error(data?.error || sendErr?.message || 'Falha ao enviar áudio no WhatsApp');
  }
}

import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';

const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

/**
 * Migrated from supabase/functions/whatsapp-call-queue-processor/index.ts
 * Behavior must remain identical. Runs every minute via pg_cron in Lovable Cloud.
 */
export async function handler(req: Request, res: Response): Promise<void> {
  try {
    // 1. Skip if there's an active call in progress (last 2 min)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: activeCalls } = await supabase
      .from('whatsapp_call_queue')
      .select('id')
      .eq('status', 'calling')
      .gte('updated_at', twoMinAgo)
      .limit(1);

    if (activeCalls && activeCalls.length > 0) {
      res.status(200).json({ skipped: true, reason: 'Call in progress' });
      return;
    }

    // 2. Get next pending call
    const now = new Date().toISOString();
    const { data: nextCall } = await supabase
      .from('whatsapp_call_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('priority', { ascending: false })
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!nextCall) {
      res.status(200).json({ skipped: true, reason: 'No pending calls' });
      return;
    }

    // 3. Mark as calling
    await supabase
      .from('whatsapp_call_queue')
      .update({
        status: 'calling',
        attempts: (nextCall as any).attempts + 1,
        last_attempt_at: now,
        updated_at: now,
      } as any)
      .eq('id', (nextCall as any).id);

    // 4. Get instance
    const instanceName = (nextCall as any).instance_name;
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('base_url, instance_token, instance_name, voice_id, owner_name')
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (!instance) {
      await supabase
        .from('whatsapp_call_queue')
        .update({
          status: 'failed',
          last_result: 'Instance not found',
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', (nextCall as any).id);

      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    // 5. Make call via UazAPI
    const baseUrl = (instance as any).base_url;
    const token = (instance as any).instance_token;
    const phone = (nextCall as any).phone;

    console.log(`[call-queue] Initiating call to ${phone} via ${instanceName}`);

    const callResp = await fetch(`${baseUrl}/call/make`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: phone }),
    });

    const respText = await callResp.text();
    let respJson: any = {};
    try { respJson = JSON.parse(respText); } catch { /* not json */ }

    console.log(`[call-queue] UazAPI response for ${phone}: status=${callResp.status} body=${respText.substring(0, 500)}`);

    let callResult = 'unknown';
    const hasError =
      respJson?.error ||
      respJson?.message?.toLowerCase?.()?.includes?.('erro') ||
      respJson?.message?.toLowerCase?.()?.includes?.('desconectado');

    if (callResp.ok && !hasError) {
      callResult = 'initiated';
      console.log(`[call-queue] Call initiated to ${phone}`);
    } else {
      callResult = `error: ${callResp.status} - ${respText.substring(0, 200)}`;
      console.error(`[call-queue] Call failed: ${callResult}`);
    }

    // 6. Update queue status
    const maxAttempts = (nextCall as any).max_attempts || 3;
    const currentAttempts = (nextCall as any).attempts + 1;
    const newStatus =
      callResult === 'initiated'
        ? 'completed'
        : currentAttempts >= maxAttempts
          ? 'failed'
          : 'pending';

    const updatePayload: any = {
      status: newStatus,
      last_result: callResult,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === 'pending') {
      updatePayload.scheduled_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }

    await supabase.from('whatsapp_call_queue').update(updatePayload).eq('id', (nextCall as any).id);

    // 7. Create call record + send follow-up audio
    if (callResult === 'initiated') {
      await supabase.from('call_records').insert({
        call_type: 'outbound',
        call_result: 'em_andamento',
        contact_phone: phone,
        contact_name: (nextCall as any).contact_name,
        lead_id: (nextCall as any).lead_id,
        lead_name: (nextCall as any).lead_name,
        phone_used: instanceName,
        notes: 'Chamada automática via discadora IA',
        tags: ['whatsapp', 'automatico', 'discadora'],
        user_id: '00000000-0000-0000-0000-000000000000',
      });

      await sendCallFollowupAudio(
        phone,
        instanceName,
        instance,
        (nextCall as any).contact_name || (nextCall as any).lead_name,
      );
    }

    res.status(200).json({
      success: true,
      call_result: callResult,
      phone,
      instance: instanceName,
      attempt: currentAttempts,
    });
  } catch (e) {
    console.error('[call-queue] processor error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
}

async function sendCallFollowupAudio(
  phone: string,
  instanceName: string,
  instance: any,
  contactName: string | null,
): Promise<void> {
  try {
    if (!ELEVENLABS_API_KEY) {
      console.log('[call-queue] No ElevenLabs key, skipping call follow-up audio');
      return;
    }

    const { data: convAgent } = await supabase
      .from('whatsapp_conversation_agents')
      .select('agent_id')
      .like('phone', `%${phone.slice(-8)}%`)
      .eq('is_active', true)
      .maybeSingle();

    if (!convAgent?.agent_id) {
      console.log('[call-queue] No active agent for phone, skipping call follow-up audio');
      return;
    }

    const { data: agent } = await supabase
      .from('wjia_command_shortcuts')
      .select('shortcut_name, reply_voice_id, base_prompt, send_call_followup_audio, reply_with_audio')
      .eq('id', convAgent.agent_id)
      .maybeSingle();

    const shouldSendAudio = agent?.send_call_followup_audio || agent?.reply_with_audio;
    if (!shouldSendAudio) {
      console.log('[call-queue] Agent has neither flag enabled, skipping');
      return;
    }

    let voiceId = 'FGY2WhTYpPnrIDTdsKH5';
    const agentName = agent.shortcut_name || 'Assistente';
    const followupPrompt = agent.base_prompt || '';

    if (agent.reply_voice_id === 'instance_owner') {
      const instanceVoice = (instance as any).voice_id;
      if (instanceVoice) {
        voiceId = instanceVoice;
        console.log(`[call-queue] Resolved instance_owner voice to: ${voiceId}`);
      }
    } else if (agent.reply_voice_id) {
      if (agent.reply_voice_id.length === 36 && agent.reply_voice_id.includes('-')) {
        const { data: cv } = await supabase
          .from('custom_voices')
          .select('elevenlabs_voice_id')
          .eq('id', agent.reply_voice_id)
          .eq('status', 'ready')
          .maybeSingle();
        voiceId = cv?.elevenlabs_voice_id || voiceId;
      } else {
        voiceId = agent.reply_voice_id;
      }
    }

    const { data: recentMsgs } = await supabase
      .from('whatsapp_messages')
      .select('direction, message_text')
      .like('phone', `%${phone.slice(-8)}%`)
      .eq('instance_name', instanceName)
      .order('created_at', { ascending: false })
      .limit(10);

    const contextLines = (recentMsgs || [])
      .reverse()
      .map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : agentName}: ${m.message_text || '(mídia)'}`)
      .join('\n');

    const firstName = contactName?.split(' ')[0] || 'cliente';

    // Call Lovable AI Gateway directly (OpenAI-compatible API)
    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Você é ${agentName}. Você acabou de ligar para o(a) ${firstName} mas a ligação não foi atendida ou foi breve. Agora você vai enviar um áudio curto e natural no WhatsApp avisando que tentou ligar e reforçando o assunto da conversa. Seja empático, natural, use português brasileiro informal (tá, pra, tô). MÁXIMO 3 frases curtas. NÃO use listas ou bullets. ${followupPrompt ? `\nContexto do agente: ${followupPrompt}` : ''}`,
          },
          {
            role: 'user',
            content: `Contexto da conversa recente:\n${contextLines || '(sem mensagens anteriores)'}\n\nGere uma mensagem curta e natural avisando que tentou ligar e pedindo pra retornar ou continuar pelo WhatsApp.`,
          },
        ],
      }),
    });

    if (!aiResp.ok) {
      console.error('[call-queue] AI gateway error:', aiResp.status, await aiResp.text());
      return;
    }

    const aiResult: any = await aiResp.json();
    const followupText = aiResult.choices?.[0]?.message?.content?.trim();
    if (!followupText) {
      console.log('[call-queue] No AI text generated');
      return;
    }

    console.log(`[call-queue] Follow-up text for ${phone}: ${followupText.substring(0, 100)}`);

    const ttsResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: followupText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 1.1 },
        }),
      },
    );

    if (!ttsResp.ok) {
      console.error('[call-queue] ElevenLabs TTS error:', ttsResp.status);
      return;
    }

    const audioBuffer = await ttsResp.arrayBuffer();
    const fileName = `tts-call-followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const filePath = `tts/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, new Uint8Array(audioBuffer), { contentType: 'audio/mpeg', upsert: false });

    if (uploadErr) {
      console.error('[call-queue] Upload error:', uploadErr);
      return;
    }

    const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(filePath);
    const audioUrl = urlData?.publicUrl;
    if (!audioUrl) return;

    await new Promise(r => setTimeout(r, 5000));

    const baseUrl = (instance as any).base_url;
    const token = (instance as any).instance_token;

    const sendRes = await fetch(`${baseUrl}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: phone, file: audioUrl, type: 'audio' }),
    });

    if (!sendRes.ok) {
      console.error('[call-queue] Send audio error:', sendRes.status);
    } else {
      console.log(`[call-queue] Follow-up audio sent to ${phone}`);
    }

    await supabase.from('whatsapp_messages').insert({
      phone,
      instance_name: instanceName,
      message_text: `🎤 ${followupText}`,
      message_type: 'audio',
      direction: 'outbound',
      external_message_id: `call_followup_${Date.now()}`,
      action_source: 'system',
      action_source_detail: 'Call follow-up audio',
    });
  } catch (e) {
    console.error('[call-queue] follow-up audio error:', e);
  }
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { geminiChat } from "../_shared/gemini.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Meta WhatsApp Cloud API - Calling Webhook
// Handles: webhook verification (GET) + call event notifications (POST)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ===== GET: Webhook Verification (Meta challenge) =====
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = Deno.env.get('META_CALLING_VERIFY_TOKEN') || 'abraci_calling_2026';

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Meta Calling webhook verified successfully');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // ===== POST: Call Event Notifications =====
  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log('Meta Calling webhook payload:', JSON.stringify(body).substring(0, 3000));

    // Meta sends: { object: "whatsapp_business_account", entry: [...] }
    if (body.object !== 'whatsapp_business_account') {
      console.log('Ignoring non-whatsapp event:', body.object);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        // Call events come in field: "calls"
        if (change.field === 'calls') {
          await processCallEvent(supabase, change.value, entry.id);
        }
        // Message status updates can also carry call info
        if (change.field === 'messages') {
          const value = change.value || {};
          // Check for voice_call type messages
          for (const msg of value.messages || []) {
            if (msg.type === 'voice_call' || msg.type === 'call') {
              await processMessageCallEvent(supabase, msg, value, entry.id);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Meta Calling webhook error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processCallEvent(supabase: any, value: any, wabaId: string) {
  console.log('Processing Cloud API call event:', JSON.stringify(value).substring(0, 1500));

  const callEvent = value;
  const phone = callEvent.from || callEvent.caller_id || '';
  const cleanPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
  const status = (callEvent.status || callEvent.state || '').toLowerCase();
  const callId = callEvent.call_id || callEvent.id || `meta_${Date.now()}`;
  const direction = callEvent.direction || (callEvent.from_me ? 'outbound' : 'inbound');
  const duration = callEvent.duration || callEvent.duration_seconds || 0;

  console.log('Call event details:', { cleanPhone, status, callId, direction, duration });

  if (!cleanPhone) {
    console.log('No phone number in call event, skipping');
    return;
  }

  // Map Meta statuses to our system
  // Meta states: ringing, in_progress, completed, missed, declined, failed
  if (['ringing', 'initiated'].includes(status)) {
    // Save pending event for duration calculation
    await supabase.from('call_events_pending').insert({
      call_id: callId,
      phone: cleanPhone,
      contact_name: callEvent.caller_name || null,
      event_type: 'offer',
      from_me: direction === 'outbound',
      instance_name: `meta_cloud_${wabaId}`,
    });
    console.log('Saved ringing/initiated event for call:', callId);
    return;
  }

  if (status === 'in_progress') {
    await supabase.from('call_events_pending').insert({
      call_id: callId,
      phone: cleanPhone,
      contact_name: callEvent.caller_name || null,
      event_type: 'accept',
      from_me: direction === 'outbound',
      instance_name: `meta_cloud_${wabaId}`,
    });
    console.log('Saved in_progress event for call:', callId);
    return;
  }

  // Terminal states: completed, missed, declined, failed
  if (!['completed', 'missed', 'declined', 'failed', 'ended', 'terminated'].includes(status)) {
    console.log('Non-terminal call status, skipping record creation:', status);
    return;
  }

  // Look up pending events for duration calculation
  const { data: pendingEvents } = await supabase
    .from('call_events_pending')
    .select('*')
    .eq('call_id', callId)
    .order('created_at', { ascending: true });

  const acceptEvent = pendingEvents?.find((e: any) => e.event_type === 'accept');
  const offerEvent = pendingEvents?.find((e: any) => e.event_type === 'offer');

  // Calculate duration
  let durationSeconds = duration;
  if (!durationSeconds && acceptEvent) {
    const acceptTime = new Date(acceptEvent.created_at).getTime();
    durationSeconds = Math.round((Date.now() - acceptTime) / 1000);
  }

  // Determine call result
  let callResult = 'atendeu';
  if (status === 'missed' || status === 'declined' || status === 'failed') {
    callResult = status === 'declined' ? 'ocupado' : 'não_atendeu';
    durationSeconds = 0;
  }

  const isOutbound = offerEvent?.from_me || direction === 'outbound';
  const callType = isOutbound ? 'realizada' : 'recebida';
  const contactName = offerEvent?.contact_name || callEvent.caller_name || null;

  // Clean up pending events
  if (pendingEvents?.length) {
    await supabase.from('call_events_pending').delete().eq('call_id', callId);
  }

  // Look up contact/lead by phone
  const { contactId, leadId, leadName } = await lookupContactLead(supabase, cleanPhone);

  // Get admin user for record ownership
  const { data: adminRole } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (!adminRole?.user_id) {
    console.error('No admin user found for call record');
    return;
  }

  // AI transcription if audio available
  let aiSummary: string | null = null;
  let aiTranscript: string | null = null;
  const audioUrl = callEvent.audio_url || callEvent.media_url || null;

  if (audioUrl && callResult === 'atendeu' && durationSeconds > 5) {
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (apiKey) {
      const result = await transcribeAudio(audioUrl, apiKey);
      if (result) {
        aiSummary = result.summary;
        aiTranscript = result.transcript;
      }
    }
  }

  const { data: record, error } = await supabase
    .from('call_records')
    .insert({
      user_id: adminRole.user_id,
      call_type: callType,
      call_result: callResult,
      duration_seconds: durationSeconds,
      contact_id: contactId,
      lead_id: leadId,
      lead_name: leadName || contactName,
      contact_name: contactName,
      contact_phone: cleanPhone,
      phone_used: 'whatsapp_cloud',
      ai_summary: aiSummary,
      ai_transcript: aiTranscript,
      audio_url: audioUrl,
      notes: `Chamada WhatsApp Cloud API (${callType}). WABA: ${wabaId}`,
      tags: ['whatsapp', 'cloud_api', 'automatico'],
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating call record:', error);
  } else {
    console.log('Call record created via Cloud API:', record.id, 'duration:', durationSeconds);
  }
}

async function processMessageCallEvent(supabase: any, msg: any, value: any, wabaId: string) {
  // Handle voice_call type messages from the messages webhook field
  const phone = msg.from || '';
  const cleanPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
  
  console.log('Processing voice_call message event:', { phone: cleanPhone, type: msg.type });
  
  await processCallEvent(supabase, {
    from: cleanPhone,
    status: 'completed',
    call_id: msg.id || `msg_call_${Date.now()}`,
    direction: 'inbound',
    duration: msg.voice_call?.duration || 0,
    caller_name: value.contacts?.[0]?.profile?.name || null,
    audio_url: msg.voice_call?.url || null,
  }, wabaId);
}

async function lookupContactLead(supabase: any, phone: string) {
  let contactId: string | null = null;
  let leadId: string | null = null;
  let leadName: string | null = null;

  const phoneVariants = [phone, `+${phone}`, phone.replace(/^55/, '')];
  for (const variant of phoneVariants) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, lead_id, full_name')
      .or(`phone.ilike.%${variant}`)
      .limit(1);
    if (contacts?.length) {
      contactId = contacts[0].id;
      leadId = contacts[0].lead_id;
      break;
    }
  }

  if (!leadId) {
    for (const variant of phoneVariants) {
      const { data: leads } = await supabase
        .from('leads')
        .select('id, lead_name')
        .or(`lead_phone.ilike.%${variant}`)
        .limit(1);
      if (leads?.length) {
        leadId = leads[0].id;
        leadName = leads[0].lead_name;
        break;
      }
    }
  }

  return { contactId, leadId, leadName };
}

async function transcribeAudio(audioUrl: string, _apiKey: string) {
  try {
    const data = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Você é um assistente jurídico. Transcreva o áudio e forneça um resumo objetivo." },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcreva este áudio e forneça:\nTRANSCRIÇÃO:\n[transcrição]\n\nRESUMO:\n[resumo]" },
            { type: "input_audio", input_audio: { url: audioUrl, format: "wav" } }
          ]
        }
      ],
    });

    const content = data.choices?.[0]?.message?.content || "";
    const transcriptMatch = content.match(/TRANSCRIÇÃO:\s*([\s\S]*?)(?=RESUMO:|$)/i);
    const summaryMatch = content.match(/RESUMO:\s*([\s\S]*?)$/i);

    return {
      transcript: transcriptMatch?.[1]?.trim() || content,
      summary: summaryMatch?.[1]?.trim() || "",
    };
  } catch (e) {
    console.error("Transcription error:", e);
    return null;
  }
}

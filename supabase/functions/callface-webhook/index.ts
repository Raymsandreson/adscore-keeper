import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const payload = await req.json();
    console.log('CallFace webhook received:', JSON.stringify(payload));

    const {
      deal_id,
      contact_id,
      summarization,
      transcription,
      user_email,
      user_name,
      destination_number,
      call_audio_url,
      call_link,
      call_date,
      call_duration,
      call_type,
      call_status,
      credentials,
    } = payload;

    const supabase = createClient(
      RESOLVED_SUPABASE_URL,
      RESOLVED_SERVICE_ROLE_KEY
    );

    // Try to find the user by email (from credentials or direct field)
    let userId: string | null = null;
    const resolvedEmail = user_email || credentials?.user_email;
    if (resolvedEmail) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .eq('email', resolvedEmail)
        .maybeSingle();
      userId = profile?.user_id || null;
    }

    // Normalize destination number to find contact/lead
    const normalizedPhone = destination_number?.replace(/\D/g, '') || '';
    
    // Try to find existing contact by phone
    let contactDbId: string | null = null;
    let leadId: string | null = null;
    let leadName: string | null = null;
    let contactName: string | null = null;

    if (normalizedPhone) {
      const phoneSuffix = normalizedPhone.slice(-8);
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, full_name, lead_id')
        .or(`phone.ilike.%${phoneSuffix}%`)
        .limit(1);

      if (contacts && contacts.length > 0) {
        contactDbId = contacts[0].id;
        contactName = contacts[0].full_name;
        leadId = contacts[0].lead_id;
      }

      // Also check leads directly
      if (!leadId) {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, lead_name')
          .or(`lead_phone.ilike.%${phoneSuffix}%`)
          .limit(1);

        if (leads && leads.length > 0) {
          leadId = leads[0].id;
          leadName = leads[0].lead_name;
        }
      }

      if (leadId && !leadName) {
        const { data: lead } = await supabase
          .from('leads')
          .select('lead_name')
          .eq('id', leadId)
          .maybeSingle();
        leadName = lead?.lead_name || null;
      }
    }

    // Format phone for display
    let formattedPhone = destination_number || normalizedPhone;
    if (normalizedPhone.startsWith('55') && normalizedPhone.length >= 12) {
      const ddd = normalizedPhone.slice(2, 4);
      const rest = normalizedPhone.slice(4);
      formattedPhone = `+55 (${ddd}) ${rest.length === 9 ? rest.slice(0, 5) + '-' + rest.slice(5) : rest.slice(0, 4) + '-' + rest.slice(4)}`;
    }

    // Determine call result
    const resolvedResult = call_status === 'answered' || call_status === 'completed' ? 'completed' 
      : call_status === 'no_answer' ? 'nao_atendeu'
      : call_status === 'busy' ? 'ocupado'
      : call_status || 'completed';

    // Build notes
    const notesParts = [
      call_link ? `🔗 CallFace: ${call_link}` : null,
      deal_id ? `Deal ID: ${deal_id}` : null,
      contact_id ? `Contact ID: ${contact_id}` : null,
      user_name ? `Vendedor: ${user_name}` : null,
    ].filter(Boolean);

    // Create call record with CallFace insights
    const { error: insertError } = await supabase
      .from('call_records')
      .insert({
        user_id: userId || '00000000-0000-0000-0000-000000000000',
        call_type: call_type || 'outbound',
        call_result: resolvedResult,
        contact_id: contactDbId,
        contact_name: contactName || null,
        contact_phone: formattedPhone,
        lead_id: leadId,
        lead_name: leadName,
        duration_seconds: call_duration || null,
        ai_summary: summarization || null,
        ai_transcript: transcription || null,
        audio_url: call_audio_url || null,
        notes: notesParts.length > 0 ? notesParts.join('\n') : null,
        phone_used: 'callface',
        tags: ['callface'],
      });

    if (insertError) {
      console.error('Error inserting call record:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save call record' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If we have a lead, update followup counters
    if (leadId) {
      await supabase
        .from('leads')
        .update({
          last_followup_at: new Date().toISOString(),
        })
        .eq('id', leadId);
    }

    console.log('CallFace insight saved successfully', { contactDbId, leadId, userId });
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('CallFace webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

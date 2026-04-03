import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const externalClient = createClient(resolveSupabaseUrl(), resolveServiceRoleKey());
    const cloudClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const instanceName = body.instance_name || null;
    const daysBack = Math.min(body.days_back || 7, 30);
    const since = new Date(Date.now() - daysBack * 86400000).toISOString();

    // Fetch recent outbound messages from external DB
    let query = externalClient
      .from('whatsapp_messages')
      .select('phone, instance_name, message_text, message_type, direction, contact_name, contact_id, lead_id, external_message_id, created_at, campaign_id, campaign_name, action_source, action_source_detail, metadata')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(1000);

    if (instanceName) {
      query = query.eq('instance_name', instanceName);
    }

    const { data: extMessages, error: extErr } = await query;
    if (extErr) throw extErr;
    if (!extMessages?.length) {
      return new Response(JSON.stringify({ success: true, synced: 0, message: 'No messages to sync' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get existing message IDs from cloud to avoid duplicates
    const extIds = extMessages.map(m => m.external_message_id).filter(Boolean);
    const { data: existingCloud } = await cloudClient
      .from('whatsapp_messages')
      .select('external_message_id')
      .in('external_message_id', extIds.slice(0, 500));

    const existingSet = new Set((existingCloud || []).map(m => m.external_message_id));

    // Also check by phone+created_at for messages without external_message_id
    const phoneDates = extMessages.filter(m => !m.external_message_id).map(m => `${m.phone}_${m.created_at}`);
    let existingByDate = new Set<string>();
    if (phoneDates.length > 0) {
      const phones = [...new Set(extMessages.filter(m => !m.external_message_id).map(m => m.phone))];
      const { data: cloudByPhone } = await cloudClient
        .from('whatsapp_messages')
        .select('phone, created_at')
        .in('phone', phones.slice(0, 100))
        .gte('created_at', since);
      existingByDate = new Set((cloudByPhone || []).map(m => `${m.phone}_${m.created_at}`));
    }

    // Filter out already-synced messages
    const toInsert = extMessages.filter(m => {
      if (m.external_message_id && existingSet.has(m.external_message_id)) return false;
      if (!m.external_message_id && existingByDate.has(`${m.phone}_${m.created_at}`)) return false;
      return true;
    });

    if (toInsert.length === 0) {
      return new Response(JSON.stringify({ success: true, synced: 0, message: 'All messages already synced' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert in batches of 100
    let synced = 0;
    let errors = 0;
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      const { error: insertErr } = await cloudClient.from('whatsapp_messages').insert(batch);
      if (insertErr) {
        console.error('Batch insert error:', insertErr.message);
        errors += batch.length;
      } else {
        synced += batch.length;
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      total_external: extMessages.length, 
      already_synced: extMessages.length - toInsert.length,
      synced, 
      errors,
      instance: instanceName || 'all',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('sync-messages-to-cloud error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

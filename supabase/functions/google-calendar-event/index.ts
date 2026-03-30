import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function refreshToken(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const supabase = createClient(
    RESOLVED_SUPABASE_URL,
    RESOLVED_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const body = await req.json();
  const { title, description, scheduled_at, action_type, contact_name, contact_phone, contact_instagram, message_text, notes } = body;

  const serviceSupabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
  const { data: tokenRow } = await serviceSupabase
    .from('google_oauth_tokens')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: 'google_not_connected' }), { status: 400, headers: corsHeaders });
  }

  let accessToken = tokenRow.access_token;

  if (tokenRow.expires_at && new Date(tokenRow.expires_at) <= new Date() && tokenRow.refresh_token) {
    const newToken = await refreshToken(tokenRow.refresh_token);
    if (newToken) {
      accessToken = newToken;
      await serviceSupabase.from('google_oauth_tokens').update({
        access_token: newToken,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      }).eq('user_id', user.id);
    }
  }

  const startTime = new Date(scheduled_at);
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 min duration

  const eventTypeLabel = action_type === 'call' ? '📞 Ligação' : '💬 Mensagem WhatsApp';
  const eventDescription = [
    description || '',
    contact_name ? `Contato: ${contact_name}` : '',
    contact_phone ? `Telefone: ${contact_phone}` : '',
    contact_instagram ? `Instagram: @${contact_instagram}` : '',
    message_text ? `Mensagem: "${message_text}"` : '',
    notes ? `Observações: ${notes}` : '',
  ].filter(Boolean).join('\n');

  const event = {
    summary: title || `${eventTypeLabel} - ${contact_name || 'Contato'}`,
    description: eventDescription,
    start: { dateTime: startTime.toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: endTime.toISOString(), timeZone: 'America/Sao_Paulo' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 10 },
        { method: 'email', minutes: 30 },
      ],
    },
  };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Google Calendar API error:', data);
    return new Response(JSON.stringify({ error: 'google_api_error', details: data }), { status: 500, headers: corsHeaders });
  }

  // Save scheduled action to DB
  await serviceSupabase.from('google_scheduled_actions').insert({
    user_id: user.id,
    action_type: action_type || 'whatsapp_message',
    contact_name: contact_name || null,
    contact_phone: contact_phone || null,
    contact_instagram: contact_instagram || null,
    message_text: message_text || null,
    scheduled_at: startTime.toISOString(),
    google_event_id: data.id,
    calendar_event_link: data.htmlLink,
    notes: notes || null,
  });

  return new Response(JSON.stringify({ success: true, event: data, calendar_link: data.htmlLink }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

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

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
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

  try {
    const supabase = createClient(
      RESOLVED_SUPABASE_URL,
      RESOLVED_SERVICE_ROLE_KEY
    );

    const body = await req.json();
    const { user_id, days_ahead = 5, slot_duration_minutes = 30 } = body;

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Google OAuth token for this user
    const { data: tokenRow } = await supabase
      .from('google_oauth_tokens')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: 'google_not_connected', slots: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let accessToken = tokenRow.access_token;

    // Refresh if expired
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) <= new Date() && tokenRow.refresh_token) {
      const newToken = await refreshAccessToken(tokenRow.refresh_token);
      if (newToken) {
        accessToken = newToken;
        await supabase.from('google_oauth_tokens').update({
          access_token: newToken,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        }).eq('user_id', user_id);
      }
    }

    // Get busy times from Google Calendar FreeBusy API
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setHours(8, 0, 0, 0); // Start from 8am today
    if (timeMin < now) {
      // If it's already past 8am, start from next hour
      timeMin.setTime(now.getTime());
      timeMin.setMinutes(0, 0, 0);
      timeMin.setHours(timeMin.getHours() + 1);
    }

    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + days_ahead);
    timeMax.setHours(18, 0, 0, 0);

    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: 'America/Sao_Paulo',
        items: [{ id: 'primary' }],
      }),
    });

    const freeBusyData = await freeBusyRes.json();

    if (!freeBusyRes.ok) {
      console.error('FreeBusy API error:', freeBusyData);
      return new Response(JSON.stringify({ error: 'google_api_error', details: freeBusyData }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const busySlots = freeBusyData?.calendars?.primary?.busy || [];

    // Generate available slots (business hours: 9am-17pm, Mon-Fri)
    const slots: { date: string; time: string; datetime: string }[] = [];
    const slotMs = slot_duration_minutes * 60 * 1000;

    for (let d = 0; d <= days_ahead; d++) {
      const day = new Date(now);
      day.setDate(day.getDate() + d);

      // Skip weekends
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue;

      const dayStr = day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

      // Generate slots from 9:00 to 17:00
      for (let hour = 9; hour < 17; hour++) {
        for (let min = 0; min < 60; min += slot_duration_minutes) {
          const slotStart = new Date(day);
          slotStart.setHours(hour, min, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + slotMs);

          // Skip past slots
          if (slotStart < now) continue;

          // Check if slot conflicts with busy times
          const isBusy = busySlots.some((busy: { start: string; end: string }) => {
            const busyStart = new Date(busy.start).getTime();
            const busyEnd = new Date(busy.end).getTime();
            return slotStart.getTime() < busyEnd && slotEnd.getTime() > busyStart;
          });

          if (!isBusy) {
            slots.push({
              date: dayStr,
              time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
              datetime: slotStart.toISOString(),
            });
          }
        }
      }
    }

    // Limit to max 15 slots for WhatsApp readability
    const limitedSlots = slots.slice(0, 15);

    return new Response(JSON.stringify({ success: true, slots: limitedSlots }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error getting slots:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

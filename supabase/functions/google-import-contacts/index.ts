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

async function refreshAccessToken(refresh_token: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

interface GoogleContact {
  resourceName: string;
  names?: { displayName?: string; givenName?: string; familyName?: string }[];
  phoneNumbers?: { value?: string; type?: string }[];
  emailAddresses?: { value?: string }[];
  biographies?: { value?: string }[];
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

  // Get tokens
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

  // Refresh if expired
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) <= new Date() && tokenRow.refresh_token) {
    const newToken = await refreshAccessToken(tokenRow.refresh_token);
    if (newToken) {
      accessToken = newToken;
      await serviceSupabase.from('google_oauth_tokens').update({
        access_token: newToken,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      }).eq('user_id', user.id);
    }
  }

  // Fetch all contacts from Google People API (paginated)
  const allContacts: GoogleContact[] = [];
  let nextPageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      personFields: 'names,phoneNumbers,emailAddresses,biographies',
      pageSize: '1000',
    });
    if (nextPageToken) params.set('pageToken', nextPageToken);

    const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Google People API error:', data);
      return new Response(JSON.stringify({ error: 'google_api_error', details: data }), { status: 500, headers: corsHeaders });
    }

    if (data.connections) {
      allContacts.push(...data.connections);
    }

    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  // Get existing contacts to avoid duplicates (by phone)
  const { data: existingContacts } = await serviceSupabase
    .from('contacts')
    .select('id, phone, email, full_name');

  const existingPhones = new Set(
    (existingContacts || [])
      .filter(c => c.phone)
      .map(c => normalizePhone(c.phone!))
  );
  const existingEmails = new Set(
    (existingContacts || [])
      .filter(c => c.email)
      .map(c => c.email!.toLowerCase())
  );

  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const contact of allContacts) {
    const name = contact.names?.[0]?.displayName || contact.names?.[0]?.givenName;
    if (!name) { skipped++; continue; }

    const phone = contact.phoneNumbers?.[0]?.value;
    const email = contact.emailAddresses?.[0]?.value;
    const bio = contact.biographies?.[0]?.value;

    // Extract instagram from bio if present
    let instagram_username: string | null = null;
    if (bio) {
      const igMatch = bio.match(/Instagram:\s*@?(\S+)/i);
      if (igMatch) instagram_username = igMatch[1];
    }

    const normalizedPhone = phone ? normalizePhone(phone) : null;
    const normalizedEmail = email ? email.toLowerCase() : null;

    // Check duplicates
    if (normalizedPhone && existingPhones.has(normalizedPhone)) {
      skipped++;
      continue;
    }
    if (normalizedEmail && existingEmails.has(normalizedEmail)) {
      skipped++;
      continue;
    }

    // Insert new contact
    const { error: insertError } = await serviceSupabase.from('contacts').insert({
      full_name: name,
      phone: phone || null,
      email: email || null,
      instagram_username: instagram_username,
      notes: bio || null,
      created_by: user.id,
    });

    if (!insertError) {
      imported++;
      if (normalizedPhone) existingPhones.add(normalizedPhone);
      if (normalizedEmail) existingEmails.add(normalizedEmail);
    } else {
      console.error('Insert error:', insertError);
      skipped++;
    }
  }

  return new Response(JSON.stringify({
    success: true,
    total: allContacts.length,
    imported,
    skipped,
    updated,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

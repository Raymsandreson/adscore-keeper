import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function extractPhoneFromJid(jid: string): string | null {
  const match = jid.match(/^(\d+)@/);
  if (!match) return null;
  const digits = match[1];
  if (digits.startsWith('55') && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) {
      return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    } else if (rest.length === 8) {
      return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
  }
  return `+${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    RESOLVED_SUPABASE_URL,
    RESOLVED_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const { instance_name } = await req.json();
  if (!instance_name) {
    return new Response(JSON.stringify({ error: 'instance_name required' }), { status: 400, headers: corsHeaders });
  }

  const serviceSupabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);

  // Get instance credentials
  const { data: inst, error: instError } = await serviceSupabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .ilike('instance_name', `%${instance_name}%`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (instError || !inst) {
    return new Response(JSON.stringify({ error: 'Instance not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
  const headers = { 'Content-Type': 'application/json', 'token': inst.instance_token };

  console.log(`Fetching contacts from instance: ${inst.instance_name}, base_url: ${baseUrl}`);

  // UazAPI v2 endpoints to try - ordered by most likely to work
  const endpoints = [
    { url: '/chat/list', method: 'GET' },
    { url: '/chat/getAll', method: 'GET' },
    { url: '/contacts/list', method: 'GET' },
    { url: '/contacts', method: 'GET' },
  ];

  let rawData: any = null;

  for (const ep of endpoints) {
    try {
      const fullUrl = `${baseUrl}${ep.url}`;
      console.log(`Trying: ${ep.method} ${fullUrl}`);
      
      const res = await fetch(fullUrl, { method: ep.method, headers });
      console.log(`${ep.url} => ${res.status}`);
      
      if (res.ok) {
        rawData = await res.json();
        console.log(`Success via ${ep.url}, type: ${typeof rawData}, isArray: ${Array.isArray(rawData)}`);
        if (rawData && (Array.isArray(rawData) ? rawData.length > 0 : Object.keys(rawData).length > 0)) {
          console.log(`Sample: ${JSON.stringify(rawData[0] || rawData).slice(0, 500)}`);
          break;
        }
        rawData = null; // empty, try next
      }
    } catch (e) {
      console.error(`Error with ${ep.url}:`, e);
    }
  }

  if (!rawData) {
    return new Response(JSON.stringify({ 
      error: 'no_contacts_found', 
      message: 'Nenhum contato encontrado. Verifique se a instância está conectada.' 
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Normalize: UazAPI chat/list returns array of chat objects
  let contacts: any[] = [];
  if (Array.isArray(rawData)) {
    contacts = rawData;
  } else if (rawData.data && Array.isArray(rawData.data)) {
    contacts = rawData.data;
  } else if (rawData.chats && Array.isArray(rawData.chats)) {
    contacts = rawData.chats;
  } else if (rawData.contacts && Array.isArray(rawData.contacts)) {
    contacts = rawData.contacts;
  }

  console.log(`Processing ${contacts.length} items`);

  // Get existing contacts to avoid duplicates
  const { data: existingContacts } = await serviceSupabase
    .from('contacts')
    .select('id, phone, full_name');

  const existingPhones = new Set(
    (existingContacts || [])
      .filter((c: any) => c.phone)
      .map((c: any) => normalizePhone(c.phone))
  );

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const contact of contacts) {
    try {
      // Extract JID from various possible fields (chat/list format vs contacts format)
      const jid = contact.wa_chatid || contact.chatid || contact.id || contact.jid || contact.remoteJid || contact.phone || '';
      
      // Skip groups, broadcasts, LIDs, status
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@lid') || jid === 'status@broadcast') {
        skipped++;
        continue;
      }

      // Extract phone - handle both JID format and raw phone
      let phone: string | null = null;
      if (jid.includes('@')) {
        phone = extractPhoneFromJid(jid);
      } else if (jid.match(/^\d+$/)) {
        // Raw digits
        const digits = jid;
        if (digits.startsWith('55') && digits.length >= 12) {
          const ddd = digits.slice(2, 4);
          const rest = digits.slice(4);
          phone = rest.length === 9 
            ? `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
            : `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
        } else {
          phone = `+${digits}`;
        }
      }

      if (!phone) {
        skipped++;
        continue;
      }

      const normalizedPhone = normalizePhone(phone);
      if (existingPhones.has(normalizedPhone)) {
        skipped++;
        continue;
      }

      // Get name from various possible fields
      const name = contact.name || contact.pushName || contact.wa_name || contact.wa_contactName ||
                   contact.verifiedName || contact.notify || contact.short || contact.formattedName || null;

      if (!name) {
        skipped++;
        continue;
      }

      const { error: insertError } = await serviceSupabase.from('contacts').insert({
        full_name: name,
        phone: phone,
        notes: `Importado do WhatsApp (${inst.instance_name})`,
        created_by: user.id,
      });

      if (!insertError) {
        imported++;
        existingPhones.add(normalizedPhone);
      } else {
        console.error('Insert error:', insertError);
        errors++;
      }
    } catch (e) {
      console.error('Contact processing error:', e);
      errors++;
    }
  }

  return new Response(JSON.stringify({
    success: true,
    instance: inst.instance_name,
    total: contacts.length,
    imported,
    skipped,
    errors,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function extractPhoneFromJid(jid: string): string | null {
  // Format: 5586999999999@s.whatsapp.net
  const match = jid.match(/^(\d+)@/);
  if (!match) return null;
  const digits = match[1];
  // Format as +55 (XX) XXXXX-XXXX
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
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

  const serviceSupabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Get instance credentials
  const { data: inst, error: instError } = await serviceSupabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .ilike('instance_name', `%${instance_name}%`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (instError || !inst) {
    return new Response(JSON.stringify({ error: 'Instance not found' }), { status: 404, headers: corsHeaders });
  }

  console.log(`Fetching contacts from instance: ${inst.instance_name}, base_url: ${inst.base_url}`);

  // Try multiple UazAPI endpoints to get contacts
  let contacts: any[] = [];
  
  // Try /contact/getAll first (UazAPI v2)
  const endpoints = ['/contact/getAll', '/chat/fetchContacts'];
  
  for (const endpoint of endpoints) {
    try {
      const url = `${inst.base_url}${endpoint}`;
      console.log(`Trying endpoint: ${url}`);
      
      const res = await fetch(url, {
        method: endpoint === '/chat/fetchContacts' ? 'POST' : 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'token': inst.instance_token 
        },
        ...(endpoint === '/chat/fetchContacts' ? { body: JSON.stringify({}) } : {}),
      });

      console.log(`${endpoint} response status: ${res.status}`);
      
      if (res.ok) {
        const data = await res.json();
        console.log(`${endpoint} response type:`, typeof data, Array.isArray(data) ? `array of ${data.length}` : 'object');
        
        if (Array.isArray(data)) {
          contacts = data;
        } else if (data.contacts && Array.isArray(data.contacts)) {
          contacts = data.contacts;
        } else if (data.data && Array.isArray(data.data)) {
          contacts = data.data;
        } else {
          // Maybe it's an object with phone keys
          const keys = Object.keys(data);
          if (keys.length > 0 && keys[0].includes('@')) {
            contacts = keys.map(k => ({ id: k, ...data[k] }));
          }
        }
        
        if (contacts.length > 0) {
          console.log(`Found ${contacts.length} contacts via ${endpoint}`);
          console.log('Sample contact:', JSON.stringify(contacts[0]).slice(0, 500));
          break;
        }
      }
    } catch (e) {
      console.error(`Error with ${endpoint}:`, e);
    }
  }

  if (contacts.length === 0) {
    return new Response(JSON.stringify({ 
      error: 'no_contacts_found', 
      message: 'Nenhum contato encontrado na instância' 
    }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

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
      // Extract contact info - UazAPI formats vary
      const jid = contact.id || contact.jid || contact.remoteJid || '';
      
      // Skip groups and broadcasts
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@lid')) {
        skipped++;
        continue;
      }

      const phone = extractPhoneFromJid(jid);
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
      const name = contact.pushName || contact.name || contact.verifiedName || 
                   contact.notify || contact.short || contact.formattedName || null;

      if (!name) {
        // Use formatted phone as name if no name available
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

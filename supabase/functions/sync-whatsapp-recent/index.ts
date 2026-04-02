import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Internal project DB stores instance registry + user access.
const INTERNAL_SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const INTERNAL_SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// External DB stores WhatsApp business data/messages.
const EXTERNAL_SUPABASE_URL = resolveSupabaseUrl();
const EXTERNAL_SUPABASE_SERVICE_ROLE_KEY = resolveServiceRoleKey();


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ChatSnapshot = {
  phone: string;
  createdAtIso: string;
  createdAtMs: number;
  contactName: string | null;
  messageText: string | null;
  messageType: string;
  direction: 'inbound' | 'outbound';
  externalMessageId: string;
};

function normalizePhone(raw: string | null | undefined): string {
  return String(raw || '')
    .replace('@s.whatsapp.net', '')
    .replace('@g.us', '')
    .replace('@lid', '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

function normalizeTimestamp(raw: unknown): { iso: string; ms: number } | null {
  if (raw === null || raw === undefined) return null;

  const num = Number(raw);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    const ms = num > 1e12 ? num : num * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return { iso: date.toISOString(), ms: date.getTime() };
  }

  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), ms: date.getTime() };
}

function resolveMessageType(rawType: string | null | undefined): string {
  const t = String(rawType || '').toLowerCase();
  if (t.includes('audio') || t.includes('ptt') || t.includes('voice')) return 'audio';
  if (t.includes('image') || t.includes('photo')) return 'image';
  if (t.includes('video')) return 'video';
  if (t.includes('document') || t.includes('file')) return 'document';
  if (t.includes('location')) return 'location';
  return 'text';
}

function resolveMessageText(chat: any, messageType: string): string | null {
  const direct = [
    chat?.wa_lastMessageText,
    chat?.lastMessageText,
    chat?.message?.text,
    chat?.preview,
  ].find((v) => typeof v === 'string' && v.trim().length > 0);

  if (typeof direct === 'string') return direct.trim();

  if (messageType === 'image') return '📷 Imagem';
  if (messageType === 'video') return '🎥 Vídeo';
  if (messageType === 'audio') return '🎧 Áudio';
  if (messageType === 'document') return '📄 Documento';
  if (messageType === 'location') return '📍 Localização';
  return null;
}

function isGroupChat(chat: any): boolean {
  const chatId = String(chat?.wa_chatid || chat?.chatid || chat?.id || '').toLowerCase();
  return (
    chat?.wa_isGroup === true ||
    chatId.includes('@g.us') ||
    chatId.includes('@broadcast') ||
    chatId === 'status@broadcast'
  );
}

function resolveDirection(chat: any): 'inbound' | 'outbound' {
  const owner = normalizePhone(chat?.owner || '');
  const sender = normalizePhone(chat?.wa_lastMessageSender || chat?.lastMessageSender || '');
  if (owner && sender && owner === sender) return 'outbound';
  return 'inbound';
}

function extractChatArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.chats)) return payload.chats;
  if (Array.isArray(payload?.contacts)) return payload.contacts;
  return [];
}

async function fetchChatsFromUaz(baseUrl: string, token: string): Promise<any[]> {
  const endpoints = ['/chat/list', '/chat/getAll'];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', token },
      });

      if (!res.ok) continue;

      const payload = await res.json();
      const chats = extractChatArray(payload);
      if (chats.length > 0) return chats;
    } catch (err) {
      console.error(`sync-whatsapp-recent endpoint error (${endpoint}):`, err);
    }
  }

  return [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth handled by verify_jwt=false; frontend ensures only authenticated users call this

    const internalClient = createClient(
      INTERNAL_SUPABASE_URL,
      INTERNAL_SUPABASE_SERVICE_ROLE_KEY,
    );

    const dataClient = createClient(
      EXTERNAL_SUPABASE_URL,
      EXTERNAL_SUPABASE_SERVICE_ROLE_KEY,
    );

    const body = await req.json().catch(() => ({}));
    const instanceId = typeof body.instance_id === 'string' ? body.instance_id : null;
    const instanceName = typeof body.instance_name === 'string' && body.instance_name.trim()
      ? body.instance_name.trim()
      : null;
    const maxChats = Math.min(Math.max(Number(body.max_chats) || 60, 20), 150);

    console.log(`sync-whatsapp-recent: instanceId=${instanceId} instanceName=${instanceName}`);

    if (!instanceId && !instanceName) {
      return new Response(JSON.stringify({ success: false, error: 'instance_id or instance_name is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseInstanceQuery = internalClient
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url, is_active')
      .eq('is_active', true)
      .limit(1);

    let instanceQuery = baseInstanceQuery;
    if (instanceId) {
      instanceQuery = instanceQuery.eq('id', instanceId);
    } else {
      instanceQuery = instanceQuery.ilike('instance_name', `%${instanceName}%`);
    }

    let { data: instance, error: instanceError } = await instanceQuery.maybeSingle();

    if (!instance && instanceId && instanceName) {
      const fallbackResult = await baseInstanceQuery.ilike('instance_name', `%${instanceName}%`).maybeSingle();
      instance = fallbackResult.data;
      instanceError = fallbackResult.error;
    }

    console.log(`sync-whatsapp-recent: query result instance=${instance?.instance_name || 'null'} error=${instanceError?.message || 'none'}`);
    if (instanceError || !instance) {
      return new Response(JSON.stringify({ success: false, error: 'Instance not found', debug: { instanceId, instanceName, dbError: instanceError?.message } }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = typeof body.user_id === 'string' ? body.user_id : null;

    // Permission check: verify user has access to this instance
    // If no user_id provided or no explicit permission, check if user has any role (member/admin)
    let hasAccess = false;

    if (userId) {
      const { data: permission } = await internalClient
        .from('whatsapp_instance_users')
        .select('id')
        .eq('instance_id', instance.id)
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (permission) {
        hasAccess = true;
      } else {
        // Fallback: check if user has any role (admin or member can sync)
        const { data: role } = await internalClient
          .from('user_roles')
          .select('id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();
        hasAccess = !!role;
      }
    }

    if (!hasAccess) {
      console.warn(`sync-whatsapp-recent: no access for user=${userId} instance=${instance.instance_name}`);
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = instance.base_url || 'https://abraci.uazapi.com';
    const chats = await fetchChatsFromUaz(baseUrl, instance.instance_token);

    if (chats.length === 0) {
      return new Response(JSON.stringify({ success: true, inserted: 0, skipped: 0, reason: 'no_chats' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const snapshots: ChatSnapshot[] = chats
      .filter((chat) => !isGroupChat(chat))
      .map((chat) => {
        const phone = normalizePhone(chat?.wa_chatid || chat?.chatid || chat?.id || chat?.phone || '');
        const ts = normalizeTimestamp(chat?.wa_lastMsgTimestamp || chat?.lastMessageTimestamp || chat?.timestamp);
        if (!phone || !ts) return null;

        const messageType = resolveMessageType(chat?.wa_lastMessageType || chat?.lastMessageType);
        const messageText = resolveMessageText(chat, messageType);
        const direction = resolveDirection(chat);
        const externalMessageId = `sync:${instance.instance_token}:${phone}:${ts.ms}`;

        return {
          phone,
          createdAtIso: ts.iso,
          createdAtMs: ts.ms,
          contactName: chat?.name || chat?.wa_name || chat?.wa_contactName || null,
          messageText,
          messageType,
          direction,
          externalMessageId,
        } satisfies ChatSnapshot;
      })
      .filter((s): s is ChatSnapshot => s !== null)
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, maxChats);

    if (snapshots.length === 0) {
      return new Response(JSON.stringify({ success: true, inserted: 0, skipped: 0, reason: 'no_snapshots' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phones = [...new Set(snapshots.map((s) => s.phone))];
    const { data: latestRows } = await dataClient
      .from('whatsapp_messages')
      .select('phone, created_at')
      .eq('instance_name', instance.instance_name)
      .in('phone', phones)
      .order('created_at', { ascending: false });

    const latestByPhone = new Map<string, number>();
    for (const row of latestRows || []) {
      if (!latestByPhone.has(row.phone)) {
        latestByPhone.set(row.phone, new Date(row.created_at).getTime());
      }
    }

    const inserts = snapshots
      .filter((snapshot) => {
        const latestMs = latestByPhone.get(snapshot.phone);
        if (!latestMs) return true;
        return snapshot.createdAtMs > latestMs + 5000;
      })
      .map((snapshot) => ({
        phone: snapshot.phone,
        contact_name: snapshot.contactName,
        message_text: snapshot.messageText,
        message_type: snapshot.messageType,
        direction: snapshot.direction,
        status: snapshot.direction === 'inbound' ? 'received' : 'sent',
        instance_name: instance.instance_name,
        instance_token: instance.instance_token,
        external_message_id: snapshot.externalMessageId,
        metadata: {
          sync_source: 'chat_list_snapshot',
          synced_at: new Date().toISOString(),
        },
        created_at: snapshot.createdAtIso,
      }));

    if (inserts.length > 0) {
      const { error: insertError } = await dataClient
        .from('whatsapp_messages')
        .insert(inserts);

      if (insertError) {
        console.error('sync-whatsapp-recent insert error:', insertError);
        return new Response(JSON.stringify({ success: false, error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      instance: instance.instance_name,
      scanned: snapshots.length,
      inserted: inserts.length,
      skipped: snapshots.length - inserts.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('sync-whatsapp-recent error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

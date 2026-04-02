import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveSupabaseUrl, resolveServiceRoleKey } from '../_shared/supabase-url-resolver.ts';

const EXTERNAL_URL = resolveSupabaseUrl();
const EXTERNAL_KEY = resolveServiceRoleKey();
const CLOUD_URL = Deno.env.get('SUPABASE_URL')!;
const CLOUD_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CALL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between calls

interface InstanceStatus {
  id: string;
  instance_name: string;
  instance_token: string;
  base_url: string;
  owner_phone: string | null;
  connected: boolean;
}

async function checkInstanceConnection(inst: { id: string; instance_name: string; instance_token: string; base_url: string | null; owner_phone: string | null }): Promise<InstanceStatus> {
  const baseUrl = inst.base_url || 'https://abraci.uazapi.com';
  try {
    const resp = await fetch(`${baseUrl}/instance/status`, {
      headers: { token: inst.instance_token },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return { ...inst, base_url: baseUrl, connected: false };
    }
    const data = await resp.json();
    const status = data?.instance?.status?.toLowerCase() || 'unknown';
    return { ...inst, base_url: baseUrl, connected: status === 'connected' };
  } catch {
    return { ...inst, base_url: baseUrl, connected: false };
  }
}

async function sendWhatsAppMessage(phone: string, message: string, instanceId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${CLOUD_URL}/functions/v1/send-whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CLOUD_KEY}`,
      },
      body: JSON.stringify({ phone, message, instance_id: instanceId }),
    });
    const result = await resp.json();
    return result.success === true;
  } catch (e) {
    console.error('sendWhatsAppMessage error:', e);
    return false;
  }
}

async function makeCall(phone: string, instanceId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${CLOUD_URL}/functions/v1/make-whatsapp-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CLOUD_KEY}`,
      },
      body: JSON.stringify({ phone, instance_id: instanceId }),
    });
    const result = await resp.json();
    return result.success === true;
  } catch (e) {
    console.error('makeCall error:', e);
    return false;
  }
}

function getUserAccessibleInstances(
  userId: string,
  instanceUsers: { instance_id: string; user_id: string }[],
  allInstances: { id: string; instance_name: string }[]
): string[] {
  const accessibleIds = new Set(
    instanceUsers.filter((iu) => iu.user_id === userId).map((iu) => iu.instance_id)
  );
  return allInstances.filter((i) => accessibleIds.has(i.id)).map((i) => i.instance_name);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const extDb = createClient(EXTERNAL_URL, EXTERNAL_KEY);
    const cloudDb = createClient(CLOUD_URL, CLOUD_KEY);

    // 1. Get all active instances from Cloud (registry)
    const { data: instances, error: instErr } = await cloudDb
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url, owner_phone')
      .eq('is_active', true);

    if (instErr || !instances?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No active instances' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Check connection status for all instances in parallel
    const statuses = await Promise.all(instances.map(checkInstanceConnection));

    // 3. Get current connection log state
    const { data: logs } = await cloudDb
      .from('instance_connection_log')
      .select('*');

    const logByInstance = new Map((logs || []).map((l: any) => [l.instance_id, l]));

    // 4. Get all instance_users, profiles, and member assistant config
    const [{ data: instanceUsers }, { data: profiles }, { data: memberConfig }] = await Promise.all([
      cloudDb.from('whatsapp_instance_users').select('instance_id, user_id'),
      cloudDb.from('profiles').select('user_id, phone, full_name, default_instance_id'),
      cloudDb.from('member_assistant_config').select('instance_id').limit(1).maybeSingle(),
    ]);

    // The sender instance for alerts/calls is the IA Interna instance
    const iaInternaId = memberConfig?.instance_id;
    const senderInstance = iaInternaId ? statuses.find((s) => s.id === iaInternaId && s.connected) : statuses.find((s) => s.connected);

    if (!senderInstance) {
      console.warn('No connected sender instance (IA Interna) available to send alerts');
    }

    const now = new Date();
    const results: any[] = [];

    for (const status of statuses) {
      const log = logByInstance.get(status.id);
      const wasConnected = log ? log.is_connected : true;

      if (!status.connected && wasConnected) {
        // ── JUST DISCONNECTED ──
        console.log(`🔴 ${status.instance_name} DISCONNECTED`);

        // Upsert connection log
        await cloudDb.from('instance_connection_log').upsert({
          instance_id: status.id,
          instance_name: status.instance_name,
          was_connected: true,
          is_connected: false,
          disconnected_at: now.toISOString(),
          reconnected_at: null,
          last_alert_sent_at: now.toISOString(),
          last_call_made_at: now.toISOString(),
          alert_count: 1,
        }, { onConflict: 'instance_id' });

        // Send alert to users who have access to this instance
        const usersWithAccess = (instanceUsers || [])
          .filter((iu: any) => iu.instance_id === status.id)
          .map((iu: any) => iu.user_id);

        for (const userId of usersWithAccess) {
          const profile = (profiles || []).find((p: any) => p.user_id === userId);
          if (!profile?.phone) continue;

          const userSender = getSenderForUser(userId);
          if (!userSender) continue;

          const accessibleNames = getUserAccessibleInstances(userId, instanceUsers || [], instances);
          const disconnectedFromAccess = accessibleNames.filter(
            (name) => statuses.find((s) => s.instance_name === name && !s.connected)
          );

          const msg =
            `🔴 *ALERTA: Instância Desconectada*\n\n` +
            `Olá ${profile.full_name || ''}!\n\n` +
            `A instância *${status.instance_name}* acabou de desconectar.\n\n` +
            (disconnectedFromAccess.length > 1
              ? `⚠️ Instâncias desconectadas que você tem acesso:\n${disconnectedFromAccess.map((n) => `  • ${n}`).join('\n')}\n\n`
              : '') +
            `Por favor, reconecte o quanto antes para não perder mensagens.\n` +
            `📱 _Você receberá uma ligação a cada 10 minutos enquanto estiver desconectado._`;

          await sendWhatsAppMessage(profile.phone, msg, userSender.id);
          await makeCall(profile.phone, userSender.id);
        }

        results.push({ instance: status.instance_name, event: 'disconnected', alerted: true });

      } else if (!status.connected && !wasConnected) {
        // ── STILL DISCONNECTED — check if we need to call again ──
        const lastCallAt = log?.last_call_made_at ? new Date(log.last_call_made_at).getTime() : 0;
        const elapsed = now.getTime() - lastCallAt;

        if (elapsed >= CALL_INTERVAL_MS) {
          console.log(`📞 ${status.instance_name} still disconnected, calling users (${Math.round(elapsed / 60000)}min since last call)`);

          const usersWithAccess = (instanceUsers || [])
            .filter((iu: any) => iu.instance_id === status.id)
            .map((iu: any) => iu.user_id);

          for (const userId of usersWithAccess) {
            const profile = (profiles || []).find((p: any) => p.user_id === userId);
            if (!profile?.phone) continue;
            const userSender = getSenderForUser(userId);
            if (!userSender) continue;
            await makeCall(profile.phone, userSender.id);
          }

          await cloudDb.from('instance_connection_log').update({
            last_call_made_at: now.toISOString(),
            alert_count: (log?.alert_count || 0) + 1,
          }).eq('instance_id', status.id);

          results.push({ instance: status.instance_name, event: 'still_disconnected', called: true });
        } else {
          results.push({ instance: status.instance_name, event: 'still_disconnected', called: false, next_call_in: Math.round((CALL_INTERVAL_MS - elapsed) / 60000) + 'min' });
        }

      } else if (status.connected && !wasConnected) {
        // ── JUST RECONNECTED ──
        console.log(`🟢 ${status.instance_name} RECONNECTED`);

        await cloudDb.from('instance_connection_log').update({
          is_connected: true,
          was_connected: false,
          reconnected_at: now.toISOString(),
          alert_count: 0,
        }).eq('instance_id', status.id);

        const usersWithAccess = (instanceUsers || [])
          .filter((iu: any) => iu.instance_id === status.id)
          .map((iu: any) => iu.user_id);

        const disconnectedDuration = log?.disconnected_at
          ? Math.round((now.getTime() - new Date(log.disconnected_at).getTime()) / 60000)
          : 0;

        for (const userId of usersWithAccess) {
          const profile = (profiles || []).find((p: any) => p.user_id === userId);
          if (!profile?.phone) continue;

          const userSender = getSenderForUser(userId);
          if (!userSender) continue;

          const msg =
            `🟢 *Instância Reconectada!*\n\n` +
            `Olá ${profile.full_name || ''}!\n\n` +
            `A instância *${status.instance_name}* foi reconectada com sucesso! ✅\n` +
            (disconnectedDuration > 0
              ? `⏱️ Ficou desconectada por ${disconnectedDuration} minuto${disconnectedDuration !== 1 ? 's' : ''}.\n`
              : '') +
            `\nTudo voltou ao normal. 👍`;

          await sendWhatsAppMessage(profile.phone, msg, userSender.id);
        }

        results.push({ instance: status.instance_name, event: 'reconnected', alerted: true });

      } else {
        // ── STILL CONNECTED — ensure log exists ──
        if (!log) {
          await cloudDb.from('instance_connection_log').upsert({
            instance_id: status.id,
            instance_name: status.instance_name,
            was_connected: true,
            is_connected: true,
            alert_count: 0,
          }, { onConflict: 'instance_id' });
        }
        results.push({ instance: status.instance_name, event: 'connected' });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('monitor-instance-connection error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

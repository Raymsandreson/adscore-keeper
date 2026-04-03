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

interface CampaignChange {
  campaign_id: string;
  campaign_name: string;
  instance_id: string;
  instance_name: string;
  old_status: string;
  new_status: string;
  error_info?: string;
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  return res.json();
}

async function sendWhatsAppMessage(phone: string, message: string, instanceId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${CLOUD_URL}/functions/v1/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLOUD_KEY}` },
      body: JSON.stringify({ phone, message, instance_id: instanceId }),
    });
    const result = await resp.json();
    return result.success === true;
  } catch (e) {
    console.error('sendWhatsAppMessage error:', e);
    return false;
  }
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'ACTIVE': return '🟢';
    case 'PAUSED': case 'CAMPAIGN_PAUSED': return '⏸️';
    case 'DELETED': case 'ARCHIVED': return '🗑️';
    case 'WITH_ISSUES': return '⚠️';
    default: return '🔴';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'Ativa';
    case 'PAUSED': return 'Pausada';
    case 'CAMPAIGN_PAUSED': return 'Pausada (campanha)';
    case 'ADSET_PAUSED': return 'Pausada (conjunto)';
    case 'DELETED': return 'Excluída';
    case 'ARCHIVED': return 'Arquivada';
    case 'WITH_ISSUES': return 'Com problemas';
    case 'DISAPPROVED': return 'Reprovada';
    case 'IN_PROCESS': return 'Em análise';
    case 'PENDING_REVIEW': return 'Revisão pendente';
    default: return status;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cloudDb = createClient(CLOUD_URL, CLOUD_KEY);
    const extDb = createClient(EXTERNAL_URL, EXTERNAL_KEY);

    // 1. Get all campaign automation links with their instances
    const { data: campaignLinks, error: linksErr } = await cloudDb
      .from('whatsapp_agent_campaign_links')
      .select('campaign_id, campaign_name, instance_id, is_active');

    if (linksErr || !campaignLinks?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No campaign links configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Get unique instance IDs and fetch their details + Meta tokens
    const instanceIds = [...new Set(campaignLinks.map((l: any) => l.instance_id).filter(Boolean))];

    const [{ data: instances }, { data: metaAccounts }, { data: statusLogs }] = await Promise.all([
      cloudDb.from('whatsapp_instances').select('id, instance_name').in('id', instanceIds),
      cloudDb.from('meta_ad_accounts').select('*'),
      cloudDb.from('campaign_status_log').select('*'),
    ]);

    const instanceMap = new Map((instances || []).map((i: any) => [i.id, i]));
    const logMap = new Map((statusLogs || []).map((l: any) => [l.campaign_id, l]));

    // Get Meta access token
    const metaToken = Deno.env.get('META_ACCESS_TOKEN');
    if (!metaToken) {
      console.error('META_ACCESS_TOKEN not configured');
      return new Response(JSON.stringify({ success: false, error: 'META_ACCESS_TOKEN not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Fetch current status from Meta API for each campaign
    const changes: CampaignChange[] = [];
    const now = new Date().toISOString();

    for (const link of campaignLinks as any[]) {
      if (!link.campaign_id) continue;

      const inst = instanceMap.get(link.instance_id);
      const existingLog = logMap.get(link.campaign_id);

      try {
        const url = `https://graph.facebook.com/v21.0/${link.campaign_id}?fields=name,effective_status,issues_info&access_token=${metaToken}`;
        const data = await fetchJson(url);

        if (data.error) {
          console.error(`Meta API error for campaign ${link.campaign_id}:`, data.error.message);
          // Track API errors as status changes too
          const errorStatus = 'API_ERROR';
          if (existingLog?.last_status !== errorStatus) {
            changes.push({
              campaign_id: link.campaign_id,
              campaign_name: link.campaign_name || data.name || 'Desconhecida',
              instance_id: link.instance_id,
              instance_name: inst?.instance_name || 'Desconhecida',
              old_status: existingLog?.last_status || 'UNKNOWN',
              new_status: errorStatus,
              error_info: data.error.message,
            });
          }
          await cloudDb.from('campaign_status_log').upsert({
            campaign_id: link.campaign_id,
            campaign_name: link.campaign_name || data.name,
            instance_id: link.instance_id,
            last_status: errorStatus,
            last_error: data.error.message,
            last_checked_at: now,
          }, { onConflict: 'campaign_id' });
          continue;
        }

        const currentStatus = (data.effective_status || 'UNKNOWN').toUpperCase();
        const campaignName = data.name || link.campaign_name || 'Desconhecida';
        const issuesInfo = data.issues_info;
        const hasIssues = issuesInfo && Object.keys(issuesInfo).length > 0;

        // Check if status changed
        if (existingLog && existingLog.last_status !== currentStatus) {
          changes.push({
            campaign_id: link.campaign_id,
            campaign_name: campaignName,
            instance_id: link.instance_id,
            instance_name: inst?.instance_name || 'Desconhecida',
            old_status: existingLog.last_status,
            new_status: currentStatus,
            error_info: hasIssues ? JSON.stringify(issuesInfo) : undefined,
          });
        } else if (!existingLog && currentStatus !== 'ACTIVE') {
          // First check and not active - notify
          changes.push({
            campaign_id: link.campaign_id,
            campaign_name: campaignName,
            instance_id: link.instance_id,
            instance_name: inst?.instance_name || 'Desconhecida',
            old_status: 'UNKNOWN',
            new_status: currentStatus,
            error_info: hasIssues ? JSON.stringify(issuesInfo) : undefined,
          });
        }

        // Upsert log
        await cloudDb.from('campaign_status_log').upsert({
          campaign_id: link.campaign_id,
          campaign_name: campaignName,
          instance_id: link.instance_id,
          last_status: currentStatus,
          last_error: hasIssues ? JSON.stringify(issuesInfo) : null,
          last_checked_at: now,
        }, { onConflict: 'campaign_id' });

      } catch (e) {
        console.error(`Error checking campaign ${link.campaign_id}:`, e);
      }
    }

    // 4. Notify users about changes
    if (changes.length > 0) {
      console.log(`📊 ${changes.length} campaign status changes detected`);

      // Get sender instance (IA Interna)
      const [{ data: memberConfig }, { data: allInstances }] = await Promise.all([
        cloudDb.from('member_assistant_config').select('instance_id').limit(1).maybeSingle(),
        cloudDb.from('whatsapp_instances').select('id, instance_name, instance_token, base_url').eq('is_active', true),
      ]);

      // Check which sender is connected
      let senderInstanceId: string | null = null;
      if (memberConfig?.instance_id) {
        senderInstanceId = memberConfig.instance_id;
      } else if (allInstances?.length) {
        senderInstanceId = allInstances[0].id;
      }

      if (!senderInstanceId) {
        console.warn('No sender instance available for campaign alerts');
      } else {
        // Get users with access to affected instances
        const affectedInstanceIds = [...new Set(changes.map(c => c.instance_id))];
        const [{ data: instanceUsers }, { data: profiles }] = await Promise.all([
          cloudDb.from('whatsapp_instance_users').select('instance_id, user_id').in('instance_id', affectedInstanceIds),
          cloudDb.from('profiles').select('user_id, phone, full_name'),
        ]);

        // Group changes by instance for user-specific messages
        const userNotified = new Set<string>();
        
        for (const userId of [...new Set((instanceUsers || []).map((iu: any) => iu.user_id))]) {
          if (userNotified.has(userId)) continue;
          userNotified.add(userId);

          const profile = (profiles || []).find((p: any) => p.user_id === userId);
          if (!profile?.phone) continue;

          // Get instances this user has access to
          const userInstanceIds = new Set(
            (instanceUsers || []).filter((iu: any) => iu.user_id === userId).map((iu: any) => iu.instance_id)
          );

          // Filter changes relevant to this user
          const userChanges = changes.filter(c => userInstanceIds.has(c.instance_id));
          if (userChanges.length === 0) continue;

          // Build consolidated message
          const lines = userChanges.map(c => {
            const emoji = statusEmoji(c.new_status);
            const from = statusLabel(c.old_status);
            const to = statusLabel(c.new_status);
            return `${emoji} *${c.campaign_name}*\n   ${from} → ${to}\n   📱 Instância: ${c.instance_name}${c.error_info ? '\n   ⚠️ ' + c.error_info.substring(0, 100) : ''}`;
          });

          const msg = `📊 *Alerta de Campanhas Meta*\n\n` +
            `Olá ${profile.full_name || ''}!\n\n` +
            `${userChanges.length === 1 ? 'Uma campanha mudou de status' : `${userChanges.length} campanhas mudaram de status`}:\n\n` +
            lines.join('\n\n') +
            `\n\n🔗 Verifique no sistema ou no Gerenciador de Anúncios.`;

          await sendWhatsAppMessage(profile.phone, msg, senderInstanceId);
          console.log(`📩 Campaign alert sent to ${profile.full_name} (${profile.phone})`);
        }
      }
    } else {
      console.log('✅ No campaign status changes detected');
    }

    return new Response(JSON.stringify({ success: true, changes_detected: changes.length, changes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('monitor-campaign-status error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const supabaseServiceKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const metaToken = Deno.env.get('META_ACCESS_TOKEN');
    if (!metaToken) {
      return new Response(JSON.stringify({ error: 'META_ACCESS_TOKEN not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get body params (optional: specific date, user_id)
    let targetDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let specificUserId: string | null = null;
    try {
      const body = await req.json();
      if (body.date) targetDate = body.date;
      if (body.user_id) specificUserId = body.user_id;
    } catch { /* no body, use defaults */ }

    // Get all instagram accounts (they contain ad account mapping)
    const { data: accounts, error: accountsError } = await supabase
      .from('instagram_accounts')
      .select('id, instagram_id, access_token, account_name')
      .eq('is_active', true);

    if (accountsError) throw accountsError;
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ message: 'No active accounts found', synced: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const results: any[] = [];
    const since = targetDate;
    const until = targetDate;

    // For each account, fetch Meta Ads data
    for (const account of accounts) {
      const token = (account.access_token && account.access_token !== 'USE_GLOBAL_TOKEN') 
        ? account.access_token 
        : metaToken;

      // Try to get ad accounts linked to this page/instagram
      let adAccountIds: string[] = [];
      try {
        const adAccountsRes = await fetch(
          `https://graph.facebook.com/v19.0/me/adaccounts?access_token=${token}&fields=id,name,account_status&limit=50`
        );
        const adAccountsData = await adAccountsRes.json();
        if (adAccountsData.data) {
          adAccountIds = adAccountsData.data
            .filter((a: any) => a.account_status === 1) // active only
            .map((a: any) => a.id);
        }
      } catch (e) {
        console.error('Error fetching ad accounts:', e);
        continue;
      }

      for (const adAccountId of adAccountIds) {
        try {
          // 1. Fetch leads (insights with actions)
          const insightsRes = await fetch(
            `https://graph.facebook.com/v19.0/${adAccountId}/insights?` +
            `fields=actions,spend,impressions,clicks&` +
            `time_range={"since":"${since}","until":"${until}"}&` +
            `access_token=${token}`
          );
          const insightsData = await insightsRes.json();
          const insights = insightsData.data?.[0] || {};

          let leadsReceived = 0;
          let leadsQualified = 0;
          if (insights.actions) {
            for (const action of insights.actions) {
              if (action.action_type === 'lead' || action.action_type === 'onsite_conversion.lead_grouped') {
                leadsReceived += parseInt(action.value) || 0;
              }
              if (action.action_type === 'offsite_conversion.fb_pixel_lead' || 
                  action.action_type === 'omni_complete_registration') {
                leadsQualified += parseInt(action.value) || 0;
              }
            }
          }

          // 2. Fetch active creatives count
          let creativesActive = 0;
          try {
            const adsRes = await fetch(
              `https://graph.facebook.com/v19.0/${adAccountId}/ads?` +
              `fields=id&effective_status=["ACTIVE"]&limit=500&` +
              `access_token=${token}`
            );
            const adsData = await adsRes.json();
            creativesActive = adsData.data?.length || 0;
          } catch (e) {
            console.error('Error fetching ads count:', e);
          }

          const spend = parseFloat(insights.spend || '0');
          const impressions = parseInt(insights.impressions || '0');
          const clicks = parseInt(insights.clicks || '0');

          // Upsert into meta_daily_metrics
          // Use a generic user_id (admin or first profile) since this is account-level data
          // The user_id will be matched via account association
          const { error: upsertError } = await supabase
            .from('meta_daily_metrics')
            .upsert({
              user_id: specificUserId || '00000000-0000-0000-0000-000000000000', // will be updated by user mapping
              metric_date: targetDate,
              account_id: adAccountId.replace('act_', ''),
              leads_received: leadsReceived,
              leads_qualified: leadsQualified,
              creatives_active: creativesActive,
              spend,
              impressions,
              clicks,
            }, {
              onConflict: 'user_id,metric_date,account_id',
            });

          if (upsertError) {
            console.error('Upsert error:', upsertError);
          }

          results.push({
            account_id: adAccountId,
            date: targetDate,
            leads_received: leadsReceived,
            leads_qualified: leadsQualified,
            creatives_active: creativesActive,
            spend,
            impressions,
            clicks,
          });

        } catch (e) {
          console.error(`Error processing ad account ${adAccountId}:`, e);
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      synced: results.length, 
      date: targetDate,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('meta-daily-sync error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

import { supabase } from '@/integrations/supabase/client';
import { getMetaCredentials } from '@/utils/metaCredentials';

interface LeadGeoData {
  id: string;
  board_id?: string | null;
  status?: string | null;
  acolhedor?: string | null;
  lead_city?: string | null;
  lead_state?: string | null;
}

export async function applyGeoRuleForLead(lead: LeadGeoData) {
  if (!lead.board_id || !lead.lead_city) {
    console.log('[GeoRule] Skipping: no board_id or lead_city');
    return;
  }

  try {
    // Find matching rules
    const { data: rules, error } = await supabase
      .from('adset_geo_rules')
      .select('*')
      .eq('board_id', lead.board_id)
      .eq('is_active', true);

    if (error || !rules?.length) {
      console.log('[GeoRule] No active rules found for board', lead.board_id);
      return;
    }

    // Filter rules by stage and acolhedor
    const matchingRules = (rules as any[]).filter(rule => {
      const stageMatch = !rule.stage_id || rule.stage_id === lead.status;
      const acolhedorMatch = !rule.acolhedor || rule.acolhedor === lead.acolhedor;
      return stageMatch && acolhedorMatch;
    });

    if (matchingRules.length === 0) {
      console.log('[GeoRule] No matching rules after filtering');
      return;
    }

    const { accessToken } = await getMetaCredentials();
    if (!accessToken) {
      console.warn('[GeoRule] No Meta access token');
      return;
    }

    for (const rule of matchingRules) {
      try {
        console.log(`[GeoRule] Applying rule ${rule.id}: adding city "${lead.lead_city}" to adset ${rule.adset_id}`);
        
        // Use the meta-campaign-manager edge function to update targeting
        const { data, error: fnError } = await supabase.functions.invoke('meta-campaign-manager', {
          body: {
            action: 'add_city_to_adset',
            accessToken,
            adSetId: rule.adset_id,
            cityName: lead.lead_city,
            stateName: lead.lead_state || null,
            radiusKm: rule.radius_km || 10,
          },
        });

        if (fnError) {
          console.error(`[GeoRule] Error applying rule ${rule.id}:`, fnError);
        } else {
          console.log(`[GeoRule] Successfully applied rule ${rule.id}:`, data);
        }
      } catch (e) {
        console.error(`[GeoRule] Exception for rule ${rule.id}:`, e);
      }
    }
  } catch (e) {
    console.error('[GeoRule] Error checking rules:', e);
  }
}

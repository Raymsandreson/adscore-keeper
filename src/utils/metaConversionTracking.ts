/**
 * Send lead quality signals back to Meta Conversions API (CAPI)
 * using the official Business Messaging format.
 * 
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/
 * 
 * Required data from the lead:
 * - ctwa_context.ctwa_clid: Click-to-WhatsApp Click ID (unique per ad click)
 * - waba_id: WhatsApp Business Account ID (from meta_ad_accounts)
 */
import { supabase } from "@/integrations/supabase/client";

type LeadStatus = 'closed' | 'refused' | 'inviavel';

const STATUS_EVENT_MAP: Record<LeadStatus, { event_name: string; content_category: string }> = {
  closed: { event_name: 'Purchase', content_category: 'lead_converted' },
  refused: { event_name: 'Lead', content_category: 'lead_refused' },
  inviavel: { event_name: 'Lead', content_category: 'lead_unqualified' },
};

export async function sendLeadConversionEvent(lead: {
  id: string;
  lead_name?: string;
  lead_phone?: string;
  ctwa_context?: any;
  campaign_id?: string;
  contract_value?: number;
}, newStatus: LeadStatus) {
  // Only send for CTWA leads that have a ctwa_clid
  const ctwaClid = lead.ctwa_context?.ctwa_clid;
  if (!ctwaClid) {
    console.log('[Meta CAPI] Skipping - no ctwa_clid available for lead', lead.id);
    return;
  }

  const mapping = STATUS_EVENT_MAP[newStatus];
  if (!mapping) return;

  try {
    // Get WABA ID from meta_ad_accounts
    const { data: adAccounts } = await supabase
      .from('meta_ad_accounts')
      .select('waba_id')
      .not('waba_id', 'is', null)
      .limit(1);

    const wabaId = adAccounts?.[0]?.waba_id;
    if (!wabaId) {
      console.warn('[Meta CAPI] No WABA ID configured in meta_ad_accounts. Cannot send event.');
      return;
    }

    const event = {
      event_name: mapping.event_name,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'business_messaging' as const,
      messaging_channel: 'whatsapp' as const,
      user_data: {
        whatsapp_business_account_id: wabaId,
        ctwa_clid: ctwaClid,
      },
      custom_data: {
        content_category: mapping.content_category,
        lead_id: lead.id,
        status: newStatus,
        ...(newStatus === 'closed' && lead.contract_value && {
          value: lead.contract_value,
          currency: 'BRL',
        }),
      },
    };

    await supabase.functions.invoke('facebook-capi', {
      body: { 
        events: [event],
        mode: 'business_messaging',
      },
    });

    console.log(`[Meta CAPI] Sent ${mapping.event_name} (${mapping.content_category}) for lead ${lead.id} via Business Messaging API`);
  } catch (err) {
    // Don't block the user flow — just log
    console.error('[Meta CAPI] Failed to send conversion event:', err);
  }
}

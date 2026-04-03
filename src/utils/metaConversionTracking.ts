/**
 * Send lead quality signals back to Meta Conversions API (CAPI).
 * When a CTWA lead changes status (closed, refused, inviavel),
 * we send the event to Meta so the algorithm can optimize for the right audience.
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
  // Only send for CTWA leads (came from Meta ads)
  if (!lead.ctwa_context && !lead.campaign_id) return;

  const mapping = STATUS_EVENT_MAP[newStatus];
  if (!mapping) return;

  try {
    const phone = lead.lead_phone?.replace(/\D/g, '') || '';
    const nameParts = (lead.lead_name || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    const event: any = {
      event_name: mapping.event_name,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'chat',
      user_data: {
        ...(phone && { ph: phone }),
        ...(firstName && { fn: firstName }),
        ...(lastName && { ln: lastName }),
        external_id: lead.id,
      },
      custom_data: {
        content_category: mapping.content_category,
        lead_id: lead.id,
        status: newStatus,
        ...(lead.campaign_id && { content_ids: [lead.campaign_id] }),
        ...(newStatus === 'closed' && lead.contract_value && {
          value: lead.contract_value,
          currency: 'BRL',
        }),
      },
    };

    await supabase.functions.invoke('facebook-capi', {
      body: { events: [event] },
    });

    console.log(`[Meta CAPI] Sent ${mapping.event_name} (${mapping.content_category}) for lead ${lead.id}`);
  } catch (err) {
    // Don't block the user flow — just log
    console.error('[Meta CAPI] Failed to send conversion event:', err);
  }
}

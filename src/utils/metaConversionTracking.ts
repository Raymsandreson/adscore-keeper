/**
 * MORTO desde 04/09/2026 — nada importa este arquivo. Não volte a usar.
 *
 * Ele chamava a edge `facebook-capi`, do app da Meta que foi APAGADO em
 * 31/07/2026, e todo erro caía num `catch` com `console.error`. Ficou mais de
 * um mês "enviando" para lugar nenhum. O caminho vivo é a fila:
 * `registrarFechamentoDeLead` / `enfileiraConversao` em
 * `src/services/metaCapiQueue.ts`, despachada pelo cron do Railway.
 *
 * Além de morto, o mapeamento aqui estava errado: `refused`, `inviavel` e
 * `cancelled` viravam evento `Lead`, que a Meta conta como CONVERSÃO. Ou seja,
 * se tivesse funcionado, estaria ensinando a Meta a buscar mais gente parecida
 * com quem o escritório recusou. Sinal negativo de qualidade precisa de outro
 * mecanismo (integração de CRM / `lead_event_source`), não deste.
 *
 * Mantido só para consulta enquanto o histórico interessa; pode ser apagado.
 *
 * ---
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

type LeadStatus = 'closed' | 'refused' | 'inviavel' | 'cancelled';

const STATUS_EVENT_MAP: Record<LeadStatus, { event_name: string; content_category: string }> = {
  closed: { event_name: 'Purchase', content_category: 'lead_converted' },
  refused: { event_name: 'Lead', content_category: 'lead_refused' },
  inviavel: { event_name: 'Lead', content_category: 'lead_unqualified' },
  cancelled: { event_name: 'Lead', content_category: 'lead_cancelled' },
};

export async function sendLeadConversionEvent(lead: {
  id: string;
  lead_name?: string;
  lead_phone?: string;
  ctwa_context?: any;
  campaign_id?: string;
  /** Valor do contrato/conversão. Coluna real em `leads` é `conversion_value`. */
  conversion_value?: number;
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
    // Get WABA ID from meta_ad_accounts (use raw query to avoid type issues).
    // Filtra contas SEM waba_id: pegar uma conta com waba_id nulo enviava o
    // evento sem destino válido (bug E).
    const { data: adAccounts } = await supabase
      .from('meta_ad_accounts')
      .select('*')
      .not('waba_id', 'is', null)
      .limit(1);

    const wabaId = (adAccounts as any)?.[0]?.waba_id;
    if (!wabaId) {
      console.warn('[Meta CAPI] No WABA ID configured in meta_ad_accounts. Cannot send event.');
      return;
    }

    const event = {
      event_name: mapping.event_name,
      // event_id determinístico → Meta deduplica se o mesmo fechamento
      // for enviado 2x (funil Pipeline vs Kanban) — bug C.
      event_id: `${lead.id}:${mapping.event_name}`,
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
        // Coluna real é `conversion_value` (não `contract_value`, que não existe) — bug A.
        ...(newStatus === 'closed' && lead.conversion_value && {
          value: lead.conversion_value,
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
    console.error('[Meta CAPI] Failed to send conversion event:', err);
  }
}

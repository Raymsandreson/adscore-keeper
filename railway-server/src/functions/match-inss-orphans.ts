import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';

/**
 * Varre todos os inss_admin_processes órfãos (case_id null) e tenta vincular
 * a um lead que tenha o nº do requerimento salvo no custom field
 * "Nº Requerimento INSS" (field_id fixo).
 *
 * Retorna { success, matched, scanned, errors }
 */

const FIELD_ID = '111f9a38-98c3-4f83-9095-5c469106a7bf';

export const handler: RequestHandler = async (_req, res) => {
  const errors: string[] = [];
  let matched = 0;
  let scanned = 0;
  let notify_fired = 0;

  try {
    const { data: orphans, error: oErr } = await supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number')
      .is('case_id', null)
      .is('lead_id', null)
      .is('deleted_at', null);
    if (oErr) {
      return res.json({ success: false, error: `load orphans: ${oErr.message}` });
    }

    scanned = (orphans || []).length;

    for (const o of orphans || []) {
      try {
        const { data: cfv } = await supabase
          .from('lead_custom_field_values')
          .select('lead_id')
          .eq('field_id', FIELD_ID)
          .eq('value_text', o.requerimento_number)
          .limit(1)
          .maybeSingle();
        if (!cfv?.lead_id) continue;

        const { data: legalCase } = await supabase
          .from('legal_cases')
          .select('id')
          .eq('lead_id', cfv.lead_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { error: uErr } = await supabase
          .from('inss_admin_processes')
          .update({
            lead_id: cfv.lead_id,
            case_id: legalCase?.id || null,
            linked_at: new Date().toISOString(),
          })
          .eq('id', o.id);
        if (uErr) {
          errors.push(`${o.requerimento_number}: ${uErr.message}`);
          continue;
        }
        matched++;

        if (legalCase?.id) {
          const railwayUrl = process.env.RAILWAY_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
          fetch(`${railwayUrl}/functions/notify-inss-update`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.RAILWAY_API_KEY || '',
            },
            body: JSON.stringify({ process_id: o.id }),
          }).catch(() => {});
          notify_fired++;
        }
      } catch (e: any) {
        errors.push(`${o.requerimento_number}: ${e?.message || 'unknown'}`);
      }
    }

    return res.json({ success: true, scanned, matched, notify_fired, errors });
  } catch (e: any) {
    return res.json({ success: false, error: e?.message || 'unknown' });
  }
};

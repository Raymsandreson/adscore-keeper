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
        const reqDigits = String(o.requerimento_number || '').replace(/\D/g, '');
        let leadId: string | null = null;
        let caseId: string | null = null;
        let source: 'process_number' | 'custom_field' | 'activity_title' | null = null;

        // Estratégia 0: processo/caso já cadastrado com o nº do requerimento
        if (reqDigits) {
          const { data: proc } = await supabase
            .from('lead_processes')
            .select('lead_id, case_id')
            .or(`process_number.ilike.%${reqDigits}%,title.ilike.%${reqDigits}%`)
            .not('case_id', 'is', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (proc?.case_id || proc?.lead_id) {
            leadId = proc.lead_id || null;
            caseId = proc.case_id || null;
            source = 'process_number';
          }
        }

        // Estratégia 1: custom field "Nº Requerimento INSS"
        const { data: cfv } = await supabase
          .from('lead_custom_field_values')
          .select('lead_id')
          .eq('field_id', FIELD_ID)
          .eq('value_text', o.requerimento_number)
          .limit(1)
          .maybeSingle();

        if (!leadId && cfv?.lead_id) {
          leadId = cfv.lead_id;
          source = 'custom_field';
        }

        // Estratégia 2: fallback — título de atividade contém o nº do requerimento
        if (!leadId && !caseId && reqDigits) {
          const { data: act } = await supabase
            .from('lead_activities')
            .select('lead_id, case_id')
            .ilike('title', `%${reqDigits}%`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (act?.lead_id || act?.case_id) {
            leadId = act.lead_id || null;
            caseId = act.case_id || null;
            source = 'activity_title';
          }
        }

        if (!leadId && caseId) {
          const { data: c } = await supabase
            .from('legal_cases')
            .select('lead_id')
            .eq('id', caseId)
            .maybeSingle();
          leadId = c?.lead_id || null;
        }

        if (!leadId && !caseId) continue;

        // Se veio via atividade, grava no custom field pra próxima vez casar direto
        if ((source === 'activity_title' || source === 'process_number') && leadId) {
          await supabase
            .from('lead_custom_field_values')
            .upsert(
              { lead_id: leadId, field_id: FIELD_ID, value_text: o.requerimento_number },
              { onConflict: 'lead_id,field_id' },
            );
        }

        if (!caseId && leadId) {
          const { data: legalCase } = await supabase
            .from('legal_cases')
            .select('id')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          caseId = legalCase?.id || null;
        }

        const { error: uErr } = await supabase
          .from('inss_admin_processes')
          .update({
            lead_id: leadId,
            case_id: caseId,
            linked_at: new Date().toISOString(),
          })
          .eq('id', o.id);
        if (uErr) {
          errors.push(`${o.requerimento_number}: ${uErr.message}`);
          continue;
        }
        matched++;

        if (caseId) {
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

import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { findInssOrphanMatch, applyInssMatch } from '../lib/inss-matcher';

/**
 * Varre inss_admin_processes órfãos e tenta vincular usando o matcher
 * compartilhado (mesma lógica do gmail-inss-sync). Roda manualmente ou
 * via cron a cada 15min (ver src/index.ts).
 */

export const handler: RequestHandler = async (_req, res) => {
  const errors: string[] = [];
  let matched = 0;
  let scanned = 0;
  let notify_fired = 0;

  try {
    const { data: orphans, error: oErr } = await supabase
      .from('inss_admin_processes')
      .select('id, requerimento_number, cpf_segurado, nome_segurado, benefit_number')
      .is('case_id', null)
      .is('lead_id', null)
      .is('deleted_at', null);
    if (oErr) {
      return res.json({ success: false, error: `load orphans: ${oErr.message}` });
    }

    scanned = (orphans || []).length;

    for (const o of orphans || []) {
      try {
        const match = await findInssOrphanMatch({
          requerimento: o.requerimento_number,
          cpf: (o as any).cpf_segurado,
          nome: (o as any).nome_segurado,
          beneficio_num: (o as any).benefit_number,
        });
        if (!match.leadId && !match.caseId) continue;

        const { caseId } = await applyInssMatch({
          processId: o.id,
          requerimento: o.requerimento_number,
          match,
        });
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

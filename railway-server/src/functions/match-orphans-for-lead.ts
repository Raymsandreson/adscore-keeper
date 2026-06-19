import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { findInssOrphanMatch, applyInssMatch, INSS_REQUERIMENTO_FIELD_ID } from '../lib/inss-matcher';

/**
 * Matcher reverso: dado um lead recém-criado/atualizado, procura entre
 * os processos órfãos do INSS aqueles que provavelmente são dele e vincula.
 *
 * Body: { lead_id: string }
 *
 * Fluxo:
 *  1) Lê lead (cpf, lead_name, victim_name) + custom field "Nº Requerimento INSS"
 *  2) Carrega órfãos candidatos (filtros por CPF, nº requerimento, NB, ou
 *     primeiros tokens do nome)
 *  3) Para cada candidato, roda findInssOrphanMatch e, se a resposta apontar
 *     pra este mesmo leadId, aplica o vínculo
 */
export const handler: RequestHandler = async (req, res) => {
  const leadId = String((req.body || {}).lead_id || '').trim();
  if (!leadId) return res.json({ success: false, error: 'lead_id obrigatório' });

  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, cpf, lead_name, victim_name')
      .eq('id', leadId)
      .maybeSingle();
    if (!lead) return res.json({ success: false, error: 'lead não encontrado' });

    const cpfDigits = String((lead as any).cpf || '').replace(/\D/g, '');
    const nome = String((lead as any).lead_name || (lead as any).victim_name || '').trim();

    // Custom field: Nº Requerimento INSS
    const { data: cfv } = await supabase
      .from('lead_custom_field_values')
      .select('value_text')
      .eq('lead_id', leadId)
      .eq('field_id', INSS_REQUERIMENTO_FIELD_ID)
      .maybeSingle();
    const requerimento = String((cfv as any)?.value_text || '').trim();
    const reqDigits = requerimento.replace(/\D/g, '');

    // Acha candidatos órfãos
    const candidates = new Map<string, any>(); // id -> orphan row

    const pushOrphans = (rows: any[] | null | undefined) => {
      for (const o of (rows || [])) if (!candidates.has(o.id)) candidates.set(o.id, o);
    };

    if (cpfDigits.length === 11) {
      const { data } = await supabase
        .from('inss_admin_processes')
        .select('id, requerimento_number, cpf_segurado, nome_segurado, benefit_number')
        .is('case_id', null).is('lead_id', null).is('deleted_at', null)
        .eq('cpf_segurado', cpfDigits)
        .limit(50);
      pushOrphans(data);
    }
    if (reqDigits) {
      const { data } = await supabase
        .from('inss_admin_processes')
        .select('id, requerimento_number, cpf_segurado, nome_segurado, benefit_number')
        .is('case_id', null).is('lead_id', null).is('deleted_at', null)
        .ilike('requerimento_number', `%${reqDigits}%`)
        .limit(50);
      pushOrphans(data);
    }
    if (nome.length >= 6) {
      const firstTokens = nome.split(/\s+/).filter((t) => t.length >= 3).slice(0, 2).join(' ');
      if (firstTokens) {
        const { data } = await supabase
          .from('inss_admin_processes')
          .select('id, requerimento_number, cpf_segurado, nome_segurado, benefit_number')
          .is('case_id', null).is('lead_id', null).is('deleted_at', null)
          .ilike('nome_segurado', `%${firstTokens}%`)
          .limit(50);
        pushOrphans(data);
      }
    }

    let linked = 0;
    const linkedItems: Array<{ processId: string; requerimento: string | null; via: string | null }> = [];

    for (const o of candidates.values()) {
      try {
        const match = await findInssOrphanMatch({
          requerimento: o.requerimento_number,
          cpf: o.cpf_segurado,
          nome: o.nome_segurado,
          beneficio_num: o.benefit_number,
        });
        // Só aplica se o matcher decidiu vincular a ESTE lead específico,
        // evitando roubar órfão pra lead errado.
        if (match.leadId !== leadId) continue;
        await applyInssMatch({
          processId: o.id,
          requerimento: o.requerimento_number,
          match,
        });
        linked++;
        linkedItems.push({
          processId: o.id,
          requerimento: o.requerimento_number || null,
          via: match.source,
        });
      } catch {
        // ignora falhas individuais
      }
    }

    return res.json({
      success: true,
      scanned: candidates.size,
      linked,
      items: linkedItems,
    });
  } catch (e: any) {
    return res.json({ success: false, error: e?.message || 'unknown' });
  }
};

// Regera o lead_name de um lead seguindo a configuração atual de board_group_settings.
// Sequência DETERMINÍSTICA: posição do lead na fila de fechados do funil, ordenada
// por confirmed_at do checkpoint setup_lead_close (ASC). Sem contador, sem clique-incrementa.
// Se o lead ainda não está fechado, usa total_closed+1 como projeção.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL ||
  process.env.SUPABASE_URL ||
  'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const MAX_GROUP_NAME_LENGTH = 95;

function normalizeName(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME_LENGTH);
}

function stripExistingSequence(name: string, prefix: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!prefix) return trimmed;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\d+\\s*`, 'i');
  return trimmed.replace(re, '').trim();
}

async function computeClosedPosition(boardId: string, leadId: string): Promise<{ position: number; total: number }> {
  const { data: closedSteps } = await ext
    .from('onboarding_checkpoints')
    .select('lead_id, confirmed_at, updated_at')
    .eq('step', 'setup_lead_close')
    .eq('status', 'done');
  const candidateIds = (closedSteps || []).map((c: any) => c.lead_id);
  if (candidateIds.length === 0) return { position: 1, total: 0 };

  const { data: leadsRows } = await ext
    .from('leads')
    .select('id')
    .in('id', candidateIds)
    .eq('board_id', boardId);
  const inBoard = new Set((leadsRows || []).map((l: any) => l.id));

  const sequence = (closedSteps || [])
    .filter((c: any) => inBoard.has(c.lead_id))
    .map((c: any) => ({ lead_id: c.lead_id as string, when: (c.confirmed_at || c.updated_at) as string }))
    .sort((a, b) => (a.when || '').localeCompare(b.when || ''));

  const idx = sequence.findIndex((s) => s.lead_id === leadId);
  if (idx >= 0) return { position: idx + 1, total: sequence.length };
  // Lead ainda não fechado: projeção = próximo da fila
  return { position: sequence.length + 1, total: sequence.length };
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { lead_id, phase: phaseIn, dry_run } = (req.body || {}) as {
      lead_id?: string;
      phase?: 'open' | 'closed';
      dry_run?: boolean;
    };
    if (!lead_id) return ok({ success: false, error: 'lead_id required' });

    const { data: lead, error: leadErr } = await ext
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();
    if (leadErr || !lead) return ok({ success: false, error: 'lead not found' });
    if (!lead.board_id) return ok({ success: false, error: 'lead sem board_id' });

    const { data: settings } = await ext
      .from('board_group_settings')
      .select('*')
      .eq('board_id', lead.board_id)
      .maybeSingle();
    if (!settings) return ok({ success: false, error: 'board_group_settings não configurado' });

    // Phase: prioriza phaseIn; senão checkpoint setup_lead_close=done; senão lead_status
    let phase: 'open' | 'closed' = phaseIn || (lead.lead_status === 'closed' ? 'closed' : 'open');
    if (!phaseIn && phase === 'open') {
      const { data: closeCk } = await ext
        .from('onboarding_checkpoints')
        .select('status')
        .eq('lead_id', lead_id)
        .eq('step', 'setup_lead_close')
        .maybeSingle();
      if (closeCk?.status === 'done') phase = 'closed';
    }

    // Enriquecimento on-demand: se algum lead_field configurado está vazio
    // e existe procuração assinada, chama zapsign-enrich-lead antes
    const leadFieldsCfg: string[] = settings.lead_fields || ['lead_name'];
    const enrichableFields = ['victim_name','city','state','neighborhood','street','cpf','rg','birth_date','cep'];
    const needsEnrich = leadFieldsCfg.some((f) => enrichableFields.includes(f) && !lead[f]);
    let enriched = false;
    if (needsEnrich) {
      const { data: doc } = await ext
        .from('zapsign_documents')
        .select('signed_file_url, instance_name, doc_token, document_name')
        .eq('lead_id', lead_id)
        .not('signed_file_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (doc?.signed_file_url) {
        try {
          const r = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/zapsign-enrich-lead`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${CLOUD_ANON_KEY}`,
              apikey: CLOUD_ANON_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              lead_id,
              signed_file_url: doc.signed_file_url,
              instance_name: doc.instance_name || undefined,
              doc_token: doc.doc_token || undefined,
              document_name: doc.document_name || undefined,
            }),
          });
          await r.text().catch(() => '');
          enriched = true;
          // Recarrega lead com os campos atualizados
          const { data: refreshed } = await ext
            .from('leads')
            .select('*')
            .eq('id', lead_id)
            .maybeSingle();
          if (refreshed) Object.assign(lead, refreshed);
        } catch (e) {
          console.warn('[regenerate-lead-name] enrich failed:', e);
        }
      }
    }

    const useClosed = phase === 'closed' && !!settings.closed_group_name_prefix;
    const activePrefix = (useClosed ? settings.closed_group_name_prefix : settings.group_name_prefix) || '';
    const activeSeqStart = useClosed ? (settings.closed_sequence_start || 1) : (settings.sequence_start || 1);

    // Sequência determinística por posição
    const { position, total } = await computeClosedPosition(lead.board_id, lead_id);
    const nextSeq = Math.max(position, activeSeqStart);

    const { data: boardData } = await ext
      .from('kanban_boards')
      .select('name')
      .eq('id', lead.board_id)
      .maybeSingle();
    const boardName = boardData?.name || '';

    const parts: string[] = [];
    if (activePrefix) parts.push(activePrefix);
    parts.push(String(nextSeq).padStart(4, '0'));

    const leadFields: string[] = settings.lead_fields || ['lead_name'];
    const missingFields: string[] = [];
    for (const field of leadFields) {
      if (field === 'board_name') {
        if (boardName) parts.push(boardName);
        else missingFields.push(field);
      } else if (lead[field]) {
        const val = field === 'lead_name'
          ? stripExistingSequence(String(lead[field]), activePrefix)
          : String(lead[field]);
        if (val) parts.push(val);
        else missingFields.push(field);
      } else {
        missingFields.push(field);
      }
    }

    const newName = normalizeName(parts.join(' '));
    if (!newName) return ok({ success: false, error: 'nome resultante vazio' });

    if (dry_run) {
      return ok({
        success: true,
        dry_run: true,
        lead_name: newName,
        sequence: nextSeq,
        position,
        total_closed: total,
        phase,
        enriched,
        missing_fields: missingFields,
      });
    }

    const { error: updErr } = await ext
      .from('leads')
      .update({ lead_name: newName, updated_at: new Date().toISOString() })
      .eq('id', lead_id);
    if (updErr) return ok({ success: false, error: `falha ao atualizar lead: ${updErr.message}` });

    let groupRenamed = false;
    let groupName: string | null = null;
    if (settings.sync_lead_name_with_group && lead.whatsapp_group_id) {
      try {
        const r = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/create-whatsapp-group`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CLOUD_ANON_KEY}`,
            apikey: CLOUD_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lead_id,
            lead_name: newName,
            phone: lead.lead_phone,
            contact_phone: lead.lead_phone,
            board_id: lead.board_id,
            creation_origin: 'regenerate_lead_name',
            phase,
            allow_rename: true,
          }),
        });
        const data: any = await r.json().catch(() => ({}));
        if (data?.success !== false) {
          groupRenamed = true;
          groupName = data?.group_name || null;
        }
      } catch (e) {
        console.warn('[regenerate-lead-name] rename group failed:', e);
      }
    }

    return ok({
      success: true,
      lead_name: newName,
      sequence: nextSeq,
      position,
      total_closed: total,
      phase,
      enriched,
      missing_fields: missingFields,
      group_renamed: groupRenamed,
      group_name: groupName,
    });
  } catch (e: any) {
    console.error('[regenerate-lead-name] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

// Regera o lead_name de um lead seguindo a configuração atual de board_group_settings.
// - Calcula prefixo (open ou closed conforme phase) + sequência (sempre nova: current_sequence+1)
// - Concatena lead_fields (lead_name, victim_name, city, state, etc.) a partir da row de leads
// - Atualiza leads.lead_name
// - Persiste a nova sequência em board_group_settings (current_sequence ou closed_current_sequence)
// - Se houver whatsapp_group_id e sync_lead_name_with_group estiver ligado, tenta renomear o grupo
//   chamando a edge create-whatsapp-group com allow_rename:true (que já trata UazAPI + persistência)
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

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { lead_id, phase: phaseIn } = (req.body || {}) as {
      lead_id?: string;
      phase?: 'open' | 'closed';
    };
    if (!lead_id) return ok({ success: false, error: 'lead_id required' });

    // Carrega lead
    const { data: lead, error: leadErr } = await ext
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();
    if (leadErr || !lead) return ok({ success: false, error: 'lead not found' });

    const boardId = lead.board_id;
    if (!boardId) return ok({ success: false, error: 'lead sem board_id' });

    const { data: settings } = await ext
      .from('board_group_settings')
      .select('*')
      .eq('board_id', boardId)
      .maybeSingle();
    if (!settings) return ok({ success: false, error: 'board_group_settings não configurado para este funil' });

    // Decide phase
    const phase: 'open' | 'closed' =
      phaseIn || (lead.lead_status === 'closed' ? 'closed' : 'open');

    const useClosed = phase === 'closed' && !!settings.closed_group_name_prefix;
    const activePrefix = (useClosed ? settings.closed_group_name_prefix : settings.group_name_prefix) || '';
    const activeSeqStart = useClosed ? (settings.closed_sequence_start || 1) : (settings.sequence_start || 1);
    const activeCurrentSeq = useClosed ? (settings.closed_current_sequence || 0) : (settings.current_sequence || 0);

    // Sempre atribui nova sequência (conforme decisão do usuário)
    const nextSeq = Math.max(activeCurrentSeq + 1, activeSeqStart);

    // Board name (caso lead_fields inclua 'board_name')
    let boardName = '';
    const { data: boardData } = await ext
      .from('kanban_boards')
      .select('name')
      .eq('id', boardId)
      .maybeSingle();
    boardName = boardData?.name || '';

    // Monta partes
    const parts: string[] = [];
    if (activePrefix) parts.push(activePrefix);
    parts.push(String(nextSeq).padStart(4, '0'));

    const leadFields: string[] = settings.lead_fields || ['lead_name'];
    for (const field of leadFields) {
      if (field === 'board_name' && boardName) {
        parts.push(boardName);
      } else if (lead[field]) {
        const val = field === 'lead_name'
          ? stripExistingSequence(String(lead[field]), activePrefix)
          : String(lead[field]);
        if (val) parts.push(val);
      }
    }

    const newName = normalizeName(parts.join(' '));
    if (!newName) return ok({ success: false, error: 'nome resultante vazio' });

    // Atualiza lead
    const { error: updErr } = await ext
      .from('leads')
      .update({ lead_name: newName, updated_at: new Date().toISOString() })
      .eq('id', lead_id);
    if (updErr) return ok({ success: false, error: `falha ao atualizar lead: ${updErr.message}` });

    // Persiste sequência
    if (useClosed) {
      await ext.from('board_group_settings').update({ closed_current_sequence: nextSeq }).eq('board_id', boardId);
    } else {
      await ext.from('board_group_settings').update({ current_sequence: nextSeq }).eq('board_id', boardId);
    }

    // Se sync ativo e há grupo, dispara renomeação
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
            board_id: boardId,
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
      phase,
      group_renamed: groupRenamed,
      group_name: groupName,
    });
  } catch (e: any) {
    console.error('[regenerate-lead-name] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

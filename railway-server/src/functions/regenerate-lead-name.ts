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

const MAX_GROUP_NAME_LENGTH = 100;

function normalizeName(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME_LENGTH);
}

function stripExistingSequence(name: string, prefix: string): string {
  if (!name) return '';
  let trimmed = name.trim();
  // Remove ✅ inicial — evita acumular em re-runs
  trimmed = trimmed.replace(/^(?:✅\s*)+/u, '').trim();
  if (!prefix) return trimmed;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-|:]?\\s*\\d+\\s*`, 'i');
  return trimmed.replace(re, '').trim();
}

function stripCaseFallbackPrefix(name: string): string {
  return String(name || '').replace(/^(?:✅\s*)+/u, '').replace(/^CASO\s*[-|:]?\s*\d+\s*/i, '').trim();
}

// Posição do lead na fila de fechados do funil. Resolvido em UMA SQL via RPC
// (`get_lead_closed_position`) — sem o limite de 1000 linhas do PostgREST que
// quebrava boards grandes (Raym caía fora do .in() e voltava posição 1).
async function computeClosedPosition(boardId: string, leadId: string): Promise<{ position: number; total: number }> {
  const { data: pos, error: posErr } = await ext
    .rpc('get_lead_closed_position', { p_lead_id: leadId, p_board_id: boardId });
  if (posErr) {
    console.error('[regenerate-lead-name] get_lead_closed_position error:', posErr);
    return { position: 1, total: 0 };
  }
  return { position: typeof pos === 'number' ? pos : 1, total: typeof pos === 'number' ? pos : 0 };
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

    const useClosed = phase === 'closed';
    const activePrefix = settings.group_name_prefix || '';
    const activeSeqStart = useClosed ? 1 : (settings.sequence_start || 1);

    const { data: latestLegalCase } = await ext
      .from('legal_cases')
      .select('case_number')
      .eq('lead_id', lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Sequência: se o lead já tem case_number salvo, RESPEITA esse valor (fonte de verdade
    // editada pelo usuário no front). Só calcula via posição quando não há case_number.
    const storedCaseNumber = lead.case_number != null && String(lead.case_number).trim() !== ''
      ? lead.case_number
      : latestLegalCase?.case_number;
    const existingCaseNum = storedCaseNumber != null && String(storedCaseNumber).trim() !== ''
      ? parseInt(String(storedCaseNumber).replace(/\D/g, ''), 10)
      : NaN;
    let position = 0;
    let total = 0;
    let nextSeq: number;
    if (Number.isFinite(existingCaseNum) && existingCaseNum > 0) {
      nextSeq = existingCaseNum;
      position = existingCaseNum;
    } else {
      const computed = await computeClosedPosition(lead.board_id, lead_id);
      position = computed.position;
      total = computed.total;
      nextSeq = useClosed ? position : Math.max(position, activeSeqStart);
    }

    // Token de prefixo:
    //  - FECHADO: usa SEMPRE o prefixo manual do funil + nº, nunca o fallback "CASO"
    //  - ABERTO:  "LEAD-{lead_number}({case_prefix do produto})"
    let prefixToken = '';
    const manualClosedPrefix = String(settings.closed_group_name_prefix || '').trim();
    {
      if (useClosed) {
        prefixToken = manualClosedPrefix ? `${manualClosedPrefix} ${nextSeq}` : String(nextSeq);
      } else if (lead.lead_number && lead.product_service_id) {
        const { data: prod } = await ext
          .from('products_services')
          .select('case_prefix')
          .eq('id', lead.product_service_id)
          .maybeSingle();
        const pfx = ((prod as any)?.case_prefix || '').trim().toUpperCase();
        prefixToken = pfx
          ? `LEAD${lead.lead_number}(${pfx})`
          : `LEAD${lead.lead_number}`;
      }

    }

    const { data: boardData } = await ext
      .from('kanban_boards')
      .select('name')
      .eq('id', lead.board_id)
      .maybeSingle();
    const boardName = boardData?.name || '';

    const parts: string[] = [];
    // Em ambas as fases agora colocamos o token de prefixo na frente
    if (prefixToken) parts.push(prefixToken);

    const leadFields: string[] = settings.lead_fields || ['lead_name'];


    // Pré-carrega valores de campos personalizados se houver tokens cf:<id>
    const cfIds = leadFields
      .filter((f) => typeof f === 'string' && f.startsWith('cf:'))
      .map((f) => f.slice(3));
    const cfValuesById: Record<string, string> = {};
    if (cfIds.length > 0) {
      const { data: cfVals } = await ext
        .from('lead_custom_field_values')
        .select('field_id, value_text, value_number, value_date, value_boolean')
        .eq('lead_id', lead_id)
        .in('field_id', cfIds);
      for (const v of (cfVals || []) as any[]) {
        const raw =
          v.value_text ??
          (v.value_number !== null ? String(v.value_number) : null) ??
          v.value_date ??
          (v.value_boolean !== null ? (v.value_boolean ? 'Sim' : 'Não') : null);
        if (raw) cfValuesById[v.field_id] = String(raw);
      }
    }

    const missingFields: string[] = [];
    for (const field of leadFields) {
      if (field === 'closed_seq' || field === 'case_number') {
        continue;
      } else if (typeof field === 'string' && field.startsWith('text:')) {
        try { parts.push(decodeURIComponent(field.slice(5))); } catch { parts.push(field.slice(5)); }
      } else if (field === 'board_name') {
        if (boardName) parts.push(boardName);
        else missingFields.push(field);
      } else if (field.startsWith('cf:')) {
        const cfId = field.slice(3);
        const v = cfValuesById[cfId];
        if (v) parts.push(v);
        else missingFields.push(field);
      } else if (field === 'city_state') {
        const city = (lead as any)?.city ? String((lead as any).city).trim() : '';
        const state = (lead as any)?.state ? String((lead as any).state).trim() : '';
        if (city && state) parts.push(`${city}/${state}`);
        else if (city) parts.push(city);
        else if (state) parts.push(state);
        else missingFields.push(field);
      } else if (lead[field]) {
        const val = field === 'lead_name'
          ? stripCaseFallbackPrefix(stripExistingSequence(String(lead[field]), manualClosedPrefix || activePrefix))
          : String(lead[field]);
        if (val) parts.push(val);
        else missingFields.push(field);
      } else {
        missingFields.push(field);
      }
    }

    let newName = normalizeName(parts.join(' '));
    if (!newName) return ok({ success: false, error: 'nome resultante vazio' });
    // Fase fechada: prefixa ✅ na frente (idempotente — strip helpers já removem qualquer ✅ herdado).
    if (useClosed) {
      newName = normalizeName(`✅${newName.replace(/^(?:✅\s*)+/u, '').trim()}`);
    }

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

    const updatePayload: Record<string, unknown> = {
      lead_name: newName,
      updated_at: new Date().toISOString(),
    };
    // Sincroniza nº do caso só se o lead ainda não tem um valor salvo
    // (evita sobrescrever o case_number editado/confirmado pelo usuário).
    if (phase === 'closed' && position && !(Number.isFinite(existingCaseNum) && existingCaseNum > 0)) {
      updatePayload.case_number = String(position);
    }
    const { error: updErr } = await ext
      .from('leads')
      .update(updatePayload)
      .eq('id', lead_id);
    if (updErr) return ok({ success: false, error: `falha ao atualizar lead: ${updErr.message}` });

    // Renomeia o grupo direto via UazAPI (sem delegar ao create-whatsapp-group,
    // que recalcula sequência própria e sobrescreve o lead_name causando duplicação).
    let groupRenamed = false;
    let groupName: string | null = null;
    const renameErrors: string[] = [];
    if (settings.sync_lead_name_with_group && lead.whatsapp_group_id) {
      const fullJid = String(lead.whatsapp_group_id).includes('@g.us')
        ? String(lead.whatsapp_group_id)
        : `${lead.whatsapp_group_id}@g.us`;

      // Lista candidatos: instâncias do board primeiro, depois qualquer conectada.
      const candidates: any[] = [];
      const { data: boardInstances } = await ext
        .from('board_group_instances')
        .select('instance_id')
        .eq('board_id', lead.board_id);
      // Nota: a tabela whatsapp_instances do Externo NÃO tem coluna connection_status.
      // A conectividade real é validada pelo probe /group/info abaixo — quem
      // responde 200 está online e enxerga o grupo.
      if (boardInstances?.length) {
        const { data: bInst } = await ext
          .from('whatsapp_instances')
          .select('id, instance_name, instance_token, base_url')
          .in('id', boardInstances.map((b: any) => b.instance_id))
          .eq('is_active', true);
        if (bInst) candidates.push(...bInst);
      }
      {
        const excludeIds = candidates.map((c: any) => c.id);
        let q = ext
          .from('whatsapp_instances')
          .select('id, instance_name, instance_token, base_url')
          .eq('is_active', true);
        if (excludeIds.length) q = q.not('id', 'in', `(${excludeIds.join(',')})`);
        const { data: anyInst } = await q;
        if (anyInst) candidates.push(...anyInst);
      }

      // Probe /group/info pra achar uma instância que realmente enxerga o grupo
      let actor: any = null;
      let baseUrl = '';
      for (const cand of candidates) {
        const candBase = (cand.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
        try {
          const probe = await fetch(`${candBase}/group/info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token: cand.instance_token },
            body: JSON.stringify({ groupjid: fullJid }),
          });
          if (probe.ok) {
            actor = cand;
            baseUrl = candBase;
            break;
          } else {
            renameErrors.push(`${cand.instance_name}: probe ${probe.status}`);
          }
        } catch (e: any) {
          renameErrors.push(`${cand.instance_name}: ${e?.message || 'fetch error'}`);
        }
      }

      if (actor) {
        try {
          const r1 = await fetch(`${baseUrl}/group/updateName`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token: actor.instance_token },
            body: JSON.stringify({ groupjid: fullJid, name: newName }),
          });
          if (r1.ok) {
            groupRenamed = true;
            groupName = newName;
          } else {
            const r2 = await fetch(`${baseUrl}/group/subject`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', token: actor.instance_token },
              body: JSON.stringify({ groupjid: fullJid, subject: newName }),
            });
            if (r2.ok) {
              groupRenamed = true;
              groupName = newName;
            } else {
              const t = await r2.text().catch(() => '');
              renameErrors.push(`updateName ${r1.status} / subject ${r2.status}: ${t.slice(0, 160)}`);
            }
          }
        } catch (e: any) {
          renameErrors.push(`rename error: ${e?.message || e}`);
        }
      } else {
        renameErrors.push('nenhuma instância conectada conseguiu enxergar o grupo');
      }

      if (!groupRenamed) {
        console.warn('[regenerate-lead-name] rename failed:', renameErrors.join(' | '));
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
      rename_errors: renameErrors,
      sync_enabled: !!settings.sync_lead_name_with_group,
      has_group_id: !!lead.whatsapp_group_id,
    });
  } catch (e: any) {
    console.error('[regenerate-lead-name] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

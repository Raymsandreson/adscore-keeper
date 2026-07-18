import type { Request, Response } from 'express';
import { supabase } from '../lib/supabase';

// ZapSign webhook → grava raw em zapsign_document_events e atualiza zapsign_documents.
// Sempre retorna 200 (ZapSign não deve reenviar). Raw insert primeiro, update best-effort.

function normPhone(s?: string | null): string {
  return (s || '').replace(/\D/g, '');
}

function phoneVariants(p: string): string[] {
  const digits = normPhone(p);
  if (!digits || digits.length < 8) return [];
  const set = new Set<string>([digits]);
  const withoutDdi = digits.startsWith('55') ? digits.slice(2) : digits;
  set.add(withoutDdi);
  set.add('55' + withoutDdi);
  if (withoutDdi.length === 11 && withoutDdi[2] === '9') {
    const without9 = withoutDdi.slice(0, 2) + withoutDdi.slice(3);
    set.add(without9); set.add('55' + without9);
  } else if (withoutDdi.length === 10) {
    const with9 = withoutDdi.slice(0, 2) + '9' + withoutDdi.slice(2);
    set.add(with9); set.add('55' + with9);
  }
  return [...set].filter((v) => v.length >= 8);
}

async function resolveContactAndLead(phone: string): Promise<{ contact_id: string | null; lead_id: string | null }> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return { contact_id: null, lead_id: null };
  try {
    const { data: c } = await supabase
      .from('contacts')
      .select('id, lead_id')
      .in('phone', variants)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    const contactId = c?.id || null;
    let leadId: string | null = c?.lead_id || null;
    if (contactId && !leadId) {
      const { data: lk } = await supabase
        .from('contact_leads')
        .select('lead_id')
        .eq('contact_id', contactId)
        .limit(1)
        .maybeSingle();
      leadId = lk?.lead_id || null;
    }
    return { contact_id: contactId, lead_id: leadId };
  } catch (e: any) {
    console.error('[zapsign-webhook] resolveContactAndLead error:', e?.message || e);
    return { contact_id: null, lead_id: null };
  }
}

function pickFirstSigner(signers: any[]): any {
  if (!Array.isArray(signers) || signers.length === 0) return {};
  return signers.find((s) => s?.status === 'signed') || signers[0];
}

function mapEventType(body: any): string {
  const t = body?.event_type || body?.event || body?.type;
  if (typeof t === 'string' && t.trim()) return t.trim();
  if (body?.status === 'signed') return 'doc_signed';
  if (body?.status === 'refused') return 'doc_refused';
  return 'unknown';
}

export const handler = async (req: Request, res: Response) => {
  const raw = req.body;

  if (!raw || typeof raw !== 'object') {
    return res.status(200).json({ success: false, error: 'invalid_payload' });
  }

  const eventType = mapEventType(raw);
  const docToken: string | null =
    raw.token || raw.doc_token || raw.open_id_token || raw?.doc?.token || null;
  const signers: any[] = Array.isArray(raw.signers) ? raw.signers : (raw?.doc?.signers || []);
  const signer = raw.signer || pickFirstSigner(signers);
  const signedAtIso = signer?.signed_at || raw?.signed_at || null;
  const signerPhone = normPhone((signer?.phone_country || '') + (signer?.phone_number || ''));

  // 1) lookup document_id (best effort) + INSERT cru
  let documentId: string | null = null;
  if (docToken) {
    const { data: doc } = await supabase
      .from('zapsign_documents')
      .select('id')
      .eq('doc_token', docToken)
      .maybeSingle();
    documentId = doc?.id || null;

    // ATALHO PARA DOC MANUAL: se o documento foi criado direto no painel ZapSign
    // (sem passar pela nossa API), não existe linha em zapsign_documents.
    // Cria uma linha mínima na hora pra que o UPDATE + auto-link abaixo rodem normalmente.
    if (!documentId) {
      const initialStatus =
        eventType === 'doc_signed' ? 'signed' :
        eventType === 'doc_refused' ? 'refused' :
        (raw.status || raw?.doc?.status || 'pending');
      const minimalInsert: any = {
        doc_token: docToken,
        document_name: raw.name || raw?.doc?.name || 'Documento (manual ZapSign)',
        status: initialStatus,
        original_file_url: raw.original_file || raw?.doc?.original_file || null,
        signed_file_url: raw.signed_file || raw?.doc?.signed_file || null,
        signer_name: signer?.name || null,
        signer_email: signer?.email || null,
        signer_phone: signerPhone || null,
        signer_token: signer?.token || null,
        signer_status: signer?.status || null,
        signed_at: signedAtIso,
        sent_via_whatsapp: false,
        source: 'zapsign_manual',
      };
      Object.keys(minimalInsert).forEach((k) => minimalInsert[k] === undefined && delete minimalInsert[k]);
      const { data: inserted, error: insertErr } = await supabase
        .from('zapsign_documents')
        .insert(minimalInsert)
        .select('id')
        .maybeSingle();
      if (insertErr) {
        // Pode falhar se a coluna `source` não existir — tenta sem ela
        if (/column.*source/i.test(insertErr.message || '')) {
          delete minimalInsert.source;
          const retry = await supabase
            .from('zapsign_documents')
            .insert(minimalInsert)
            .select('id')
            .maybeSingle();
          if (retry.error) {
            console.error('[zapsign-webhook] manual-doc insert retry error:', retry.error.message);
          } else {
            documentId = retry.data?.id || null;
            console.log('[zapsign-webhook] manual doc shortcut → inserted', docToken);
          }
        } else {
          console.error('[zapsign-webhook] manual-doc insert error:', insertErr.message);
        }
      } else {
        documentId = inserted?.id || null;
        console.log('[zapsign-webhook] manual doc shortcut → inserted', docToken);
      }
    }
  }

  const eventInsert = {
    doc_token: docToken,
    document_id: documentId,
    event_type: eventType,
    status: raw.status || raw?.doc?.status || null,
    signer_token: signer?.token || null,
    signer_name: signer?.name || null,
    signer_email: signer?.email || null,
    signer_phone: signerPhone || null,
    signer_status: signer?.status || null,
    signed_at: signer?.signed_at || raw?.signed_at || null,
    raw_payload: raw,
    source: 'webhook',
    processed_at: new Date().toISOString(),
  };

  const { error: insErr } = await supabase.from('zapsign_document_events').insert(eventInsert);
  if (insErr) console.error('[zapsign-webhook] event insert error:', insErr.message);

  // 2) UPDATE em zapsign_documents
  if (docToken) {
    const update: any = { updated_at: new Date().toISOString() };

    if (raw.status) update.status = raw.status;
    else if (raw?.doc?.status) update.status = raw.doc.status;

    if (raw.signed_file || raw?.doc?.signed_file) {
      update.signed_file_url = raw.signed_file || raw.doc.signed_file;
    }
    if (raw.original_file || raw?.doc?.original_file) {
      update.original_file_url = raw.original_file || raw.doc.original_file;
    }
    if (raw.name || raw?.doc?.name) {
      update.document_name = raw.name || raw.doc.name;
    }

    switch (eventType) {
      case 'doc_signed':
        update.status = 'signed';
        update.signed_at = signedAtIso || new Date().toISOString();
        break;
      case 'doc_refused':
        update.status = 'refused';
        break;
      case 'doc_deleted':
        update.status = 'deleted';
        update.deleted_at = new Date().toISOString();
        break;
      case 'signer_signed':
        update.signer_status = 'signed';
        if (signer?.signed_at) update.signed_at = signer.signed_at;
        if (signer?.name) update.signer_name = signer.name;
        if (signer?.email) update.signer_email = signer.email;
        if (signerPhone) update.signer_phone = signerPhone;
        if (signer?.token) update.signer_token = signer.token;
        break;
      case 'signer_viewed':
        update.signer_status = signer?.status || 'viewed';
        update.last_viewed_at = new Date().toISOString();
        break;
      case 'signer_refused':
        update.signer_status = 'refused';
        break;
      default:
        break;
    }

    if (Array.isArray(signers) && signers.length > 0) {
      const first = pickFirstSigner(signers);
      if (first?.name && !update.signer_name) update.signer_name = first.name;
      if (first?.email && !update.signer_email) update.signer_email = first.email;
      if (first?.token && !update.signer_token) update.signer_token = first.token;
      const fp = normPhone((first?.phone_country || '') + (first?.phone_number || ''));
      if (fp && !update.signer_phone) update.signer_phone = fp;
      if (!update.signer_status) update.signer_status = first?.status || null;
    }

    Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

    // Auto-link por telefone (mesmo em docs criados manualmente fora da API).
    // Só sobrescreve se o doc ainda não estiver vinculado a um lead/contato.
    const candidatePhone = update.signer_phone || signerPhone;
    if (candidatePhone && candidatePhone.length >= 10) {
      try {
        const { data: existingDoc } = await supabase
          .from('zapsign_documents')
          .select('lead_id, contact_id')
          .eq('doc_token', docToken)
          .maybeSingle();
        const needsContact = !existingDoc?.contact_id;
        const needsLead = !existingDoc?.lead_id;
        if (needsContact || needsLead) {
          let { contact_id, lead_id } = await resolveContactAndLead(candidatePhone);

          // ÓRFÃO: phone do signer não bate com nenhum contato/lead existente.
          // Cria contato + lead "fechado sem funil" pra não perder o cliente.
          const signerName = (update.signer_name || signer?.name || '').toString().trim();
          if (!contact_id && signerName) {
            try {
              const { data: newContact, error: cErr } = await supabase
                .from('contacts')
                .insert({
                  full_name: signerName,
                  phone: candidatePhone,
                  classification: 'client',
                  source: 'zapsign_manual',
                })
                .select('id')
                .maybeSingle();
              if (cErr) {
                if (/column.*source/i.test(cErr.message || '')) {
                  const retry = await supabase
                    .from('contacts')
                    .insert({ full_name: signerName, phone: candidatePhone, classification: 'client' })
                    .select('id')
                    .maybeSingle();
                  if (!retry.error) contact_id = retry.data?.id || null;
                  else console.error('[zapsign-webhook] orphan contact insert retry error:', retry.error.message);
                } else {
                  console.error('[zapsign-webhook] orphan contact insert error:', cErr.message);
                }
              } else {
                contact_id = newContact?.id || null;
                console.log('[zapsign-webhook] orphan contact created', { phone: candidatePhone, name: signerName });
              }
            } catch (e: any) {
              console.error('[zapsign-webhook] orphan contact create exception:', e?.message || e);
            }
          }

          // Resolve funil do template ANTES de decidir se cria lead novo.
          const templateToken: string | null =
            raw?.template_id || raw?.template?.token || raw?.template?.id ||
            raw?.doc?.template_id || raw?.doc?.template?.token || raw?.doc?.template?.id ||
            raw?.created_through_template || null;

          let resolvedBoardId: string | null = null;
          let resolvedStatus: string | null = null;
          if (templateToken) {
            const { data: fdef } = await supabase
              .from('funnel_zapsign_defaults')
              .select('board_id')
              .eq('zapsign_template_token', String(templateToken))
              .limit(1)
              .maybeSingle();
            resolvedBoardId = fdef?.board_id || null;
            if (!resolvedBoardId) {
              const { data: kb } = await supabase
                .from('kanban_boards')
                .select('id')
                .eq('zapsign_template_id', String(templateToken))
                .limit(1)
                .maybeSingle();
              resolvedBoardId = kb?.id || null;
            }
            if (resolvedBoardId) {
              const { data: board } = await supabase
                .from('kanban_boards')
                .select('stages')
                .eq('id', resolvedBoardId)
                .maybeSingle();
              const stages: any[] = Array.isArray(board?.stages) ? board!.stages : [];
              const closed = stages.find((s: any) => {
                const id = String(s?.id || '').toLowerCase();
                return id === 'closed' || id === 'fechado' || id === 'fechados' || id === 'done' || id.startsWith('closed_') || id.startsWith('fechado_');
              });
              resolvedStatus = closed?.id || null;
            }
          }

          // Decide se precisa criar lead novo:
          // - Sem lead existente → cria (órfão ou no funil do template).
          // - Lead existente MAS template aponta pra outro funil → cria NOVO no funil do template (opção C).
          let shouldCreateLead = !lead_id && !!signerName;
          if (lead_id && resolvedBoardId && signerName) {
            const { data: existingLead } = await supabase
              .from('leads')
              .select('board_id')
              .eq('id', lead_id)
              .maybeSingle();
            if (existingLead && existingLead.board_id !== resolvedBoardId) {
              console.log('[zapsign-webhook] existing lead in different board → creating new', {
                existing_lead_id: lead_id,
                existing_board: existingLead.board_id,
                template_board: resolvedBoardId,
              });
              shouldCreateLead = true;
            }
          }

          if (shouldCreateLead) {
            try {
              const isOrphan = !resolvedBoardId;
              const leadInsert: any = {
                lead_name: signerName,
                lead_phone: candidatePhone,
                board_id: resolvedBoardId,
                status: resolvedStatus,
                lead_status: 'closed',
                closed_at: new Date().toISOString(),
                source: 'zapsign_manual',
                details: {
                  zapsign_doc_token: docToken,
                  zapsign_template_token: templateToken || null,
                  orphan: isOrphan,
                  matched_via: resolvedBoardId ? 'template' : null,
                },
              };
              const { data: newLead, error: lErr } = await supabase
                .from('leads')
                .insert(leadInsert)
                .select('id')
                .maybeSingle();
              if (lErr) {
                console.error('[zapsign-webhook] auto lead insert error:', lErr.message);
              } else {
                lead_id = newLead?.id || null;
                console.log('[zapsign-webhook] auto lead created', { id: lead_id, name: signerName, board_id: resolvedBoardId, orphan: isOrphan });
                if (contact_id && lead_id) {
                  const { error: linkErr } = await supabase
                    .from('contact_leads')
                    .insert({ contact_id, lead_id, relationship: 'titular' });
                  if (linkErr && !/duplicate|unique/i.test(linkErr.message || '')) {
                    console.error('[zapsign-webhook] contact_leads link error:', linkErr.message);
                  }
                }
              }
            } catch (e: any) {
              console.error('[zapsign-webhook] auto lead create exception:', e?.message || e);
            }
          }

          if (needsContact && contact_id) update.contact_id = contact_id;
          if (needsLead && lead_id) update.lead_id = lead_id;
        }
      } catch (e: any) {
        console.error('[zapsign-webhook] auto-link error:', e?.message || e);
      }
    }

    if (Object.keys(update).length > 1) {
      const { error: updErr } = await supabase
        .from('zapsign_documents')
        .update(update)
        .eq('doc_token', docToken);
      if (updErr) console.error('[zapsign-webhook] update error:', updErr.message);
    }

    // Fix estrutural: vincular o CASO à procuração. legal_case_id nunca era setado,
    // por isso o dado da procuração (nome/CPF) ficava solto do processo.
    // Idempotente: só grava quando o doc já tem lead e ainda não tem caso.
    try {
      const { data: d } = await supabase
        .from('zapsign_documents')
        .select('id, lead_id, legal_case_id')
        .eq('doc_token', docToken)
        .maybeSingle();
      if (d?.lead_id && !d.legal_case_id) {
        const { data: lc } = await supabase
          .from('legal_cases')
          .select('id')
          .eq('lead_id', d.lead_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lc?.id) {
          await supabase
            .from('zapsign_documents')
            .update({ legal_case_id: lc.id })
            .eq('id', d.id);
          console.log('[zapsign-webhook] legal_case_id vinculado:', lc.id, 'doc:', docToken);
        }
      }
    } catch (e: any) {
      console.error('[zapsign-webhook] legal_case_id link error:', e?.message || e);
    }
  }

  return res.status(200).json({ success: true, event_type: eventType, doc_token: docToken });
};

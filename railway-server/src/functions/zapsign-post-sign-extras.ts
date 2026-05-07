// Pós-assinatura ZapSign: REGISTRA 5 checkpoints como `pending` em
// `onboarding_checkpoints` no Externo. NÃO executa nada automaticamente.
// O frontend (modal bloqueante) é quem dispara cada passo após confirmação manual.
//
// Histórico: antes este arquivo criava grupo + importava docs em paralelo,
// causando duplicações (3 grupos, contatos órfãos, casos com defaults silenciosos).
// Migrado para fluxo de checkpoint manual em 2026-05-07.
import { supabase } from '../lib/supabase';

interface PostSignInput {
  doc_token: string;
  lead_id?: string | null;
}

const STEPS = [
  'create_group',          // 1. Criar grupo WhatsApp
  'send_initial_message',  // 2. Enviar mensagem de boas-vindas
  'import_docs',           // 3. Importar docs (WhatsApp 7d + ZapSign extras)
  'create_case_process',   // 4. Criar Caso + Processo (pergunta tipo + honorários)
  'create_onboarding_activity', // 5. Atividade ONBOARDING CLIENTE
] as const;

export async function runPostSignExtras(input: PostSignInput): Promise<void> {
  const { doc_token } = input;
  if (!doc_token) {
    console.warn('[post-sign-extras] missing doc_token');
    return;
  }

  const { data: doc, error: docErr } = await supabase
    .from('zapsign_documents')
    .select('id, lead_id, contact_id, instance_name, signed_at, signer_name, created_by, status')
    .eq('doc_token', doc_token)
    .maybeSingle();
  if (docErr || !doc) {
    console.warn('[post-sign-extras] doc not found:', doc_token, docErr?.message);
    return;
  }
  if (doc.status !== 'signed') {
    console.log('[post-sign-extras] doc not fully signed yet, skip:', doc.status);
    return;
  }
  if (!doc.lead_id) {
    console.log('[post-sign-extras] doc has no lead_id, skip');
    return;
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('lead_name, lead_phone, board_id')
    .eq('id', doc.lead_id)
    .maybeSingle();
  if (!lead) {
    console.warn('[post-sign-extras] lead not found:', doc.lead_id);
    return;
  }

  const basePayload = {
    doc_token,
    lead_name: lead.lead_name,
    lead_phone: (lead.lead_phone || '').replace(/\D/g, ''),
    board_id: lead.board_id,
    instance_name: doc.instance_name,
    signed_at: doc.signed_at,
    signer_name: doc.signer_name,
    contact_id: doc.contact_id,
    created_by: doc.created_by,
  };

  // Idempotência: UNIQUE(lead_id, step) garante que múltiplos webhooks
  // (signed_at + envelope + retry) não duplicam checkpoints.
  for (const step of STEPS) {
    const { error } = await supabase
      .from('onboarding_checkpoints')
      .upsert(
        {
          lead_id: doc.lead_id,
          doc_token,
          step,
          status: 'pending',
          payload: basePayload,
        },
        { onConflict: 'lead_id,step', ignoreDuplicates: true },
      );
    if (error) console.warn('[post-sign-extras] upsert checkpoint failed:', step, error.message);
  }
  console.log('[post-sign-extras] checkpoints registered for lead', doc.lead_id);
}

// Pós-assinatura ZapSign: cria grupo (com retry queue) + importa docs originais
// (WhatsApp últimos 7d + extra_docs do envelope), classificando por IA.
//
// Roda no Railway, depois do forward pro Cloud zapsign-webhook (que já cuida de
// notificação, PDF assinado, enrich-lead, attachments).
//
// Tudo escreve no Supabase Externo. Sem novo código no Cloud.
import { supabase } from '../lib/supabase';

const ZAPSIGN_TOKEN = process.env.ZAPSIGN_API_TOKEN || '';
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';
const CLOUD_FUNCTIONS_URL = process.env.CLOUD_FUNCTIONS_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface PostSignInput {
  doc_token: string;
  lead_id?: string | null;
}

const DOC_TYPES = [
  'RG',
  'CPF',
  'CNH',
  'Comprovante de Residência',
  'Procuração',
  'Contrato Social',
  'Carteira de Trabalho',
  'Certidão de Nascimento',
  'Certidão de Casamento',
  'Laudo Médico',
  'Outro',
] as const;

async function classifyDocument(
  fileUrl: string,
  fileName: string,
): Promise<{ type: string; title: string }> {
  if (!LOVABLE_API_KEY) return { type: 'Outro', title: fileName };

  try {
    const body = {
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        {
          role: 'system',
          content:
            'Você classifica documentos brasileiros enviados em processos jurídicos. Use apenas os tipos da lista. Devolva via tool call.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Classifique este arquivo "${fileName}". URL: ${fileUrl}`,
            },
            { type: 'image_url', image_url: { url: fileUrl } },
          ],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'save_classification',
            parameters: {
              type: 'object',
              properties: {
                document_type: { type: 'string', enum: [...DOC_TYPES] },
                title: { type: 'string', description: 'Título descritivo curto, ex: RG do titular' },
              },
              required: ['document_type', 'title'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'save_classification' } },
    };
    const resp = await fetch(AI_GATEWAY, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn('[post-sign-extras] AI classify status', resp.status);
      return { type: 'Outro', title: fileName };
    }
    const data: any = await resp.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { type: 'Outro', title: fileName };
    const parsed = JSON.parse(args);
    return {
      type: parsed.document_type || 'Outro',
      title: parsed.title || fileName,
    };
  } catch (e) {
    console.warn('[post-sign-extras] classify error:', e);
    return { type: 'Outro', title: fileName };
  }
}

async function fetchExtraDocsFromZapSign(docToken: string): Promise<Array<{ url: string; name: string }>> {
  if (!ZAPSIGN_TOKEN) return [];
  try {
    const resp = await fetch(`https://api.zapsign.com.br/api/v1/docs/${docToken}/`, {
      headers: { Authorization: `Bearer ${ZAPSIGN_TOKEN}` },
    });
    if (!resp.ok) {
      console.warn('[post-sign-extras] zapsign detail status', resp.status);
      return [];
    }
    const data: any = await resp.json();
    // ZapSign expõe extras em `extra_docs` (anexos extras do envelope) e `signers[].auth_extra_docs`.
    const out: Array<{ url: string; name: string }> = [];
    for (const d of data?.extra_docs || []) {
      if (d?.original_file) {
        out.push({ url: d.original_file, name: d.name || 'extra-doc.pdf' });
      }
    }
    for (const s of data?.signers || []) {
      for (const a of s?.auth_extra_docs || []) {
        if (a?.url) out.push({ url: a.url, name: a.label || 'auth-doc' });
      }
    }
    return out;
  } catch (e) {
    console.warn('[post-sign-extras] zapsign detail error:', e);
    return [];
  }
}

async function ensureGroup(params: {
  lead_id: string;
  lead_phone: string;
  lead_name: string;
  board_id: string | null;
  instance_name: string | null;
}): Promise<{ ok: boolean; group_jid?: string; error?: string }> {
  // Já tem grupo? Não cria outro.
  const { data: lead } = await supabase
    .from('leads')
    .select('whatsapp_group_id')
    .eq('id', params.lead_id)
    .maybeSingle();
  if (lead?.whatsapp_group_id) {
    return { ok: true, group_jid: lead.whatsapp_group_id };
  }

  // Resolve instance_id pelo instance_name
  let creator_instance_id: string | null = null;
  if (params.instance_name) {
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .ilike('instance_name', params.instance_name)
      .maybeSingle();
    creator_instance_id = inst?.id || null;
  }

  // Tenta sincronamente via create-whatsapp-group (Cloud, política de nome já aplicada)
  try {
    const resp = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/create-whatsapp-group`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUD_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lead_id: params.lead_id,
        lead_name: params.lead_name,
        phone: params.lead_phone,
        contact_phone: params.lead_phone,
        board_id: params.board_id,
        creator_instance_id,
        creation_origin: 'auto_post_sign',
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (data?.success && data?.group_id) {
      await supabase
        .from('leads')
        .update({ whatsapp_group_id: data.group_id })
        .eq('id', params.lead_id);
      return { ok: true, group_jid: data.group_id };
    }
    throw new Error(data?.error || `create-whatsapp-group ${resp.status}`);
  } catch (e: any) {
    // Falhou: enfileira retry
    const errMsg = e?.message || String(e);
    console.warn('[post-sign-extras] group create failed, queuing retry:', errMsg);
    await supabase.from('group_creation_queue').insert({
      lead_id: params.lead_id,
      lead_name: params.lead_name,
      phone: params.lead_phone,
      contact_phone: params.lead_phone,
      board_id: params.board_id,
      instance_name: params.instance_name,
      creation_origin: 'auto_post_sign',
      status: 'pending',
      last_error: errMsg,
    });
    return { ok: false, error: errMsg };
  }
}

async function importWhatsAppDocs(params: {
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  signed_at: Date;
}): Promise<number> {
  const sevenDaysBefore = new Date(params.signed_at.getTime() - 7 * 24 * 60 * 60 * 1000);
  const phoneNorm = params.lead_phone.replace(/\D/g, '');
  const last10 = phoneNorm.slice(-10);

  const { data: msgs } = await supabase
    .from('whatsapp_messages')
    .select('message_id, media_type, media_url, media_filename, created_at')
    .ilike('phone', `%${last10}%`)
    .in('media_type', ['document', 'image'])
    .gte('created_at', sevenDaysBefore.toISOString())
    .lte('created_at', params.signed_at.toISOString())
    .not('media_url', 'is', null);

  if (!msgs || msgs.length === 0) return 0;

  // Chama import-group-docs-to-lead (Cloud) com classificação default; classifica depois.
  // Para evitar recodificar todo o pipeline de mídia, delegamos ao import existente.
  const docs = msgs.map((m: any) => ({
    message_id: m.message_id,
    document_type: 'Outro', // será reclassificado abaixo via update
  }));

  try {
    const resp = await fetch(`${CLOUD_FUNCTIONS_URL}/functions/v1/import-group-docs-to-lead`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUD_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lead_id: params.lead_id,
        lead_name: params.lead_name,
        documents: docs,
      }),
    });
    if (!resp.ok) {
      console.warn('[post-sign-extras] import-group-docs status', resp.status);
      return 0;
    }
    const data: any = await resp.json().catch(() => ({}));
    const imported: any[] = data?.imported || data?.documents || [];

    // Reclassifica via IA (best effort)
    for (const item of imported) {
      const docId = item?.id || item?.document_id;
      const url = item?.file_url || item?.url;
      const name = item?.file_name || item?.name || 'doc';
      if (!docId || !url) continue;
      const cls = await classifyDocument(url, name);
      await supabase
        .from('process_documents')
        .update({ document_type: cls.type, title: `Doc original (WhatsApp) - ${cls.title}` })
        .eq('id', docId);
    }

    return imported.length;
  } catch (e) {
    console.warn('[post-sign-extras] import-group-docs error:', e);
    return 0;
  }
}

async function importZapSignExtraDocs(params: {
  lead_id: string;
  lead_name: string;
  doc_token: string;
  uploaded_by: string | null;
  contact_id: string | null;
}): Promise<number> {
  const extras = await fetchExtraDocsFromZapSign(params.doc_token);
  if (extras.length === 0) return 0;

  let count = 0;
  for (const x of extras) {
    try {
      const cls = await classifyDocument(x.url, x.name);
      const { error } = await supabase.from('process_documents').insert({
        lead_id: params.lead_id,
        document_type: cls.type,
        title: `Doc original (ZapSign) - ${cls.title}`,
        source: 'zapsign_extra',
        file_url: x.url,
        original_url: x.url,
        file_name: x.name,
        uploaded_by: params.uploaded_by,
        zapsign_document_id: params.doc_token,
        document_date: new Date().toISOString().slice(0, 10),
        metadata: { contact_id: params.contact_id },
      });
      if (!error) count++;
      else console.warn('[post-sign-extras] insert extra-doc error:', error);
    } catch (e) {
      console.warn('[post-sign-extras] extra-doc loop error:', e);
    }
  }
  return count;
}

export async function runPostSignExtras(input: PostSignInput): Promise<void> {
  const { doc_token } = input;
  if (!doc_token) {
    console.warn('[post-sign-extras] missing doc_token');
    return;
  }

  // Busca o documento no Externo
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

  const leadPhone = (lead.lead_phone || '').replace(/\D/g, '');

  // 1. Cria grupo (idempotente; com retry queue)
  if (leadPhone) {
    const g = await ensureGroup({
      lead_id: doc.lead_id,
      lead_phone: leadPhone,
      lead_name: lead.lead_name || doc.signer_name || 'Lead',
      board_id: lead.board_id || null,
      instance_name: doc.instance_name || null,
    });
    console.log('[post-sign-extras] group:', g);
  }

  // 2. Importa docs originais do WhatsApp (últimos 7d antes da assinatura)
  if (leadPhone && doc.signed_at) {
    const n = await importWhatsAppDocs({
      lead_id: doc.lead_id,
      lead_name: lead.lead_name || 'Lead',
      lead_phone: leadPhone,
      signed_at: new Date(doc.signed_at),
    });
    console.log('[post-sign-extras] whatsapp docs imported:', n);
  }

  // 3. Importa extras do envelope ZapSign
  const n2 = await importZapSignExtraDocs({
    lead_id: doc.lead_id,
    lead_name: lead.lead_name || 'Lead',
    doc_token,
    uploaded_by: doc.created_by || null,
    contact_id: doc.contact_id || null,
  });
  console.log('[post-sign-extras] zapsign extras imported:', n2);
}

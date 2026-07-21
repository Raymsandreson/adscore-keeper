// Extrai dados estruturados (lead OU contato) a partir das mensagens
// recentes do WhatsApp + contexto de ligações (resumos CallFace).
//
// Substitui a edge function Cloud `extract-conversation-data` que era um
// proxy pro Externo. Aqui consultamos o Externo direto e chamamos a Lovable AI Gateway.
//
// Body: { phone, instance_name, targetType: 'lead'|'contact', extra_context?, call_summaries?,
//         include_documents?, max_documents? }
// Retorno: HTTP 200 { success, data?: {...}, error? }
//
// include_documents (default false): quando true, anexa ao prompt as imagens e
// PDFs enviados na conversa/grupo (RG, CNH, procuração, comprovante de endereço)
// para o Gemini ler via OCR multimodal. Fica opt-in porque multiplica o custo da
// chamada — só os gatilhos manuais ligam. Os chamadores automáticos
// (create-whatsapp-group, zapsign-webhook) seguem em modo texto puro.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';

const LEAD_FIELDS = [
  'lead_name', 'victim_name', 'lead_email', 'city', 'state', 'neighborhood',
  'main_company', 'contractor_company', 'accident_address', 'accident_date',
  'damage_description', 'case_number', 'case_type', 'notes', 'sector',
  'visit_city', 'visit_state', 'visit_address', 'liability_type', 'news_link',
  'expected_birth_date', 'client_classification',
];

const CONTACT_FIELDS = [
  'full_name', 'phone', 'email', 'city', 'state', 'neighborhood',
  'notes', 'instagram_url', 'instagram_username', 'profession',
  'cpf', 'rg', 'cep', 'street', 'street_number', 'complement', 'birth_date',
];

const IDENTIFIED_CONTACT_FIELDS = [
  'full_name', 'phone', 'role', 'cpf', 'rg', 'birth_date',
  'cep', 'state', 'city', 'neighborhood', 'street', 'street_number', 'complement',
  'email', 'profession', 'notes',
];

type CustomFieldSpec = { id: string; label: string; type?: string; options?: string[] };
type VisibleMessage = {
  direction?: string;
  sender_name?: string | null;
  contact_name?: string | null;
  message_text?: string | null;
  message_type?: string | null;
  media_type?: string | null;
  created_at?: string | null;
};

const PT_MONTHS: Record<string, number> = {
  janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function extractNearestMaternityDate(text: string): string | null {
  const source = String(text || '');
  if (!/(parto|gesta[cç][aã]o|beb[eê]|nasciment|maternidade)/i.test(source)) return null;

  const now = new Date();
  const candidates: Date[] = [];
  const pushDate = (day: number, month: number, year?: number) => {
    if (!day || month < 0 || day > 31) return;
    let y = year || now.getFullYear();
    let d = new Date(Date.UTC(y, month, day));
    if (!year && d.getTime() < now.getTime() - 30 * 86400000) {
      d = new Date(Date.UTC(y + 1, month, day));
    }
    if (d.getUTCDate() === day && d.getUTCMonth() === month) candidates.push(d);
  };

  for (const m of source.matchAll(/\b(\d{1,2})\s*(?:de\s*)?(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s*(?:de)?\s*(20\d{2}))?/gi)) {
    const month = PT_MONTHS[m[2].toLowerCase().replace('ç', 'c')] ?? PT_MONTHS[m[2].toLowerCase()];
    pushDate(Number(m[1]), month, m[3] ? Number(m[3]) : undefined);
  }
  for (const m of source.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/g)) {
    pushDate(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : undefined);
  }
  if (candidates.length === 0) return null;
  const future = candidates.filter(d => d.getTime() >= now.getTime() - 86400000);
  const pool = future.length > 0 ? future : candidates;
  pool.sort((a, b) => a.getTime() - b.getTime());
  return toIsoDate(pool[0]);
}

function buildSchemaPrompt(targetType: 'lead' | 'contact', customFields: CustomFieldSpec[] = [], hasDocs = false): string {
  const fields = targetType === 'lead' ? LEAD_FIELDS : CONTACT_FIELDS;
  let prompt = `Retorne APENAS um objeto JSON puro (sem markdown, sem \`\`\`) com as chaves padrão: ${fields.join(', ')}.
Inclua somente as chaves cujo valor você conseguiu inferir COM CONFIANÇA da conversa/contexto.
Omita chaves desconhecidas — NÃO chute, NÃO use "N/A", NÃO use null.
Datas no formato YYYY-MM-DD. Telefones somente dígitos. CPF/RG somente dígitos. CEP só dígitos (8).`;

  if (targetType === 'lead') {
    prompt += `\nPara maternidade/parto: quando aparecer previsão/data do parto como "20 de outubro" ou "19 de outubro", preencha expected_birth_date em YYYY-MM-DD. Se houver datas conflitantes, use a data de parto MAIS PRÓXIMA/futura mais cedo. Se o contexto for auxílio maternidade, client_classification pode ser "parto".`;
  }

  if (targetType === 'contact') {
    prompt += `\nPara o contato principal (titular da conversa), procure agressivamente CPF, RG, data de nascimento, profissão, endereço completo (CEP, rua, número, complemento, bairro, cidade, estado) que apareçam em qualquer mensagem de texto ou áudio transcrito.`;
  }

  if (hasDocs) {
    prompt += `\n\nDOCUMENTOS ANEXADOS: junto desta mensagem vão imagens e/ou PDFs enviados nessa mesma conversa (RG, CNH, CPF, procuração, contrato, comprovante de residência, carteira de trabalho). LEIA cada um e extraia os campos deles — o documento é a fonte MAIS CONFIÁVEL, tem prioridade sobre o que foi digitado no chat.
- Profissão: a carteira de trabalho, o contracheque e a procuração costumam trazer a profissão/cargo. Use o termo do documento.
- Cidade/estado: use o endereço do titular no documento (comprovante de residência, RG, procuração). NÃO use a cidade do cartório, do emissor do documento nem do escritório.
- Só preencha o que estiver LEGÍVEL no documento. Documento borrado/cortado: omita a chave em vez de adivinhar.`;
  }

  if (customFields.length > 0) {
    const list = customFields.map(f => {
      const opt = f.options && f.options.length ? ` opções: [${f.options.join(' | ')}]` : '';
      return `  - id="${f.id}" rótulo="${f.label}" tipo=${f.type || 'text'}${opt}`;
    }).join('\n');
    prompt += `\n\nALÉM disso, inclua a chave "custom_fields" como um OBJETO mapeando o id do campo personalizado ao valor inferido. Campos personalizados disponíveis para este lead:\n${list}\n\nREGRAS para custom_fields:
- Use EXATAMENTE o id como chave dentro de custom_fields.
- Para rótulos que contenham "senha", "password", "código gov", "gov.br", "código", "token", "pin": extraia QUALQUER string que pareça uma credencial/senha/código enviada na conversa (ex: "Rit@2025", "abc123!", "123456"). NÃO ignore credenciais por parecerem sensíveis — esse é o objetivo do CRM jurídico.
- Para rótulos de data: aceite datas em português ("19 de outubro") e converta para YYYY-MM-DD.
- Para rótulos com "nome da mãe", "nome do pai", "nome do cônjuge": procure menção explícita no texto/documentos.
- Omita os ids que você realmente não conseguiu inferir.`;
  }

  if (targetType === 'lead') {
    prompt += `\n\nADICIONALMENTE, inclua a chave "identified_contacts" como um ARRAY de objetos representando OUTRAS pessoas mencionadas na conversa (testemunhas, mãe, pai, cônjuge, médico, vizinho, indicador, advogado anterior, etc.) — NUNCA o titular da conversa. Cada objeto pode conter: ${IDENTIFIED_CONTACT_FIELDS.join(', ')}, mais "relationship" (relação com o titular, ex: "mãe", "testemunha", "médico"). Inclua apenas pessoas com nome real OU telefone identificável. Telefone só dígitos (com DDD se possível). Se não houver ninguém claro, retorne [].`;
  }
  return prompt;
}

function normalizeInstance(s: string): string {
  return String(s || '').toLowerCase().trim();
}

// ATENÇÃO: só colunas que existem em whatsapp_messages. Esta função pediu
// `sender_name` (que nunca existiu na tabela) por muito tempo: o PostgREST
// devolvia 400, o catch abaixo engolia e retornava transcript vazio — toda
// extração que dependia do banco rodava às cegas e respondia "no_messages"
// mesmo com centenas de mensagens. Por isso o erro agora é propagado.
// Colunas reais: id, phone, contact_name, message_text, message_type, media_url,
// media_type, direction, status, contact_id, lead_id, external_message_id,
// metadata, created_at, read_at, instance_name, instance_token, campaign_id,
// campaign_name, action_source, action_source_detail.
type FetchedTranscript = { transcript: string; title: string | null; error: string | null };

async function fetchRecentMessages(phone: string, instance: string, limit = 120): Promise<FetchedTranscript> {
  const { data, error } = await ext
    .from('whatsapp_messages')
    .select('direction, contact_name, message_text, message_type, created_at')
    .eq('phone', phone)
    .ilike('instance_name', instance)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[extract-conversation-data] fetch msgs err:', error.message);
    return { transcript: '', title: null, error: error.message };
  }
  if (!data || data.length === 0) return { transcript: '', title: null, error: null };

  // Em grupo, contact_name guarda o TÍTULO do grupo (não o remetente). O título é
  // contexto valioso: o padrão do escritório embute nome do cliente e cidade.
  const title = (data.find((m: any) => String(m.contact_name || '').trim()) as any)?.contact_name?.trim() || null;

  const lines = data
    .slice()
    .reverse()
    .map((m: any) => {
      const who = m.direction === 'outbound' ? 'ATENDENTE' : 'CLIENTE';
      const ts = m.created_at ? new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ') : '';
      const txt = (m.message_text || `[${m.message_type || 'mídia'}]`).toString().slice(0, 800);
      return `[${ts}] ${who}: ${txt}`;
    });
  return { transcript: lines.join('\n').slice(0, 60000), title, error: null };
}

// ============================================================
// Documentos da conversa (OCR multimodal)
// ============================================================

// Gemini aceita inlineData só nesses mimes. Vídeo/áudio/office ficam de fora —
// áudio já entra pelo transcript (o webhook grava a transcrição em message_text).
const DOC_MIMES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif',
]);
const MAX_DOC_BYTES = 8 * 1024 * 1024;

// URL do CDN do WhatsApp é blob AES — baixar direto devolve lixo binário. O
// webhook normalmente já re-hospeda a mídia decriptada no Storage e grava essa
// URL; quando a decriptação falhou, sobra a original, que precisa ser ignorada.
// Mesma heurística de whatsapp-webhook.ts:300.
function isEncryptedWhatsAppUrl(url?: string | null): boolean {
  if (typeof url !== 'string') return false;
  if (/\.enc(?:\?|$)/i.test(url)) return true;
  if (/^https?:\/\/(?:[a-z0-9-]+\.)*whatsapp\.net\//i.test(url)) return true;
  return false;
}

// Extensão → mime. Necessário porque ~900 documentos no Storage têm media_type
// nulo no banco e só a URL diz o que é (`...9927.pdf`, `...8811.webp`).
// `.bin` fica de fora de propósito: tipo desconhecido, não vale mandar pro modelo.
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};

function normalizeDocMime(mediaType?: string | null, messageType?: string | null, url?: string | null): string | null {
  const raw = String(mediaType || '').toLowerCase().split(';')[0].trim();
  if (DOC_MIMES.has(raw)) return raw === 'image/jpg' ? 'image/jpeg' : raw;
  if (raw.includes('pdf')) return 'application/pdf';

  // media_type ausente ou genérico (application/octet-stream): tenta a extensão.
  const ext = String(url || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
  if (EXT_MIME[ext]) return EXT_MIME[ext];

  // Último recurso: só quando o WhatsApp classificou como imagem. Documento sem
  // mime nem extensão conhecida (docx, zip, .bin) é descartado.
  if (String(messageType || '').toLowerCase() === 'image') return 'image/jpeg';
  if (raw.startsWith('image/')) return 'image/jpeg';
  return null;
}

async function toDataUri(url: string, mime: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) {
      console.warn('[extract-conversation-data] doc fetch', r.status, url.slice(0, 120));
      return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 100 || buf.length > MAX_DOC_BYTES) {
      console.warn('[extract-conversation-data] doc ignorado por tamanho:', buf.length);
      return null;
    }
    // Content-type do Storage vence quando é específico; senão mantém o do banco.
    const ct = String(r.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    const finalMime = DOC_MIMES.has(ct) ? (ct === 'image/jpg' ? 'image/jpeg' : ct) : mime;
    return `data:${finalMime};base64,${buf.toString('base64')}`;
  } catch (e: any) {
    console.warn('[extract-conversation-data] doc fetch err:', String(e?.message || e).slice(0, 200));
    return null;
  }
}

type ConversationDoc = { dataUri: string; label: string };

// Pega os documentos MAIS RECENTES da conversa: procuração/RG costumam vir no
// começo do atendimento, mas o volume de mídia antiga (foto de acidente, print)
// não compensa o custo — por isso o teto e a ordem decrescente.
async function fetchConversationDocuments(
  phone: string,
  instance: string,
  maxDocs: number,
): Promise<ConversationDoc[]> {
  const { data, error } = await ext
    .from('whatsapp_messages')
    .select('media_url, media_type, message_type, created_at')
    .eq('phone', phone)
    .ilike('instance_name', instance)
    .not('media_url', 'is', null)
    .in('message_type', ['image', 'document'])
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) {
    console.warn('[extract-conversation-data] fetch docs err:', error.message);
    return [];
  }

  const candidates: Array<{ url: string; mime: string; label: string }> = [];
  const seen = new Set<string>();
  for (const m of (data || []) as any[]) {
    const url = m.media_url as string;
    if (!url || seen.has(url) || isEncryptedWhatsAppUrl(url)) continue;
    const mime = normalizeDocMime(m.media_type, m.message_type, url);
    if (!mime) continue;
    seen.add(url);
    const ts = m.created_at ? String(m.created_at).slice(0, 10) : 's/data';
    candidates.push({ url, mime, label: `${m.message_type === 'document' ? 'documento' : 'imagem'} de ${ts}` });
    if (candidates.length >= maxDocs) break;
  }

  const fetched = await Promise.all(
    candidates.map(async (c) => {
      const dataUri = await toDataUri(c.url, c.mime);
      return dataUri ? { dataUri, label: c.label } : null;
    }),
  );
  return fetched.filter(Boolean) as ConversationDoc[];
}

function buildTranscriptFromVisibleMessages(messages: VisibleMessage[]): string {
  const lines = messages
    .slice(-300)
    .map((m: any) => {
      const who = m.direction === 'outbound' ? 'ATENDENTE' : (m.sender_name || m.contact_name || 'CLIENTE');
      const ts = m.created_at ? new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ') : '';
      const txt = (m.message_text || `[${m.message_type || m.media_type || 'mídia'}]`).toString().slice(0, 1000);
      return `[${ts}] ${who}: ${txt}`;
    })
    .filter(Boolean);
  return lines.join('\n').slice(0, 80000);
}

async function callAI(systemPrompt: string, userContent: string | any[]): Promise<Record<string, any>> {
  if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY ausente no Railway');
  let parsed: any;
  try {
    parsed = await geminiChat({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt + '\n\nIMPORTANTE: Responda APENAS com JSON válido, sem markdown.' },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    });
  } catch (e: any) {
    throw new Error(`Gemini ${e?.status || ''}: ${String(e?.message || e).slice(0, 400)}`);
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (!content) return {};
  try {
    const cleaned = String(content).replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) {
    console.warn('[extract-conversation-data] não conseguiu parsear JSON da IA:', String(content).slice(0, 200));
    return {};
  }
}


function whitelist(obj: Record<string, any>, allowed: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of allowed) {
    const v = obj?.[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === '' || s === 'N/A' || s === 'null' || s === 'undefined') continue;
    out[k] = s;
  }
  return out;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { phone, instance_name, targetType, extra_context, call_summaries, custom_fields, visible_messages, include_documents, max_documents } = (req.body || {}) as {
      phone?: string;
      instance_name?: string;
      targetType?: 'lead' | 'contact';
      extra_context?: string;
      call_summaries?: string;
      custom_fields?: CustomFieldSpec[];
      visible_messages?: VisibleMessage[];
      include_documents?: boolean;
      max_documents?: number;
    };

    if (!phone || !instance_name) return ok({ success: false, error: 'phone e instance_name obrigatórios' });
    const target: 'lead' | 'contact' = targetType === 'contact' ? 'contact' : 'lead';
    const customs: CustomFieldSpec[] = (target === 'lead' && Array.isArray(custom_fields)) ? custom_fields.filter(c => c && c.id && c.label) : [];

    const visibleTranscript = Array.isArray(visible_messages) ? buildTranscriptFromVisibleMessages(visible_messages) : '';
    const db = await fetchRecentMessages(phone, normalizeInstance(instance_name));
    const dbTranscript = db.transcript;
    const transcript = [visibleTranscript && '=== MENSAGENS JÁ CARREGADAS NA TELA ===\n' + visibleTranscript, dbTranscript && '=== MENSAGENS BUSCADAS NO BANCO ===\n' + dbTranscript].filter(Boolean).join('\n\n');

    // Documentos entram só quando o chamador pede (gatilho manual). Falha ao
    // baixar não derruba a extração — degrada pro modo texto puro.
    const maxDocs = Math.max(1, Math.min(8, Number(max_documents) || 6));
    let docs: ConversationDoc[] = [];
    if (include_documents === true) {
      try {
        docs = await fetchConversationDocuments(phone, normalizeInstance(instance_name), maxDocs);
      } catch (e: any) {
        console.warn('[extract-conversation-data] docs falharam, seguindo só com texto:', String(e?.message || e).slice(0, 200));
      }
    }

    // Erro de consulta não pode se disfarçar de "conversa vazia" — foi assim que a
    // coluna inexistente passou despercebida. Sem material E com erro = falha.
    if (!transcript && !extra_context && !call_summaries && docs.length === 0) {
      if (db.error) return ok({ success: false, error: `falha ao ler mensagens: ${db.error}` });
      return ok({ success: true, data: {}, reason: 'no_messages' });
    }

    const callBlock = [extra_context, call_summaries].filter(Boolean).join('\n\n').slice(0, 30000);
    const systemPrompt = [
      'Você é um extrator de dados estruturados para um CRM jurídico brasileiro (cobre acidentes de trabalho, previdenciário, maternidade e outros).',
      docs.length > 0
        ? 'Analisa transcrições do WhatsApp, resumos de ligações telefônicas e documentos (imagens/PDFs) enviados na conversa.'
        : 'Analisa transcrições do WhatsApp e resumos de ligações telefônicas.',
      buildSchemaPrompt(target, customs, docs.length > 0),
    ].join('\n\n');

    const userParts: string[] = [];
    if (db.title) {
      // O título do grupo segue um padrão interno que embute nome do cliente e
      // cidade (ex.: "✅Prev 06 |Fulano de Tal| Teresina-Pi |29/10/2025/ MILLA").
      // Mas embute TAMBÉM o código do caso e o apelido do assessor responsável —
      // daí a lista explícita do que NÃO é nome de cliente.
      userParts.push('=== TÍTULO DA CONVERSA/GRUPO ===');
      userParts.push(String(db.title).slice(0, 300));
      userParts.push(`Esse título é do escritório e costuma trazer, entre barras/pipes, o NOME DO CLIENTE e a CIDADE-UF.
NÃO confunda com: código do caso ("Prev 06", "PREV 542", "ATV 12"), data, emoji de status, nem o primeiro nome do ASSESSOR responsável (costuma vir por último, em caixa alta, depois da data).
Use o título só quando a conversa e os documentos não contradisserem. Se não der pra separar cliente de assessor com segurança, omita o campo.`);
    }
    if (callBlock) {
      userParts.push('=== CONTEXTO DE LIGAÇÕES (CallFace) ===');
      userParts.push(callBlock);
    }
    if (transcript) {
      userParts.push('=== CONVERSA WHATSAPP (mais antiga → mais recente) ===');
      userParts.push(transcript);
    }
    if (docs.length > 0) {
      userParts.push(`=== DOCUMENTOS ANEXADOS (${docs.length}) ===`);
      userParts.push(docs.map((d, i) => `${i + 1}. ${d.label}`).join('\n'));
    }
    userParts.push(
      docs.length > 0
        ? '\nExtraia os campos solicitados a partir de TODO o material acima (conversa + ligações + documentos anexados).'
        : '\nExtraia os campos solicitados a partir de TODO o material acima (conversa + ligações).',
    );

    const userPrompt = userParts.join('\n\n');
    const userContent = docs.length > 0
      ? [
        { type: 'text', text: userPrompt },
        ...docs.map(d => ({ type: 'image_url', image_url: { url: d.dataUri } })),
      ]
      : userPrompt;
    const raw = await callAI(systemPrompt, userContent);
    const allowed = target === 'lead' ? LEAD_FIELDS : CONTACT_FIELDS;
    const data: Record<string, any> = whitelist(raw, allowed);

    if (target === 'lead' && !data.expected_birth_date) {
      const deterministicBirthDate = extractNearestMaternityDate(`${callBlock}\n\n${transcript}`);
      if (deterministicBirthDate) data.expected_birth_date = deterministicBirthDate;
    }

    if (customs.length > 0) {
      const rawCustom = (raw && typeof raw.custom_fields === 'object' && raw.custom_fields) ? raw.custom_fields : {};
      const allowedIds = new Set(customs.map(c => c.id));
      const cleanCustom: Record<string, any> = {};
      for (const [k, v] of Object.entries(rawCustom)) {
        if (!allowedIds.has(k)) continue;
        if (v === undefined || v === null) continue;
        const s = typeof v === 'string' ? v.trim() : v;
        if (s === '' || s === 'N/A' || s === 'null' || s === 'undefined') continue;
        cleanCustom[k] = s;
      }
      if (Object.keys(cleanCustom).length > 0) data.custom_fields = cleanCustom;
    }

    if (target === 'lead' && Array.isArray(raw?.identified_contacts)) {
      const identified = raw.identified_contacts
        .filter((p: any) => p && typeof p === 'object')
        .map((p: any) => {
          const clean: Record<string, any> = {};
          for (const k of [...IDENTIFIED_CONTACT_FIELDS, 'relationship']) {
            const v = p?.[k];
            if (v === undefined || v === null) continue;
            const s = typeof v === 'string' ? v.trim() : v;
            if (s === '' || s === 'N/A' || s === 'null' || s === 'undefined') continue;
            clean[k] = s;
          }
          return clean;
        })
        .filter((p: Record<string, any>) => p.full_name || p.phone);
      if (identified.length > 0) data.identified_contacts = identified;
    }

    return ok({ success: true, data, model: MODEL, target, message_count: transcript ? transcript.split('\n').length : 0, documents_read: docs.length, source: { visible_messages: Array.isArray(visible_messages) ? visible_messages.length : 0, db: dbTranscript ? dbTranscript.split('\n').length : 0, documents: docs.map(d => d.label), title: db.title, db_error: db.error } });
  } catch (e: any) {
    console.error('[extract-conversation-data] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

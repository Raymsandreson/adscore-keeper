// Edge function: enrich-news-leads
// Enriquece leads de notícia (board Trabalhista, status noticias/viavel) a partir do TÍTULO:
// extrai vítima, cidade/UF e classifica se o evento ocorreu fora do Brasil.
// Estrangeiras recebem news_foreign=true e são arquivadas (soft-delete via deleted_at, restaurável).
//
// Self-contained de propósito: o deploy via Management API sobe arquivo único,
// então Gemini e PostgREST são chamados inline (sem imports de _shared / supabase-js).
// Deploy: SUPABASE_PAT=sbp_... node _deploy_enrich_news_leads.mjs (ref kmedldlepwiityjsdahz)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const TRABALHISTA_BOARD_ID = '2dcd54b5-502b-413b-b795-5e24a20797d2'

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'number', description: 'Índice do item, igual ao recebido na lista.' },
          victim_name: { type: 'string', description: 'Nome próprio da vítima se aparecer no título. Vazio se não houver. NUNCA invente.' },
          city: { type: 'string', description: 'Cidade onde o evento ocorreu, deduzida do título (cidade citada, rodovia, bairro). Vazio se não houver pista.' },
          state: { type: 'string', description: 'UF de 2 letras maiúsculas (ex: PR, SP). Deduza pela cidade/rodovia quando inequívoco. Vazio se incerto.' },
          is_foreign: { type: 'boolean', description: 'true se o EVENTO ocorreu fora do Brasil. Título em inglês/espanhol, veículo estrangeiro noticiando evento local dele, ou local claramente fora do Brasil (mesmo com título traduzido para português) => true. Veículo estrangeiro cobrindo evento NO Brasil => false. Na dúvida => false.' },
        },
        required: ['i', 'is_foreign'],
      },
    },
  },
  required: ['items'],
}

const SYSTEM_PROMPT = `Você faz triagem de manchetes de notícias para um escritório de advocacia trabalhista brasileiro.
Para CADA manchete da lista, chame record_enrichment com: índice, nome da vítima (só se estiver no título), cidade e UF do evento, e is_foreign.
Regras:
- Extraia SOMENTE do título e do domínio do site. NUNCA invente nome de vítima.
- Cidade/UF: use a cidade citada; rodovias estaduais indicam a UF (PR-151 => PR, BR-xxx não indica UF sozinha). Se o domínio for de portal regional conhecido, pode usar como pista secundária.
- is_foreign: julgue pelo LOCAL DO EVENTO, não pelo idioma. Título em português mas evento no exterior (ex: veículo estrangeiro com página traduzida) => true. Evento no Brasil => false. Na dúvida, false.
- Responda para TODOS os índices recebidos.`

async function restFetch(path: string, init: RequestInit, supabaseUrl: string, serviceKey: string) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const batchSize = Math.min(Math.max(Number(body?.batchSize) || 40, 10), 80)
    const maxBatches = Math.min(Math.max(Number(body?.maxBatches) || 6, 1), 10)

    const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!apiKey) return jsonResponse({ success: false, error: 'GOOGLE_AI_API_KEY não configurada' }, 500)
    if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'SUPABASE_URL/SERVICE_ROLE_KEY ausentes' }, 500)

    const pendingFilter =
      `board_id=eq.${TRABALHISTA_BOARD_ID}&status=in.(noticias,viavel)` +
      `&deleted_at=is.null&news_enriched_at=is.null`

    let processed = 0
    let foreignArchived = 0

    for (let b = 0; b < maxBatches; b++) {
      const sel = await restFetch(
        `leads?select=id,lead_name,news_link,victim_name,city,state&${pendingFilter}&order=created_at.desc&limit=${batchSize}`,
        { method: 'GET' }, supabaseUrl, serviceKey,
      )
      if (!sel.ok) return jsonResponse({ success: false, error: `select falhou: ${sel.status}` }, 502)
      const leads: Array<{ id: string; lead_name: string | null; news_link: string | null; victim_name: string | null; city: string | null; state: string | null }> = await sel.json()
      if (leads.length === 0) break

      const list = leads.map((l, i) => {
        let domain = ''
        try { domain = l.news_link ? new URL(l.news_link).hostname : '' } catch { /* url inválida */ }
        return `${i}. [${domain || 'sem-dominio'}] ${String(l.lead_name || '').slice(0, 200)}`
      }).join('\n')

      const geminiBody = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `Manchetes:\n${list}` }] }],
        tools: [{ functionDeclarations: [{ name: 'record_enrichment', description: 'Registra o enriquecimento de cada manchete.', parameters: ENRICH_SCHEMA }] }],
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['record_enrichment'] } },
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) },
      )
      if (!res.ok) {
        const errText = await res.text()
        console.error('[enrich-news-leads] Gemini error:', res.status, errText.slice(0, 300))
        return jsonResponse({ success: false, error: `Erro na API de IA: ${res.status}`, processed, foreign_archived: foreignArchived }, 502)
      }
      const data = await res.json()
      const parts = data?.candidates?.[0]?.content?.parts || []
      const fnCall = parts.find((p: { functionCall?: { args?: unknown } }) => p.functionCall)
      const items: Array<{ i: number; victim_name?: string; city?: string; state?: string; is_foreign?: boolean }> =
        (fnCall?.functionCall?.args as { items?: [] })?.items || []
      if (items.length === 0) {
        console.error('[enrich-news-leads] resposta sem items. finishReason:', data?.candidates?.[0]?.finishReason)
        return jsonResponse({ success: false, error: 'IA não retornou dados estruturados.', processed, foreign_archived: foreignArchived }, 502)
      }

      const byIndex = new Map(items.map((it) => [Number(it.i), it]))
      const nowIso = new Date().toISOString()

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i]
        const it = byIndex.get(i)
        const isForeign = !!it?.is_foreign
        const update: Record<string, unknown> = {
          news_enriched_at: nowIso,
          news_foreign: isForeign,
        }
        const victim = String(it?.victim_name || '').trim()
        const city = String(it?.city || '').trim()
        const state = String(it?.state || '').trim().toUpperCase()
        if (victim && !String(lead.victim_name || '').trim()) update.victim_name = victim.slice(0, 120)
        if (city && !String(lead.city || '').trim()) update.city = city.slice(0, 80)
        if (/^[A-Z]{2}$/.test(state) && !String(lead.state || '').trim()) update.state = state
        if (isForeign) update.deleted_at = nowIso

        const up = await restFetch(`leads?id=eq.${lead.id}`, { method: 'PATCH', body: JSON.stringify(update) }, supabaseUrl, serviceKey)
        if (!up.ok) {
          console.error('[enrich-news-leads] update falhou:', lead.id, up.status)
          continue
        }
        processed++
        if (isForeign) foreignArchived++
      }
      // Log sem título/nome (pode conter dado pessoal) — só contadores.
      console.log(`[enrich-news-leads] lote ${b + 1}: ${leads.length} analisados, ${foreignArchived} estrangeiras até agora`)
    }

    const cnt = await restFetch(`leads?select=id&${pendingFilter}&limit=1`, {
      method: 'HEAD', headers: { Prefer: 'count=exact' },
    }, supabaseUrl, serviceKey)
    const range = cnt.headers.get('content-range') || ''
    const remaining = Number(range.split('/')[1]) || 0

    return jsonResponse({ success: true, processed, foreign_archived: foreignArchived, remaining })
  } catch (e) {
    console.error('[enrich-news-leads] error:', e)
    return jsonResponse({ success: false, error: (e as Error)?.message || 'unknown error' }, 500)
  }
})

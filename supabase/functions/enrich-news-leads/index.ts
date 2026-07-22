// Edge function: enrich-news-leads
// Enriquece leads de notícia (board Trabalhista, status noticias/viavel) a partir do TÍTULO:
// extrai vítima, cidade/UF, classifica se o evento ocorreu fora do Brasil E se é um
// caso trabalhista VIÁVEL (acidente de trabalho c/ dano grave e tomadora identificável).
// Estrangeiras recebem news_foreign=true e são arquivadas (soft-delete via deleted_at, restaurável).
// Viáveis recebem status='viavel' (aparecem na aba Viáveis da página de Notícias).
//
// Body (todos opcionais):
//   batchSize  (8..40, default 12)   — itens por lote enviados ao Gemini
//   maxBatches (1..10,  default 6)   — só no modo normal (news_enriched_at IS NULL)
//   sinceDays  (1..30)               — BACKFILL: reprocessa notícias criadas nos últimos N dias
//                                      (mesmo já enriquecidas), pra (re)julgar viabilidade
//   dryRun     (true/false)          — simula: NÃO escreve nada, só devolve o que seria feito
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
          is_viable: { type: 'boolean', description: 'true em DOIS casos: (1) ACIDENTE DE TRABALHO típico — vínculo/atividade laboral clara (trabalhador, operário, funcionário, servidor, pessoa em serviço: obra, fábrica, fazenda, mina, caminhoneiro/motorista a trabalho, entrega, construção) + dano GRAVE (morte, mutilação, amputação, queda, soterramento, choque, explosão, queimadura grave) + empresa/tomadora identificável ou dedutível; OU (2) ACIDENTE DE TRAJETO — vítima claramente indo ao/voltando do trabalho (ex: "iam ao trabalho", "a caminho do serviço", "ônibus de trabalhadores") + dano grave. Marque FALSE mesmo com vítima grave para: detento/preso em trabalho prisional ou ressocialização (sem vínculo empregatício); acidente de trânsito em que o título NÃO diz que a vítima estava a trabalho nem em trajeto; qualquer coisa fora de trabalho (turista, lazer, esporte, doméstico); sem vítima/dano leve; título vago. NA DÚVIDA => false.' },
          viability_reason: { type: 'string', description: 'Frase curta (até 12 palavras) justificando quando is_viable=true. Vazio quando is_viable=false.' },
        },
        required: ['i', 'is_foreign'],
      },
    },
  },
  required: ['items'],
}

const SYSTEM_PROMPT = `Você faz triagem de manchetes de notícias para um escritório de advocacia trabalhista brasileiro especializado em ACIDENTE DE TRABALHO.
Para CADA manchete da lista, chame record_enrichment com: índice, nome da vítima (só se estiver no título), cidade e UF do evento, is_foreign, is_viable e viability_reason.
Regras de extração:
- Extraia SOMENTE do título e do domínio do site. NUNCA invente nome de vítima.
- Cidade/UF: use a cidade citada; rodovias estaduais indicam a UF (PR-151 => PR, BR-xxx não indica UF sozinha). Se o domínio for de portal regional conhecido, pode usar como pista secundária.
- is_foreign: julgue pelo LOCAL DO EVENTO, não pelo idioma. Título em português mas evento no exterior (ex: veículo estrangeiro com página traduzida) => true. Evento no Brasil => false. Na dúvida, false.
Regras de viabilidade (is_viable=true) — marque true em UM DOS DOIS casos:
CASO 1 — ACIDENTE DE TRABALHO (exige os três):
- (a) VÍNCULO/ATIVIDADE LABORAL: trabalhador, operário, funcionário, empregado, servidor, ou pessoa claramente em serviço (obra, fábrica, fazenda, mina, caminhoneiro/motorista a trabalho, entrega, construção civil).
- (b) DANO GRAVE: morte OU lesão grave (mutilação, amputação, queda de altura, soterramento, choque elétrico, explosão, queimadura grave).
- (c) EMPRESA/TOMADORA identificável ou dedutível pelo contexto (obra, indústria, fábrica, fazenda, transportadora, mineradora).
CASO 2 — ACIDENTE DE TRAJETO: vítima claramente a caminho do ou voltando do trabalho (ex: "iam ao trabalho", "a caminho do serviço", "ônibus de trabalhadores/funcionários") + dano grave.
Marque FALSE (mesmo com vítima grave) quando:
- DETENTO/PRESO em trabalho prisional ou de ressocialização (não há vínculo empregatício).
- ACIDENTE DE TRÂNSITO em que o título NÃO indica que a vítima estava a trabalho NEM em trajeto para o trabalho (motorista/motociclista sem contexto laboral).
- FORA DE TRABALHO: turista, lazer, esporte, doméstico, ou qualquer vítima sem indício de trabalho/trajeto.
- Sem vítima, dano leve, ou título vago demais. NA DÚVIDA => false (um humano revisa depois).
- viability_reason: frase curta (até 12 palavras) só quando is_viable=true; vazio caso contrário.
- Responda para TODOS os índices recebidos.`

type LeadRow = { id: string; lead_name: string | null; news_link: string | null; victim_name: string | null; city: string | null; state: string | null }
type EnrichItem = { i: number; victim_name?: string; city?: string; state?: string; is_foreign?: boolean; is_viable?: boolean; viability_reason?: string }

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
    // Default 8: lotes grandes fazem o Gemini embaralhar os índices `i` e o julgamento
    // de viabilidade gruda no lead errado (40 embaralhou muito; 12 ainda vazava ~3/60;
    // 8 zerou nos testes). Mantém o alinhamento título↔julgamento.
    const batchSize = Math.min(Math.max(Number(body?.batchSize) || 8, 4), 40)
    const maxBatches = Math.min(Math.max(Number(body?.maxBatches) || 6, 1), 10)
    const sinceDays = Number(body?.sinceDays) > 0 ? Math.min(Math.floor(Number(body.sinceDays)), 30) : 0
    const dryRun = body?.dryRun === true

    const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!apiKey) return jsonResponse({ success: false, error: 'GOOGLE_AI_API_KEY não configurada' }, 500)
    if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'SUPABASE_URL/SERVICE_ROLE_KEY ausentes' }, 500)

    let processed = 0
    let foreignArchived = 0
    let viablePromoted = 0
    const viableSample: Array<{ title: string; reason: string }> = []

    // Processa um lote: chama o Gemini, aplica extração + is_foreign (arquiva) + is_viable (promove).
    // Em dryRun NÃO escreve nada — só contabiliza e coleta amostra.
    async function processBatch(leads: LeadRow[]) {
      if (leads.length === 0) return

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
        // thinkingBudget 0: tokens de raciocínio contam no maxOutputTokens e estouram o lote de 40 itens
        generationConfig: { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
      }

      let items: EnrichItem[] = []
      for (let attempt = 0; attempt < 2 && items.length === 0; attempt++) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) },
        )
        if (!res.ok) {
          const errText = await res.text()
          console.error('[enrich-news-leads] Gemini error:', res.status, errText.slice(0, 300))
          if (attempt === 1) throw new Error(`Erro na API de IA: ${res.status}`)
          continue
        }
        const data = await res.json()
        const parts = data?.candidates?.[0]?.content?.parts || []
        const fnCall = parts.find((p: { functionCall?: { args?: unknown } }) => p.functionCall)
        items = ((fnCall?.functionCall?.args as { items?: EnrichItem[] })?.items) || []
        if (items.length === 0) {
          console.error('[enrich-news-leads] resposta sem items (tentativa', attempt + 1, '). finishReason:', data?.candidates?.[0]?.finishReason)
        }
      }
      if (items.length === 0) throw new Error('IA não retornou dados estruturados.')

      const byIndex = new Map(items.map((it) => [Number(it.i), it]))
      const nowIso = new Date().toISOString()

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i]
        const it = byIndex.get(i)
        const isForeign = !!it?.is_foreign
        const isViable = !isForeign && !!it?.is_viable
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
        else if (isViable) update.status = 'viavel'

        if (!dryRun) {
          const up = await restFetch(`leads?id=eq.${lead.id}`, { method: 'PATCH', body: JSON.stringify(update) }, supabaseUrl, serviceKey)
          if (!up.ok) {
            console.error('[enrich-news-leads] update falhou:', lead.id, up.status)
            continue
          }
        }
        processed++
        if (isForeign) foreignArchived++
        if (isViable) {
          viablePromoted++
          if (viableSample.length < 60) viableSample.push({ title: String(lead.lead_name || '').slice(0, 120), reason: String(it?.viability_reason || '').slice(0, 120) })
        }
      }
      // Log sem título/nome (pode conter dado pessoal) — só contadores.
      console.log(`[enrich-news-leads] lote: ${leads.length} analisados, ${foreignArchived} estrangeiras, ${viablePromoted} viáveis (dry=${dryRun})`)
    }

    if (sinceDays > 0) {
      // BACKFILL: pega TODOS os candidatos (status noticias, criados nos últimos N dias) de uma vez,
      // ANTES de qualquer escrita, e processa em fatias. Assim não dependemos do filtro "encolher"
      // conforme promovemos — o que quebraria a paginação (e travaria em dryRun, que não escreve).
      const sinceIso = new Date(Date.now() - sinceDays * 86400000).toISOString()
      const candidates: LeadRow[] = []
      for (let from = 0; from < 2000; from += 200) {
        const sel = await restFetch(
          `leads?select=id,lead_name,news_link,victim_name,city,state` +
          `&board_id=eq.${TRABALHISTA_BOARD_ID}&status=eq.noticias&deleted_at=is.null` +
          `&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=200&offset=${from}`,
          { method: 'GET' }, supabaseUrl, serviceKey,
        )
        if (!sel.ok) return jsonResponse({ success: false, error: `select backfill falhou: ${sel.status}` }, 502)
        const rows: LeadRow[] = await sel.json()
        candidates.push(...rows)
        if (rows.length < 200) break
      }
      for (let s = 0; s < candidates.length; s += batchSize) {
        await processBatch(candidates.slice(s, s + batchSize))
      }
      return jsonResponse({
        success: true, mode: `backfill_${sinceDays}d`, dry_run: dryRun,
        candidates: candidates.length, processed, foreign_archived: foreignArchived,
        viable_promoted: viablePromoted, viable_sample: viableSample,
      })
    }

    // MODO NORMAL: enriquece o que ainda não foi enriquecido (news_enriched_at IS NULL).
    const pendingFilter =
      `board_id=eq.${TRABALHISTA_BOARD_ID}&status=in.(noticias,viavel)` +
      `&deleted_at=is.null&news_enriched_at=is.null`

    for (let b = 0; b < maxBatches; b++) {
      const sel = await restFetch(
        `leads?select=id,lead_name,news_link,victim_name,city,state&${pendingFilter}&order=created_at.desc&limit=${batchSize}`,
        { method: 'GET' }, supabaseUrl, serviceKey,
      )
      if (!sel.ok) return jsonResponse({ success: false, error: `select falhou: ${sel.status}` }, 502)
      const leads: LeadRow[] = await sel.json()
      if (leads.length === 0) break
      await processBatch(leads)
    }

    const cnt = await restFetch(`leads?select=id&${pendingFilter}&limit=1`, {
      method: 'HEAD', headers: { Prefer: 'count=exact' },
    }, supabaseUrl, serviceKey)
    const range = cnt.headers.get('content-range') || ''
    const remaining = Number(range.split('/')[1]) || 0

    return jsonResponse({
      success: true, mode: 'normal', dry_run: dryRun,
      processed, foreign_archived: foreignArchived, viable_promoted: viablePromoted,
      viable_sample: viableSample, remaining,
    })
  } catch (e) {
    console.error('[enrich-news-leads] error:', e)
    return jsonResponse({ success: false, error: (e as Error)?.message || 'unknown error' }, 500)
  }
})

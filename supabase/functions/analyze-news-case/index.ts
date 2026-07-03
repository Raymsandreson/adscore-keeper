// Edge function: analyze-news-case
// Recebe o texto de uma notícia de acidente de trabalho e extrai, via IA,
// os campos estruturados do lead trabalhista (vítima, empresas, local, dano etc.)
// para preencher o formulário "Cadastrar Caso Viável" da aba de Notícias.
//
// Self-contained de propósito: o deploy via Management API sobe arquivo único,
// então a chamada ao Gemini é feita inline (sem imports de _shared).
// Deploy: SUPABASE_PAT=sbp_... node _deploy_analyze_news_case.mjs (ref kmedldlepwiityjsdahz)

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

const CASE_TYPES = ['Queda de Altura', 'Soterramento', 'Choque Elétrico', 'Acidente com Máquinas', 'Intoxicação', 'Explosão', 'Incêndio', 'Acidente de Trânsito', 'Esmagamento', 'Corte/Amputação', 'Afogamento', 'Outro']
const LIABILITY_TYPES = ['Solidária', 'Subsidiária', 'Objetiva', 'Subjetiva', 'A Definir']
const SECTORS = ['Construção Civil', 'Mineração', 'Agronegócio', 'Indústria', 'Energia', 'Logística', 'Siderurgia', 'Petróleo e Gás', 'Alimentício', 'Outro']

// Schema da tool de extração (function calling força saída estruturada).
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    victim_name: { type: 'string', description: 'Nome completo da vítima. Vazio se não informado.' },
    victim_age: { type: 'number', description: 'Idade da vítima em anos. 0 se não informada.' },
    accident_date: { type: 'string', description: 'Data do acidente em formato ISO YYYY-MM-DD. Vazio se não informada. Se a notícia disser "ontem"/"na manhã desta terça", deduza a partir da data de publicação quando presente.' },
    damage: { type: 'string', description: 'Dano principal, curto (ex: "Morte", "Amputação de mão", "Queimaduras graves", "Fratura").' },
    dynamics_summary: { type: 'string', description: 'Dinâmica do acidente resumida em poucas palavras (ex: "Esmagamento por perda de freio", "Queda de andaime de 8m").' },
    case_type: { type: 'string', enum: CASE_TYPES, description: 'Tipo de caso mais próximo da dinâmica.' },
    damage_description: { type: 'string', description: 'Descrição completa das lesões/danos e da dinâmica do acidente, em 2-4 frases.' },
    city: { type: 'string', description: 'Cidade onde ocorreu o acidente.' },
    state: { type: 'string', description: 'UF de 2 letras (ex: MG, SP).' },
    accident_address: { type: 'string', description: 'Endereço ou local do acidente (obra, planta, rodovia, bairro), o mais específico possível.' },
    main_company: { type: 'string', description: 'Empresa TOMADORA do serviço (dona da obra/planta/atividade principal).' },
    contractor_company: { type: 'string', description: 'Empresa TERCEIRIZADA/empregadora direta da vítima, se distinta da tomadora.' },
    sector: { type: 'string', enum: SECTORS, description: 'Setor econômico da atividade.' },
    company_size_justification: { type: 'string', description: 'Texto explicativo sobre o porte da(s) empresa(s) envolvida(s): grande/média/pequena, indícios (multinacional, S.A., obra pública, nº de funcionários citado, relevância regional) e por que isso importa para a viabilidade do caso.' },
    liability_type: { type: 'string', enum: LIABILITY_TYPES, description: 'Tipo de responsabilidade provável: Solidária/Subsidiária quando há terceirização; Objetiva em atividade de risco (energia, mineração, transporte); senão A Definir.' },
    liability_justification: { type: 'string', description: 'Justificativa jurídica resumida do tipo de responsabilidade indicado.' },
    news_link: { type: 'string', description: 'URL da notícia, se aparecer no texto colado. Vazio caso contrário.' },
  },
  required: ['damage', 'dynamics_summary', 'damage_description'],
}

const SYSTEM_PROMPT = `Você é um assistente jurídico de um escritório de advocacia trabalhista brasileiro especializado em acidentes de trabalho.
Sua tarefa: ler o texto de uma notícia sobre acidente de trabalho e extrair os dados estruturados do caso chamando a ferramenta extract_case.
Regras:
- Extraia SOMENTE o que estiver no texto ou for dedução direta e segura dele. Campo desconhecido = string vazia (ou 0 para idade).
- Distinga empresa TOMADORA (dona da obra/atividade) de TERCEIRIZADA (empregadora direta da vítima).
- Datas sempre em ISO YYYY-MM-DD.
- UF sempre com 2 letras maiúsculas.
- Os textos de justificativa (porte da empresa e responsabilidade) devem ser explicativos e úteis para triagem de viabilidade, em português.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const text = String(body?.text || '').trim()

    if (text.length < 50) {
      return jsonResponse({ success: false, error: 'Texto da notícia muito curto para análise (mínimo 50 caracteres).' }, 400)
    }
    if (text.length > 30000) {
      return jsonResponse({ success: false, error: 'Texto da notícia muito longo (máximo 30.000 caracteres).' }, 400)
    }

    const apiKey = Deno.env.get('GOOGLE_AI_API_KEY')
    if (!apiKey) return jsonResponse({ success: false, error: 'GOOGLE_AI_API_KEY não configurada' }, 500)

    // Log sem conteúdo da notícia (pode conter nome/CPF de vítima) — só metadados.
    console.log(`[analyze-news-case] analisando texto de ${text.length} chars`)

    const geminiBody = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Data de hoje: ${new Date().toISOString().slice(0, 10)}\n\nTexto da notícia:\n"""\n${text}\n"""` }] }],
      tools: [{ functionDeclarations: [{ name: 'extract_case', description: 'Registra os dados estruturados extraídos da notícia.', parameters: EXTRACTION_SCHEMA }] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['extract_case'] } },
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) },
    )

    if (!res.ok) {
      const errText = await res.text()
      console.error('[analyze-news-case] Gemini API error:', res.status, errText.slice(0, 300))
      return jsonResponse({ success: false, error: `Erro na API de IA: ${res.status}` }, 502)
    }

    const data = await res.json()
    const parts = data?.candidates?.[0]?.content?.parts || []
    const fnCall = parts.find((p: { functionCall?: { name: string; args?: unknown } }) => p.functionCall)
    if (!fnCall?.functionCall?.args) {
      console.error('[analyze-news-case] resposta sem functionCall. finishReason:', data?.candidates?.[0]?.finishReason)
      return jsonResponse({ success: false, error: 'A IA não retornou dados estruturados. Tente novamente.' }, 502)
    }

    const extracted = fnCall.functionCall.args as Record<string, unknown>
    console.log('[analyze-news-case] campos extraídos:', Object.keys(extracted).filter((k) => extracted[k]).join(', '))

    return jsonResponse({ success: true, data: extracted })
  } catch (e) {
    console.error('[analyze-news-case] error:', e)
    return jsonResponse({ success: false, error: (e as Error)?.message || 'unknown error' }, 500)
  }
})

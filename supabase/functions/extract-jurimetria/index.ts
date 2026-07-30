import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat, GeminiError } from "../_shared/gemini.ts";

// Extrai campos estruturados de jurimetria de decisões judiciais.
// A API do Escavador retorna ementa/inteiro teor como TEXTO livre — valor de
// condenação, danos morais, resultado e advogados NÃO são campos estruturados.
// Aqui usamos o LLM (mesmo padrão de analyze-legal-viability) para extrair.
//
// Entrada:  { decisoes: [{ id, tribunal?, relator?, data_julgamento?, ementa|texto }] }
// Saída:    { success, resultados: [{ id, ...campos_extraidos }] }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

const EXTRACTION_TOOL = {
  type: 'function',
  function: {
    name: 'registrar_jurimetria',
    description: 'Registra os dados estruturados extraídos de uma decisão judicial sobre ludopatia / apostas (Lei 14.790/2023).',
    parameters: {
      type: 'object',
      properties: {
        tema_ludopatia: {
          type: 'boolean',
          description: 'true se a decisão trata mesmo de ludopatia/vício em apostas ou nulidade de apostas da Lei das Bets. false se o termo apareceu por acaso.',
        },
        resultado: {
          type: 'string',
          enum: ['procedente', 'parcialmente_procedente', 'improcedente', 'extinto_sem_merito', 'indefinido'],
          description: 'Resultado para o apostador/consumidor (polo que alega ludopatia).',
        },
        nulidade_apostas_reconhecida: {
          type: 'boolean',
          description: 'A decisão reconheceu a nulidade das apostas (art. 26, VI, Lei 14.790/2023)?',
        },
        devolucao_valores: {
          type: 'boolean',
          description: 'Determinou devolução dos valores apostados (com ou sem abatimento de ganhos)?',
        },
        valor_condenacao: {
          type: 'number',
          description: 'Valor total da condenação em R$ (soma), se houver. null se não houver ou não informado.',
        },
        valor_danos_morais: {
          type: 'number',
          description: 'Valor de danos morais em R$, se houver. null se não houver.',
        },
        valor_devolucao: {
          type: 'number',
          description: 'Valor determinado a ser devolvido/restituído em R$, se houver. null caso contrário.',
        },
        relator: { type: 'string', description: 'Nome do relator/magistrado, se identificável. null caso contrário.' },
        orgao_julgador: { type: 'string', description: 'Câmara/Turma/Vara, se identificável. null caso contrário.' },
        advogados: {
          type: 'array',
          description: 'Advogados citados na decisão, se houver.',
          items: {
            type: 'object',
            properties: {
              nome: { type: 'string' },
              oab: { type: 'string', description: 'Ex.: "DF 12345", se aparecer. null caso contrário.' },
              polo: { type: 'string', enum: ['ativo', 'passivo', 'indefinido'] },
            },
            required: ['nome'],
            additionalProperties: false,
          },
        },
        resumo: { type: 'string', description: 'Resumo em 1-2 frases do que foi decidido.' },
      },
      required: ['tema_ludopatia', 'resultado'],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `Você é um analista de jurimetria jurídica brasileira. Extrai dados estruturados de decisões judiciais sobre ludopatia (vício em jogos/apostas) e nulidade de apostas sob a Lei 14.790/2023 ("Lei das Bets", art. 26, VI e § 1º).
Regras:
- Só marque valores que estejam EXPLÍCITOS no texto. Nunca estime ou invente valores.
- Se um campo não estiver claro no texto, retorne null (ou omita, quando permitido).
- "resultado" é sempre sob a ótica do apostador/consumidor que alega ludopatia.
- Chame SEMPRE a função registrar_jurimetria.`;

async function extrairUma(decisao: any): Promise<any> {
  const texto = String(decisao?.ementa || decisao?.texto || '').slice(0, 24000);
  if (!texto.trim()) {
    return { id: decisao?.id ?? null, erro: 'sem texto para extrair' };
  }

  const contexto = [
    decisao?.tribunal ? `Tribunal: ${decisao.tribunal}` : null,
    decisao?.relator ? `Relator (metadado): ${decisao.relator}` : null,
    decisao?.data_julgamento ? `Data julgamento: ${decisao.data_julgamento}` : null,
  ].filter(Boolean).join('\n');

  const data = await geminiChat({
    model: 'google/gemini-2.5-flash',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${contexto ? contexto + '\n\n' : ''}TEXTO DA DECISÃO:\n${texto}` },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'function', function: { name: 'registrar_jurimetria' } },
    temperature: 0,
  });

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    return { id: decisao?.id ?? null, erro: 'LLM não retornou extração' };
  }
  let parsed: any = {};
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    return { id: decisao?.id ?? null, erro: 'JSON inválido do LLM' };
  }
  return { id: decisao?.id ?? null, ...parsed };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { decisoes } = await req.json();
    if (!Array.isArray(decisoes) || decisoes.length === 0) {
      throw new Error('decisoes (array) é obrigatório');
    }
    if (decisoes.length > 50) {
      throw new Error('Máximo de 50 decisões por chamada (controle de custo/tempo)');
    }

    // Concorrência limitada (lotes de 5) — evita estourar rate limit do LLM.
    const resultados: any[] = [];
    const BATCH = 5;
    for (let i = 0; i < decisoes.length; i += BATCH) {
      const lote = decisoes.slice(i, i + BATCH);
      const parciais = await Promise.all(lote.map((d) => extrairUma(d).catch((e) => ({
        id: d?.id ?? null,
        erro: e instanceof Error ? e.message : String(e),
      }))));
      resultados.push(...parciais);
    }

    return new Response(JSON.stringify({ success: true, resultados }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof GeminiError ? error.message
      : error instanceof Error ? error.message : String(error);
    console.error('extract-jurimetria error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

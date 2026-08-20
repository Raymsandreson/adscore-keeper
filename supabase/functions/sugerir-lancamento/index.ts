// =============================================================================
// SUGERIR LANÇAMENTO — lê o comprovante (ou só a descrição) e propõe o resto.
//
// Dois usos, uma função só, porque a pergunta é a mesma nos dois casos ("que
// lançamento é este?") e duplicar o prompt em duas funções faria as respostas
// divergirem com o tempo:
//
//   { descricao }    -> devolve só a categoria sugerida
//   { comprovante }  -> lê a imagem e devolve valor, data, tipo, descrição e
//                       categoria
//
// REGRA DE OURO DO PROMPT: **nunca inventar**. Comprovante ilegível devolve
// campo nulo, não um chute plausível. Valor errado num extrato financeiro é
// pior que campo vazio — o vazio a pessoa preenche, o errado ela não percebe.
//
// A resposta é SUGESTÃO: quem salva é o humano, com tudo editável na tela.
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

/** Tira a cerca de código que o modelo às vezes põe mesmo mandando não pôr. */
function extrairJson(txt: string): Record<string, unknown> | null {
  const limpo = txt.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const i = limpo.indexOf('{'), f = limpo.lastIndexOf('}');
    if (i < 0 || f <= i) return null;
    try { return JSON.parse(limpo.slice(i, f + 1)); } catch { return null; }
  }
}

/** "R$ 1.125,30" | "1125.30" | 1125.3 -> 1125.3. Qualquer outra coisa -> null. */
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Aceita só yyyy-MM-dd. Data em outro formato é ruído, não dado. */
function dataIso(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const REGRAS = [
  'O QUE CADA CATEGORIA QUER DIZER:',
  '- "Honorários Contratuais": o que o CLIENTE paga ao escritório pelo contrato (normalmente 30%).',
  '- "Honorários Sucumbenciais": o que a parte CONTRÁRIA paga, fixado na sentença.',
  '- "Honorários Adiantados (FIDC)": antecipação junto a fundo, com o processo ainda tramitando.',
  '- "Cota do Cliente": a parte do dinheiro que é DO CLIENTE. Não é receita do escritório.',
  '- "Custas Processuais", "Perícia", "Deslocamento", "Documentação": despesas do processo.',
  '- "Publicidade/Anúncio", "Comissão": custo de operação do escritório.',
  '- "Acordo": valor de acordo sem separação de quem é.',
  '',
  'REGRAS INEGOCIÁVEIS:',
  '1. NUNCA invente. Campo que você não conseguir ler com segurança volta null.',
  '   Comprovante borrado, cortado ou ilegível => null, e explique em "observacao".',
  '2. "categoria" tem que ser uma da lista, escrita igual. Se NENHUMA servir, deixe',
  '   "categoria" null e proponha um nome curto em "categoria_nova", dizendo em',
  '   "observacao" por que nenhuma das existentes serve.',
  '3. "valor" é número em reais, ponto decimal (1125.30). Sem "R$", sem separador de milhar.',
  '4. "data" é yyyy-MM-dd, e é a data do PAGAMENTO, não a de emissão do documento.',
  '5. "tipo": "entrada" se o dinheiro ENTROU, "saida" se SAIU. Na dúvida, null.',
  '6. "descricao": uma linha curta e concreta do que foi o dinheiro, em português',
  '   (ex: "pago 3a parcela do acordo"). Sem enfeite.',
  '7. "pagador" e "beneficiario": nomes que aparecem no comprovante, se houver. Senão null.',
  '8. "confianca": "alta", "media" ou "baixa" — quão seguro você está do conjunto.',
  '',
  'Responda SÓ com o objeto JSON, sem cerca de código e sem texto em volta:',
  '{"valor":null,"data":null,"tipo":null,"descricao":null,"categoria":null,',
  ' "categoria_nova":null,"pagador":null,"beneficiario":null,"confianca":"baixa","observacao":null}',
].join('\n');

const PADRAO = ['Honorários Contratuais', 'Honorários Sucumbenciais', 'Cota do Cliente', 'Outros'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const { descricao, comprovante, categorias, contexto } = await req.json();
    if (!descricao && !comprovante) return json({ error: 'Mande a descrição ou o comprovante' }, 400);

    const lista: string[] = Array.isArray(categorias) && categorias.length ? categorias : PADRAO;
    const systemPrompt = [
      'Você classifica lançamentos financeiros de um escritório de advocacia brasileiro.',
      '',
      'CATEGORIAS DISPONÍVEIS (use EXATAMENTE uma destas em "categoria"):',
      ...lista.map((c) => '- ' + c),
      '',
      REGRAS,
    ].join('\n');

    const partes: Record<string, unknown>[] = [];
    if (comprovante) {
      partes.push({ type: 'text', text: 'Leia este comprovante de pagamento e devolva o JSON.' });
      partes.push({ type: 'image_url', image_url: { url: comprovante } });
    }
    if (descricao) {
      partes.push({
        type: 'text',
        text: comprovante
          ? 'A pessoa também escreveu: "' + descricao + '". Use como apoio, mas o comprovante manda.'
          : 'Sem comprovante. Classifique só por esta descrição: "' + descricao + '". Valor, data, '
            + 'pagador e beneficiário voltam null — não dá para saber isso por texto.',
      });
    }
    if (contexto) partes.push({ type: 'text', text: 'Contexto: ' + String(contexto).slice(0, 500) });

    const result = await geminiChat({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: partes },
      ],
      max_tokens: 700,
    });

    const bruto = String(result?.choices?.[0]?.message?.content || '');
    const saida = extrairJson(bruto);
    if (!saida) return json({ error: 'A IA não devolveu JSON válido', bruto: bruto.slice(0, 400) }, 502);

    // Saneamento NO SERVIDOR: a categoria tem que existir na lista. Modelo que
    // devolve grafia diferente não pode virar "categoria nova" sem querer — era
    // assim que a planilha antiga acumulou 81 categorias para 68 conceitos.
    const crua = texto(saida.categoria);
    const categoria = crua && lista.includes(crua) ? crua : null;
    const tipo = texto(saida.tipo);

    return json({
      valor: numero(saida.valor),
      data: dataIso(saida.data),
      tipo: tipo === 'entrada' || tipo === 'saida' ? tipo : null,
      descricao: texto(saida.descricao),
      categoria,
      categoriaNova: categoria ? null : texto(saida.categoria_nova),
      pagador: texto(saida.pagador),
      beneficiario: texto(saida.beneficiario),
      confianca: ['alta', 'media', 'baixa'].includes(String(saida.confianca)) ? String(saida.confianca) : 'baixa',
      observacao: texto(saida.observacao),
    });
  } catch (error) {
    console.error('[sugerir-lancamento]', error);
    return json({ error: error instanceof Error ? error.message : 'Erro desconhecido' }, 500);
  }
});

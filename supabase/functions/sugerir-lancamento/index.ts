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

// SEM import relativo, de propósito: assim a função sobe sozinha, sem precisar
// empacotar `_shared/gemini.ts` junto. O que ela usa daquele módulo é a fatia
// pequena — um modelo só, partes de texto e um anexo inline. O roteamento
// Google/Anthropic, streaming e tools que vivem lá não fazem falta aqui.
const MODELO = 'gemini-2.5-flash';

/** Parte de conteúdo no formato da Generative Language API. */
type ParteGemini = { text: string } | { inlineData: { mimeType: string; data: string } };

/** "data:image/png;base64,AAA" -> inlineData. Vale para imagem E para PDF. */
function anexoInline(dataUrl: string): ParteGemini | null {
  if (!dataUrl.startsWith('data:')) return null;
  const virgula = dataUrl.indexOf(',');
  if (virgula < 0) return null;
  const cabecalho = dataUrl.substring(0, virgula);
  const mimeType = cabecalho.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  return { inlineData: { mimeType, data: dataUrl.substring(virgula + 1) } };
}

async function chamarGemini(systemPrompt: string, partes: ParteGemini[]): Promise<string> {
  const chave = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!chave) throw new Error('GOOGLE_AI_API_KEY não configurada');
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + MODELO + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: partes }],
        generationConfig: {
          // JSON direto do modelo: sem isto ele devolve cercado em ```json e a
          // resposta cortada no meio da cerca vira "JSON inválido".
          responseMimeType: 'application/json',
          // 2.5-flash é modelo que PENSA, e o pensamento gasta deste mesmo
          // orçamento. Com 700 e observação um pouco longa, o JSON vinha
          // truncado no meio. Aqui não há o que raciocinar — é leitura e
          // classificação —, então o pensamento vai a zero e a folga sobra
          // para a resposta.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 2048,
          temperature: 0,
        },
      }),
    },
  );
  if (!r.ok) throw new Error('Gemini ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const dados = await r.json();
  const saida = dados?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text || '').join('') || '';
  return String(saida);
}

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

/**
 * Chave de comparacao de categoria: so letras e numeros, sem acento.
 *
 * NAO usa `normalize('NFD')`. Medido em 20/08/2026 contra a funcao no ar:
 * categoria SEM acento sempre casava e categoria COM acento nunca casava — a
 * assinatura de um lado chegar precomposto (i com acento num caractere so) e o
 * outro decomposto (i + marca), com o normalize nao os aproximando neste
 * runtime. Tabela explicita resolve nos dois casos: o precomposto vira a letra
 * base pelo mapa, e a marca solta do decomposto cai fora por nao ser a-z.
 *
 * Pontuacao e espaco tambem somem, entao '**Pericia**' e 'Pericia ' casam com
 * 'Perícia'. O que importa aqui e reconhecer a categoria, nao preservar grafia:
 * o valor gravado e sempre o da LISTA, nunca esta chave.
 */
const ACENTOS: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
};

const chaveCategoria = (v: string) =>
  v.toLowerCase()
    .split('')
    .map((c) => ACENTOS[c] ?? c)
    .filter((c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
    .join('');

/** A categoria DA LISTA que corresponde ao que o modelo devolveu. */
function casarCategoria(crua: string | null, lista: string[]): string | null {
  if (!crua) return null;
  const alvo = chaveCategoria(crua);
  if (!alvo) return null;
  return lista.find((c) => chaveCategoria(c) === alvo) || null;
}

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
  '2. "categoria" tem que ser uma da lista, escrita igual. Se UMA DELAS SERVE, use.',
  '   "Outros" é ÚLTIMO RECURSO, não atalho: se o gasto tem nome próprio e vai se',
  '   repetir (aluguel, software, correios, cartório, estacionamento...), deixe',
  '   "categoria" null e proponha um nome curto e reutilizável em "categoria_nova",',
  '   explicando em "observacao" por que nenhuma das existentes serve. Só use',
  '   "Outros" quando o gasto for mesmo avulso e sem nome.',
  '   NUNCA devolva "categoria" e "categoria_nova" os dois null: ou casa com uma',
  '   da lista, ou propõe uma nova.',
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
    const { descricao, ditado, comprovante, categorias, contexto, hoje } = await req.json();
    if (!descricao && !comprovante && !ditado) {
      return json({ error: 'Mande a descrição, o ditado ou o comprovante' }, 400);
    }
    // Data de referência para resolver "ontem" e "sexta passada" do ditado. Vem
    // do cliente porque o servidor pode estar em outro fuso e virar o dia antes.
    const hojeIso = dataIso(hoje);

    const lista: string[] = Array.isArray(categorias) && categorias.length ? categorias : PADRAO;
    const systemPrompt = [
      'Você classifica lançamentos financeiros de um escritório de advocacia brasileiro.',
      '',
      'CATEGORIAS DISPONÍVEIS (use EXATAMENTE uma destas em "categoria"):',
      ...lista.map((c) => '- ' + c),
      '',
      REGRAS,
    ].join('\n');

    const partes: ParteGemini[] = [];
    if (comprovante) {
      // Imagem E PDF: o Gemini aceita application/pdf como inlineData igual.
      const anexo = anexoInline(String(comprovante));
      if (!anexo) return json({ error: 'Comprovante precisa vir como data URL' }, 400);
      partes.push({ text: 'Leia este comprovante de pagamento e devolva o JSON.' });
      partes.push(anexo);
    }
    if (ditado) {
      // DITADO é diferente de descrição escrita: aqui a pessoa está contando o
      // fato em voz alta, então valor e data VÊM do que ela falou.
      partes.push({
        text: 'A pessoa DITOU o lançamento em voz alta; isto é a transcrição: "' + ditado + '". '
          + 'Os campos vêm do que ela falou, inclusive valor e data. Volte null só no que ela não '
          + 'disse. Data relativa ("ontem", "sexta passada", "dia 10") resolve contra hoje = '
          + (hojeIso || 'desconhecido') + '. Se citou um nome, ponha em "pagador" quando o dinheiro '
          + 'ENTROU e em "beneficiario" quando SAIU. '
          + 'ATENCAO: a categoria voce DEDUZ do que ela falou — ninguem dita o nome da '
          + 'categoria em voz alta. O "volte null" acima vale para valor, data e nome, '
          + 'NUNCA para a categoria.',
      });
    }
    if (descricao) {
      const temFonte = comprovante || ditado;
      partes.push({
        text: temFonte
          ? 'A pessoa também escreveu: "' + descricao + '". Use como apoio — o comprovante/ditado manda.'
          : 'Sem comprovante. Classifique só por esta descrição: "' + descricao + '". Valor, data, '
            + 'pagador e beneficiário voltam null — não dá para saber isso por texto.',
      });
    }
    if (contexto) partes.push({ text: 'Contexto: ' + String(contexto).slice(0, 500) });

    const bruto = await chamarGemini(systemPrompt, partes);
    const saida = extrairJson(bruto);
    if (!saida) return json({ error: 'A IA não devolveu JSON válido', bruto: bruto.slice(0, 400) }, 502);

    // Saneamento NO SERVIDOR: a categoria tem que existir na lista. Modelo que
    // devolve grafia diferente não pode virar "categoria nova" sem querer — era
    // assim que a planilha antiga acumulou 81 categorias para 68 conceitos.
    const crua = texto(saida.categoria);
    const propostaCrua = texto(saida.categoria_nova);
    // O modelo as vezes poe a categoria CERTA no campo de proposta: mandou
    // 'Pericia' em `categoria_nova` mesmo com 'Perícia' na lista. Se o nome
    // existe, ele nao e novo — e o existente escrito no campo errado, e tratar
    // como novo criaria uma categoria duplicada a cada lancamento.
    const categoria = casarCategoria(crua, lista) || casarCategoria(propostaCrua, lista);
    const tipo = texto(saida.tipo);

    return json({
      valor: numero(saida.valor),
      data: dataIso(saida.data),
      tipo: tipo === 'entrada' || tipo === 'saida' ? tipo : null,
      descricao: texto(saida.descricao),
      categoria,
      // O que o modelo escreveu e NAO casou com a lista vira PROPOSTA, nunca lixo.
      // Descartar era o pior dos mundos: a linha chegava sem categoria e sem
      // sugestao, e a pessoa nao tinha o que aceitar nem o que corrigir. Assim,
      // "Pericia Medica" (que nao existe na lista) chega como categoria nova a
      // confirmar, e a decisao continua sendo de quem salva.
      categoriaNova: categoria ? null : (propostaCrua || crua),
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

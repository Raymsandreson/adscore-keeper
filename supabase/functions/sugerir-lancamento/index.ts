// =============================================================================
// SUGERIR LANÇAMENTO — lê o que foi anexado (ou dito) e propõe os lançamentos.
//
// Quatro entradas, uma função só, porque a pergunta é a mesma nas quatro ("que
// lançamento é este?") e prompts separados divergiriam com o tempo:
//
//   { descricao }    -> devolve só a categoria sugerida
//   { ditado }       -> transcrição de voz: valor, data, tipo e de quem é
//   { comprovante }  -> imagem ou PDF: LISTA de lançamentos
//   { contexto }     -> apoio, nunca fonte
//
// DEVOLVE UMA LISTA, e essa é a lição do caso que motivou a v2: uma planilha de
// atualização de cálculo (8 páginas, lida em 21/08/2026) trazia valor da causa,
// líquido ao reclamante, honorário do patrono, sucumbência e dois pagamentos
// já feitos — SEIS linhas. A v1 pedia "um comprovante de pagamento", o modelo
// leu tudo certo, não achou um pagamento único e devolveu null em todo campo.
// A leitura estava boa; o formato do pedido é que estava errado.
//
// REGRA DE OURO DO PROMPT: **nunca inventar**. Campo ilegível volta nulo, não
// um chute plausível. Valor errado num extrato financeiro é pior que campo
// vazio — o vazio a pessoa preenche, o errado ela não percebe.
//
// A resposta é SUGESTÃO: quem escolhe o que salvar é o humano, na tela.
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// SEM import relativo, de propósito: assim a função sobe sozinha, sem precisar
// empacotar `_shared/gemini.ts` junto. O que ela usa daquele módulo é a fatia
// pequena — um modelo só, partes de texto e um anexo inline.
const MODELO = 'gemini-2.5-flash';
const PROMPT_VERSAO = 'v2-lista-2026-08-21';

type ParteGemini = { text: string } | { inlineData: { mimeType: string; data: string } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

/** "data:image/png;base64,AAA" -> inlineData. Vale para imagem E para PDF. */
function anexoInline(dataUrl: string): ParteGemini | null {
  if (!dataUrl.startsWith('data:')) return null;
  const virgula = dataUrl.indexOf(',');
  if (virgula < 0) return null;
  const ponto = dataUrl.indexOf(';');
  const fim = ponto > 0 && ponto < virgula ? ponto : virgula;
  const mimeType = dataUrl.substring(5, fim) || 'image/jpeg';
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
          // JSON direto: sem isto o modelo devolve cercado em bloco de código, e
          // resposta cortada no meio da cerca vira "JSON inválido".
          responseMimeType: 'application/json',
          // 2.5-flash PENSA, e o pensamento sai do mesmo orçamento da resposta.
          // Aqui não há o que raciocinar — é leitura e classificação —, então o
          // pensamento vai a zero e a folga inteira sobra para a lista.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 8192,
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

const DIGITOS = '0123456789';

/** Sem regex de propósito: barra invertida não sobrevive à edição deste arquivo. */
function extrairJson(txt: string): Record<string, unknown> | null {
  let limpo = txt.trim();
  const cerca = limpo.indexOf('```');
  if (cerca >= 0) {
    const inicio = limpo.indexOf('\n', cerca);
    const fim = limpo.lastIndexOf('```');
    if (inicio > 0 && fim > inicio) limpo = limpo.substring(inicio + 1, fim).trim();
  }
  try {
    return JSON.parse(limpo);
  } catch {
    const i = limpo.indexOf('{'), f = limpo.lastIndexOf('}');
    if (i < 0 || f <= i) return null;
    try { return JSON.parse(limpo.slice(i, f + 1)); } catch { return null; }
  }
}

/**
 * "R$ 1.125,30" | "1125.30" | 1125.3 -> 1125.3. Qualquer outra coisa -> null.
 *
 * O ÚLTIMO separador manda: em "1.125,30" a vírgula é decimal e o ponto é
 * milhar; em "1,125.30" é o contrário. Chutar um dos dois erra por mil.
 */
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = '';
  for (const c of v) if (DIGITOS.includes(c) || c === ',' || c === '.' || c === '-') s += c;
  if (!s) return null;
  const ultimaVirgula = s.lastIndexOf(',');
  const ultimoPonto = s.lastIndexOf('.');
  const decimal = ultimaVirgula > ultimoPonto ? ',' : (ultimoPonto > -1 ? '.' : '');
  let limpo = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === ',' || c === '.') { if (c === decimal && i === (decimal === ',' ? ultimaVirgula : ultimoPonto)) limpo += '.'; }
    else limpo += c;
  }
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Aceita só yyyy-MM-dd. Data em outro formato é ruído, não dado. */
function dataIso(v: unknown): string | null {
  if (typeof v !== 'string' || v.length !== 10) return null;
  if (v[4] !== '-' || v[7] !== '-') return null;
  for (const i of [0, 1, 2, 3, 5, 6, 8, 9]) if (!DIGITOS.includes(v[i])) return null;
  return v;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Chave de comparação de categoria: só letras e números, sem acento.
 *
 * NÃO usa normalize('NFD'): tabela explícita casa tanto o acento precomposto
 * (um caractere só) quanto o decomposto (letra + marca), sem depender de como
 * o runtime normaliza. Pontuação e espaço somem junto, então "**Pericia**" e
 * "Pericia " casam com "Perícia". O valor GRAVADO é sempre o da lista.
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
  '   Documento borrado, cortado ou ilegível => diga isso em "observacao".',
  '2. UMA LINHA POR VALOR. Documento de cálculo ou sentença traz vários valores',
  '   com naturezas diferentes (líquido do cliente, honorário do patrono,',
  '   sucumbência, custas, INSS, IR, pagamentos já feitos). Cada um vira um item',
  '   de "lancamentos". NÃO some valores diferentes num total só, e NÃO devolva',
  '   só o maior. Comprovante simples de pagamento devolve UM item.',
  '3. NÃO repita o mesmo dinheiro. "Valor da causa" e "total da condenação" são',
  '   o guarda-chuva das outras verbas: só entram se o documento NÃO abrir as',
  '   parcelas dele. Se abriu, entram as partes, não o guarda-chuva.',
  '   PLANILHA DE ATUALIZAÇÃO traz a MESMA verba recalculada em várias datas',
  '   (o mesmo honorário em 2023, em 2024 e em 2026). Devolva SÓ a atualização',
  '   MAIS RECENTE de cada verba, e diga em "observacao" quantas datas havia.',
  '   Repetir a verba por data faz o total virar o dobro ou o triplo do que o',
  '   processo vale — foi o erro da primeira rodada deste prompt.',
  '   Cada valor entra UMA vez, com UMA categoria só. Em dúvida entre duas,',
  '   use a que o documento nomeia e registre a dúvida em "observacao".',
  '4. "categoria" tem que ser uma da lista, copiada letra por letra. Se uma serve,',
  '   use. "Outros" é ÚLTIMO RECURSO: gasto com nome próprio e recorrente',
  '   (aluguel, software, cartório) deixa "categoria" null e propõe um nome curto',
  '   em "categoria_nova". Nunca os dois null no mesmo item.',
  '5. "verba" é a natureza jurídica do valor, como o documento a chama: "dano',
  '   moral", "pensionamento", "horas extras", "sucumbência", "FGTS", "custas".',
  '   É diferente de categoria: categoria diz de quem é o dinheiro, verba diz de',
  '   onde ele veio.',
  '6. "valor" é o TOTAL da linha, em reais com ponto decimal (1125.30).',
  '   "valor_nominal" é o principal sem juros e "juros" é o que se somou até a',
  '   data do cálculo — só quando o documento SEPARAR os dois. Se ele só traz o',
  '   total, valor_nominal e juros voltam null. Nunca deduza um do outro.',
  '7. "tipo": "entrada" quando o dinheiro vem PARA o escritório ou para o cliente',
  '   dele; "saida" quando sai. Sucumbência devida PELO nosso lado é "saida".',
  '8. "ja_pago": true só quando o documento mostra que aquele valor JÁ foi pago',
  '   (recibo, comprovante, "pagamento efetuado em"). Valor que ainda vai ser',
  '   pago, mesmo com data marcada, é false.',
  '9. "data": yyyy-MM-dd. Do PAGAMENTO quando ja_pago, do vencimento quando não.',
  '   Sem data no documento, null — não use a data de hoje.',
  '10. "parte": a pessoa a quem o valor se refere, como escrita no documento.',
  '11. "documento": "comprovante", "calculo", "decisao" ou "outro".',
  '12. "confianca": "alta", "media" ou "baixa", do conjunto.',
  '',
  'Responda SÓ com este objeto JSON, sem texto em volta:',
  '{"documento":null,"confianca":"baixa","observacao":null,"lancamentos":[',
  ' {"valor":null,"valor_nominal":null,"juros":null,"data":null,"tipo":null,',
  '  "descricao":null,"verba":null,"categoria":null,"categoria_nova":null,',
  '  "parte":null,"ja_pago":false}]}',
].join('\n');

const PADRAO = ['Honorários Contratuais', 'Honorários Sucumbenciais', 'Cota do Cliente', 'Outros'];

/** Sanea UM item da lista. O que nao passa vira null, nunca chute. */
function limparLancamento(bruto: Record<string, unknown>, lista: string[]) {
  const crua = texto(bruto.categoria);
  const propostaCrua = texto(bruto.categoria_nova);
  // O modelo as vezes poe a categoria CERTA no campo de proposta. Se o nome
  // existe na lista, ele nao e novo — e o existente escrito no campo errado.
  const categoria = casarCategoria(crua, lista) || casarCategoria(propostaCrua, lista);
  const tipo = texto(bruto.tipo);
  const valor = numero(bruto.valor);
  const nominal = numero(bruto.valor_nominal);
  const juros = numero(bruto.juros);
  return {
    valor,
    // Só devolve a abertura quando ela FECHA com o total. Nominal + juros que
    // não somam o valor é sinal de leitura errada, e meio dado aqui engana mais
    // que dado nenhum.
    valorNominal: nominal != null && juros != null && valor != null
      && Math.abs(nominal + juros - valor) < 0.02 ? nominal : (juros == null ? nominal : null),
    juros: nominal != null && juros != null && valor != null
      && Math.abs(nominal + juros - valor) < 0.02 ? juros : null,
    data: dataIso(bruto.data),
    tipo: tipo === 'entrada' || tipo === 'saida' ? tipo : null,
    descricao: texto(bruto.descricao),
    verba: texto(bruto.verba),
    categoria,
    categoriaNova: categoria ? null : (propostaCrua || crua),
    parte: texto(bruto.parte),
    jaPago: bruto.ja_pago === true,
  };
}

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
      'Você lê documentos financeiros de um escritório de advocacia brasileiro e',
      'devolve os lançamentos que eles contêm.',
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
      partes.push({
        text: 'Leia este documento inteiro e devolva TODOS os lançamentos que ele traz, '
          + 'um item por valor. Pode ser um comprovante com um valor só, ou uma planilha '
          + 'de cálculo com dezenas — devolva o que estiver lá, sem resumir num total.',
      });
      partes.push(anexo);
    }
    if (ditado) {
      // DITADO é diferente de descrição escrita: aqui a pessoa está contando o
      // fato em voz alta, então valor e data VÊM do que ela falou.
      partes.push({
        text: 'A pessoa DITOU o lançamento em voz alta; isto é a transcrição: "' + ditado + '". '
          + 'Normalmente é UM lançamento. Os campos vêm do que ela falou, inclusive valor e '
          + 'data. Volte null só no que ela não disse. Data relativa ("ontem", "sexta '
          + 'passada", "dia 10") resolve contra hoje = ' + (hojeIso || 'desconhecido') + '. '
          + 'O nome que ela citou vai em "parte". ATENÇÃO: a categoria você DEDUZ do que ela '
          + 'falou — ninguém dita o nome da categoria em voz alta.',
      });
    }
    if (descricao) {
      const temFonte = comprovante || ditado;
      partes.push({
        text: temFonte
          ? 'A pessoa também escreveu: "' + descricao + '". Use como apoio — o documento manda.'
          : 'Sem documento. Classifique só por esta descrição: "' + descricao + '", num item '
            + 'único. Valor, data e parte voltam null — não dá para saber isso por texto.',
      });
    }
    if (contexto) partes.push({ text: 'Contexto: ' + String(contexto).slice(0, 500) });

    const bruto = await chamarGemini(systemPrompt, partes);
    const saida = extrairJson(bruto);
    if (!saida) return json({ error: 'A IA não devolveu JSON válido', bruto: bruto.slice(0, 400) }, 502);

    const crus = Array.isArray(saida.lancamentos) ? saida.lancamentos : [];
    const lancamentos = crus
      .filter((l: unknown) => l && typeof l === 'object')
      .map((l: Record<string, unknown>) => limparLancamento(l, lista))
      // Item sem valor E sem categoria não é lançamento nenhum — é ruído de
      // leitura, e mostrar linha vazia na tela só dá trabalho de fechar.
      .filter((l) => l.valor != null || l.categoria || l.categoriaNova);

    const primeiro = lancamentos[0];
    return json({
      documento: texto(saida.documento),
      confianca: ['alta', 'media', 'baixa'].includes(String(saida.confianca)) ? String(saida.confianca) : 'baixa',
      observacao: texto(saida.observacao),
      promptVersao: PROMPT_VERSAO,
      lancamentos,
      // Espelho do primeiro item: o caminho "sugerir categoria pela descrição" e
      // o ditado devolvem um só, e quem chama não precisa saber de lista para
      // esses dois. A lista continua sendo a fonte quando há mais de um.
      valor: primeiro?.valor ?? null,
      data: primeiro?.data ?? null,
      tipo: primeiro?.tipo ?? null,
      descricao: primeiro?.descricao ?? null,
      categoria: primeiro?.categoria ?? null,
      categoriaNova: primeiro?.categoriaNova ?? null,
      pagador: primeiro?.tipo === 'entrada' ? (primeiro?.parte ?? null) : null,
      beneficiario: primeiro?.tipo === 'saida' ? (primeiro?.parte ?? null) : null,
    });
  } catch (error) {
    console.error('[sugerir-lancamento]', error);
    return json({ error: error instanceof Error ? error.message : 'Erro desconhecido' }, 500);
  }
});

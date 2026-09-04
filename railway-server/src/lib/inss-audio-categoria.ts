// ============================================================================
// Áudio que acompanha a mensagem do INSS no grupo do cliente.
//
// O texto já sai humanizado (ver lib/inss-mensagem-cliente); aqui se decide QUE
// ÁUDIO vai junto. Duas fontes, nesta ordem:
//
//  1. GRAVADO pela equipe — voz humana, um arquivo por assunto. É o que a
//     acolhedora já falava à mão, agora reaproveitado.
//  2. GERADO por TTS e GUARDADO no mesmo catálogo, para não gastar geração
//     nova toda vez que o assunto se repetir (pedido do usuário, 04/09/2026).
//
// A REGRA QUE SEGURA TUDO: áudio gravado é genérico e fala de UM assunto só. Só
// pode sair quando o despacho do INSS trata de exatamente UM assunto
// reconhecido. Exigência que pede procuração E biometria não recebe o áudio da
// procuração — receberia meia instrução, e o cliente mandaria metade dos
// papéis. Nesse caso o áudio é gerado lendo o texto que foi realmente enviado,
// que lista tudo. Nunca se escolhe áudio por semelhança ou por "o que casou
// primeiro"; mesma disciplina do match de procuração (lib/inss-procuracao).
//
// Categorias medidas em 04/09/2026 sobre as 608 exigências com despacho do
// `inss_status_history` — a contagem de cada uma está em CATEGORIAS.
// ============================================================================

import type { TipoMensagemCliente } from './inss-mensagem-cliente';

export type CategoriaAudio =
  | 'procuracao'
  | 'biometria'
  | 'cadunico_atualizar'
  | 'cadunico_documentos'
  | 'estado_civil'
  | 'autodeclaracao_rural'
  | 'outro_beneficio'
  | 'pensao_obito'
  | 'uniao_estavel'
  | 'laudo_medico'
  | 'doc_pessoal_residencia'
  | 'ctps_cnis'
  | 'cat';

/**
 * Cada categoria é um assunto que o INSS pede sozinho com frequência e que cabe
 * num áudio de 20 segundos. A ordem não importa — o detector exige unicidade,
 * então empate nunca vira escolha.
 *
 * `exige` tem que casar; `veta` derruba a categoria mesmo com `exige` casado. O
 * veto existe para separar pares que compartilham vocabulário: "casado" aparece
 * tanto no estado civil do CadÚnico quanto na união estável de pensão por
 * morte, e são pedidos opostos (um quer prova de separação, o outro prova de
 * convivência).
 */
const CATEGORIAS: {
  chave: CategoriaAudio;
  exige: RegExp;
  veta?: RegExp;
  /** Quantas das 608 exigências com despacho casaram (04/09/2026). */
  medido: number;
}[] = [
  {
    chave: 'procuracao',
    exige:
      /procura[çc][ãa]o|termo de representa[çc][ãa]o|representa[çc][ãa]o processual|saneamento de v[íi]cio|assinad[oa][^.]{0,40}manuscrit|assinatura digital[^.]{0,60}(n[ãa]o foi reconhecid|iti)/i,
    medido: 80,
  },
  {
    chave: 'biometria',
    exige: /biometria|t[íi]tulo eleitoral|t[íi]tulo de eleitor|carteira de identidade nacional|\bCIN\b/i,
    medido: 70,
  },
  {
    chave: 'cadunico_documentos',
    exige:
      /(cad[úu]nico|cadastro [úu]nico)[\s\S]{0,300}(integrante|membro|composi[çc][ãa]o familiar|grupo familiar)|(integrante|membro|composi[çc][ãa]o familiar|grupo familiar)[\s\S]{0,300}(cad[úu]nico|cadastro [úu]nico)/i,
    medido: 13,
  },
  {
    chave: 'cadunico_atualizar',
    // O áudio manda ir ao CRAS ATUALIZAR o cadastro. Citar o CadÚnico de
    // passagem não basta: um despacho invalidava alíquota de recolhimento "por
    // renda informada no CadÚnico" e pedia guia de pagamento — mandar a pessoa
    // ao CRAS ali seria instrução errada.
    exige:
      /\bCRAS\b|atualiz\w*[^.]{0,60}(cad[úu]nico|cadastro [úu]nico)|(cad[úu]nico|cadastro [úu]nico)[^.]{0,60}atualiz/i,
    veta:
      /(integrante|membro|composi[çc][ãa]o familiar|grupo familiar)|al[íi]quota|recolhimento|guia para pagamento/i,
    medido: 60,
  },
  {
    chave: 'estado_civil',
    exige:
      /(estado civil|declara[çc][ãa]o de separa[çc][ãa]o|divorci|separa[çc][ãa]o de fato|consta[^.]{0,40}casad)/i,
    // Pensão por morte pede o oposto: PROVAR a união, não desfazê-la.
    veta: /uni[ãa]o est[áa]vel|pens[ãa]o por morte|falecid|de cujus|instituidor/i,
    medido: 7,
  },
  {
    chave: 'autodeclaracao_rural',
    exige: /autodeclara[çc][ãa]o|segurado especial|atividade rural|trabalhador rural/i,
    medido: 24,
  },
  {
    chave: 'outro_beneficio',
    exige:
      /bolsa fam[íi]lia|benef[íi]cio de outro (regime|[óo]rg[ãa]o)|que benef[íi]cio recebe|informar[^.]{0,60}benef[íi]cio[^.]{0,60}(outro|recebe)|renda mensal vital[íi]cia/i,
    // O comunicado de vagas de perícia não pede nada ao cliente e cita
    // benefício de passagem — casava aqui e mandaria o áudio do Bolsa Família.
    veta: /vagas regulares de per[íi]cia|antecipar o agendamento/i,
    medido: 9,
  },
  {
    chave: 'pensao_obito',
    exige:
      /declara[çc][ãa]o de [óo]bito|certid[ãa]o de [óo]bito|morte por acidente|laudo (de exame )?cadav[ée]rico|boletim de (registro )?(policial|ocorr[êe]ncia)|inqu[ée]rito policial/i,
    medido: 38,
  },
  {
    chave: 'uniao_estavel',
    exige: /uni[ãa]o est[áa]vel|depend[êe]ncia econ[ôo]mica/i,
    medido: 50,
  },
  {
    chave: 'laudo_medico',
    exige:
      /laudo|atestado m[ée]dico|atestado m[ée]dico ou odontol[óo]gico|relat[óo]rio m[ée]dico|exames? complementar/i,
    medido: 61,
  },
  {
    chave: 'ctps_cnis',
    exige:
      /carteira[s]? de trabalho|\bCTPS\b|\bCNIS\b|contribui[çc][õo]es|carn[êe] de contribui|v[íi]nculo[s]? empregat/i,
    medido: 35,
  },
  {
    chave: 'cat',
    exige: /comunica[çc][ãa]o de acidente do trabalho|\bCAT\b/i,
    medido: 11,
  },
  {
    chave: 'doc_pessoal_residencia',
    exige:
      /comprovante de (endere[çc]o|resid[êe]ncia)|documento de identifica[çc][ãa]o|documentos? pessoa(l|is)/i,
    medido: 120,
  },
];

/**
 * Qual assunto esse despacho trata — ou `null` quando trata de mais de um, de
 * nenhum reconhecido, ou quando não há despacho.
 *
 * `null` NÃO é falha: significa "o áudio genérico não serve aqui", e quem
 * chama cai no áudio lido do texto real, que é sempre correto.
 */
/**
 * Parte dos despachos chega com entidade HTML no lugar do acento
 * ("Comprovante de resid&ecirc;ncia", "Identifica&ccedil;&atilde;o"). Sem
 * desfazer isso, o texto escapa de qualquer regex acentuado e o despacho cai
 * como "assunto não reconhecido" — foi o que aconteceu com a lista genérica de
 * documentos, que casava só em "Carteira de Trabalho" e virava, sozinha,
 * categoria de CTPS.
 */
export function normalizarDespacho(fonte?: string | null): string {
  const ENTIDADES: Record<string, string> = {
    aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â', ccedil: 'ç',
    eacute: 'é', ecirc: 'ê', iacute: 'í', oacute: 'ó', otilde: 'õ',
    ocirc: 'ô', uacute: 'ú', uuml: 'ü', ntilde: 'ñ', nbsp: ' ',
    amp: '&', quot: '"', apos: "'", ordm: 'º', ordf: 'ª',
  };
  return (fonte || '')
    .replace(/&([a-zA-Z]+);/g, (m, nome) => ENTIDADES[nome.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (m, n) => {
      const cod = Number(n);
      return cod > 0 && cod < 0x10000 ? String.fromCharCode(cod) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function categoriaDoAudio(fonte?: string | null): CategoriaAudio | null {
  const texto = normalizarDespacho(fonte);
  if (texto.length < 20) return null;
  const casadas = CATEGORIAS.filter(
    (c) => c.exige.test(texto) && !(c.veta && c.veta.test(texto)),
  );
  return casadas.length === 1 ? casadas[0].chave : null;
}

/** Chave do catálogo: um áudio por (tipo de mensagem, assunto). */
export function chaveDoAudio(
  tipo: TipoMensagemCliente,
  categoria: CategoriaAudio | null,
): string {
  return categoria ? `${tipo}:${categoria}` : tipo;
}

/** Teto do texto que vira áudio. Mensagem maior que isso é lida truncada. */
const MAX_CHARS_TTS = 900;

/**
 * Limpa o texto para a leitura: emoji, marcação e link não se falam. O mesmo
 * tratamento do `elevenlabs-tts` da edge, reescrito aqui porque o railway-server
 * não compartilha aquele bundle.
 */
export function textoParaFala(texto: string): string {
  return texto
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^[\s•\-]+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, MAX_CHARS_TTS);
}

// ============================================================================
// Roteiros fixos das categorias que a equipe ainda não gravou
// ============================================================================
// Escritos no mesmo registro dos áudios gravados: fala direta com o cliente,
// sem termo jurídico, sem número de documento, sem prazo inventado. Gravar a
// voz de gente por cima é sempre melhor — basta trocar a linha do catálogo por
// `origem = 'gravado'` com a URL do arquivo.
export const ROTEIROS: Record<string, string> = {
  protocolado:
    'Oi, tudo bem? Seu pedido já entrou no INSS e agora ele está na fila de análise. ' +
    'Isso costuma levar algumas semanas. A gente acompanha todo dia e, assim que o INSS ' +
    'responder qualquer coisa, a gente avisa aqui no grupo. Você não precisa fazer nada agora.',
  'exigencia:pensao_obito':
    'Oi, tudo bem? O INSS pediu os documentos sobre o falecimento para continuar a análise. ' +
    'A gente precisa da certidão de óbito e, se tiver, do boletim de ocorrência e do laudo do ' +
    'exame. Pode mandar aqui no grupo por foto ou digitalizado, como você preferir, que a gente ' +
    'anexa para o INSS.',
  'exigencia:uniao_estavel':
    'Oi, tudo bem? O INSS pediu documentos que mostrem que vocês viviam juntos. Serve conta no ' +
    'mesmo endereço, plano de saúde, certidão de nascimento de filho em comum, foto de casamento, ' +
    'declaração de imposto de renda. Precisa de pelo menos dois papéis e eles têm que ser de antes ' +
    'do falecimento. Manda aqui no grupo o que você tiver que a gente envia para o INSS.',
  'exigencia:laudo_medico':
    'Oi, tudo bem? O INSS pediu os documentos do médico para continuar a análise. Pode ser laudo, ' +
    'atestado, receita ou exame, desde que dê para ler e não esteja rasurado. É importante que ' +
    'apareça o seu nome completo, a data e a doença ou o CID. Manda aqui no grupo que a gente anexa.',
  'exigencia:doc_pessoal_residencia':
    'Oi, tudo bem? O INSS pediu os seus documentos pessoais e o comprovante de onde você mora. ' +
    'Serve identidade, CNH ou carteira de trabalho, e uma conta de luz, água ou telefone com o ' +
    'endereço. Manda aqui no grupo por foto ou digitalizado que a gente envia para o INSS.',
  'exigencia:ctps_cnis':
    'Oi, tudo bem? O INSS pediu os documentos de trabalho para conferir o seu tempo de ' +
    'contribuição. Se você tiver carteira de trabalho, mande foto de todas as páginas que tenham ' +
    'anotação. Se tiver carnê ou comprovante de pagamento ao INSS, manda também. A gente anexa ' +
    'tudo e o INSS continua a análise.',
  'exigencia:cat':
    'Oi, tudo bem? O INSS pediu a CAT, que é o papel que a empresa emite quando acontece um ' +
    'acidente de trabalho. Se você tiver esse documento, manda aqui no grupo. Se a empresa não ' +
    'tiver emitido, avisa a gente aqui mesmo que o escritório cuida disso.',
  arquivado_decurso:
    'Oi, tudo bem? O INSS encerrou o seu pedido porque o prazo para mandar os documentos acabou. ' +
    'Isso não é o fim: ainda dá para fazer alguma coisa. A gente já está vendo qual é o melhor ' +
    'caminho e avisa você aqui no grupo. Não precisa fazer nada agora.',
};

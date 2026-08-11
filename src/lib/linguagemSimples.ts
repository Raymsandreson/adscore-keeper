// =============================================================================
// Tradução das movimentações processuais para quem NÃO é da área.
//
// O aviso do sino saía com o vocabulário do tribunal ("MOVIMENTAÇÃO",
// "Houve nova movimentação no processo", "conclusos os autos") — correto e
// inútil para o cliente, que lê aquilo sem saber se é bom, ruim ou rotina.
// Aqui mora o texto que vai no lugar: o que aconteceu, o que significa na
// prática, e o que ele precisa (ou não) fazer.
//
// Duas regras que valem para todo texto daqui:
//   1. Nunca prometer resultado ("vamos ganhar", "sai rápido"). O cliente
//      merece clareza, não expectativa criada.
//   2. Dizer sempre se ele precisa fazer alguma coisa. O medo de "estou
//      devendo algo?" é o que mais gera ligação depois do aviso.
//
// Determinístico de propósito: sem IA no meio, nada de inventar significado
// jurídico que ninguém revisou.
// =============================================================================
import type { UpdateCategoria } from '@/hooks/useProcessUpdates';

/** Rótulo do assunto sem jargão — "Decisão de mérito" não diz nada pra leigo. */
export const ASSUNTO_SIMPLES: Record<UpdateCategoria, string> = {
  decisao_merito: 'Decisão do juiz',
  audiencia: 'Audiência marcada',
  pericia: 'Perícia determinada',
  prazo: 'Comunicação do tribunal',
  despacho: 'Ordem do juiz no processo',
  movimentacao: 'Atualização do processo',
};

interface Explicacao {
  /** "Como está?" — o que aconteceu e o que significa, em português comum. */
  comoEsta: string;
  /** "Próximo passo" — o que a equipe vai fazer e o que o cliente precisa fazer. */
  proximo: string;
}

export const EXPLICACAO: Record<UpdateCategoria, Explicacao> = {
  decisao_merito: {
    comoEsta:
      'O juiz analisou o seu caso e deu uma decisão. É um momento importante do processo: '
      + 'é nela que se diz se os pedidos foram aceitos, aceitos em parte ou negados. '
      + 'Ainda pode haver recurso — tanto nosso quanto da outra parte —, então a decisão '
      + 'nem sempre é o ponto final. Estamos lendo tudo com calma para te explicar o que ela significa no seu caso.',
    proximo:
      'Vamos te procurar para explicar a decisão em detalhes, em linguagem simples, e combinar com você o que fazer a seguir. '
      + 'Por enquanto você não precisa tomar nenhuma providência.',
  },
  audiencia: {
    comoEsta:
      'Foi marcada uma audiência — é o dia em que as partes se encontram com o juiz para tratar do caso, '
      + 'tentar um acordo e, dependendo do tipo, ouvir depoimentos e testemunhas. '
      + 'É uma etapa normal do caminho e não é o julgamento final.',
    proximo:
      'Vamos te avisar com antecedência sobre a data e o horário, te explicar direitinho como funciona e te preparar antes. '
      + 'Se for por videoconferência, enviamos o link e ensinamos como entrar. Sua presença é importante.',
  },
  pericia: {
    comoEsta:
      'Foi determinada uma perícia: um profissional de confiança do juízo — na maioria das vezes um médico — '
      + 'vai avaliar a sua situação e escrever um relatório técnico para o juiz. '
      + 'Esse relatório costuma pesar bastante na decisão, por isso essa etapa merece atenção.',
    proximo:
      'Assim que a data for marcada, te avisamos e explicamos o que levar — documentos, exames e laudos médicos. '
      + 'Faltar à perícia pode atrasar ou prejudicar o caso, então conte com a gente para se organizar.',
  },
  prazo: {
    comoEsta:
      'O tribunal nos comunicou oficialmente sobre um ato do processo. A partir dessa comunicação começa a correr '
      + 'um prazo para a nossa resposta. É rotina do processo, e o prazo é da equipe — não seu.',
    proximo:
      'Vamos cumprir o prazo dentro do período legal e te avisar se precisarmos de algum documento seu. '
      + 'Não é preciso fazer nada agora.',
  },
  despacho: {
    comoEsta:
      'O juiz deu um despacho — uma ordem para o processo continuar andando, como pedir um documento, '
      + 'marcar um ato ou mandar ouvir a outra parte. Não é a decisão final do seu caso, é o processo seguindo o curso dele.',
    proximo:
      'Vamos providenciar o que o juiz determinou e continuar acompanhando de perto. '
      + 'Se algo depender de você, entramos em contato antes.',
  },
  movimentacao: {
    comoEsta:
      'Houve um novo registro no seu processo. Esses registros são o dia a dia da tramitação — '
      + 'em geral rotina interna do tribunal, que não muda o resultado do caso, mas mostra que ele está andando.',
    proximo:
      'Seguimos acompanhando de perto e te avisamos assim que acontecer algo que mexa de verdade no seu caso. '
      + 'Nada é necessário da sua parte agora.',
  },
};

/** Compara sem acento: o tribunal escreve "trânsito", "acórdão", "citação". */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Termos que aparecem no texto cru do tribunal e travam a leitura de quem é
 * leigo. As regex casam contra o texto SEM acento (por isso são escritas sem
 * acento), e a ordem importa: o primeiro que casar é o que explica — por isso
 * "trânsito em julgado" vem antes de "sentença", e "improcedente" antes de
 * "procedente", que é substring dele.
 */
const TERMOS: Array<{ re: RegExp; termo: string; explicacao: string }> = [
  { re: /transit(o|ou|ado) em julgado/, termo: 'trânsito em julgado', explicacao: 'quando não cabe mais recurso e a decisão passa a ser definitiva' },
  { re: /conclus[oa]s?\b/, termo: 'conclusos', explicacao: 'o processo foi para a mesa do juiz, aguardando a análise dele' },
  { re: /juizo 100% digital/, termo: 'juízo 100% digital', explicacao: 'o processo passa a tramitar inteiramente pela internet, sem papel' },
  { re: /\bautos\b/, termo: 'autos', explicacao: 'é o nome que se dá ao processo em si, o conjunto de documentos dele' },
  { re: /distribui(d|c)/, termo: 'distribuição', explicacao: 'o processo foi sorteado e entregue a uma vara e a um juiz específicos' },
  { re: /\bcitacao\b|\bcitad/, termo: 'citação', explicacao: 'é quando a outra parte é oficialmente comunicada de que existe um processo contra ela' },
  { re: /\bintimac|intimad/, termo: 'intimação', explicacao: 'é a comunicação oficial do tribunal sobre algo que aconteceu no processo' },
  { re: /contestacao/, termo: 'contestação', explicacao: 'é a defesa apresentada pela outra parte' },
  { re: /\breplica\b/, termo: 'réplica', explicacao: 'é a nossa resposta à defesa apresentada pela outra parte' },
  { re: /embargos/, termo: 'embargos', explicacao: 'é um pedido para que o próprio juiz esclareça ou corrija pontos da decisão' },
  { re: /\brecurso\b|\bapelac/, termo: 'recurso', explicacao: 'é o pedido para que a decisão seja revista por outros juízes' },
  { re: /acordao/, termo: 'acórdão', explicacao: 'é a decisão tomada por um grupo de desembargadores, quando o caso sobe para revisão' },
  { re: /improcedente/, termo: 'improcedente', explicacao: 'quer dizer que o pedido não foi aceito pelo juiz' },
  { re: /procedente/, termo: 'procedente', explicacao: 'quer dizer que o pedido foi aceito pelo juiz' },
  { re: /sentenca/, termo: 'sentença', explicacao: 'é a decisão do juiz que resolve o caso na primeira instância' },
  { re: /homolog/, termo: 'homologação', explicacao: 'é o juiz confirmando e dando validade oficial ao que foi combinado' },
  { re: /cumprimento de sentenca|execucao/, termo: 'execução', explicacao: 'é a fase de cobrar de fato aquilo que já foi decidido' },
  { re: /precatorio/, termo: 'precatório', explicacao: 'é a forma de o poder público pagar o que foi decidido, respeitando uma fila anual' },
  { re: /\brpv\b/, termo: 'RPV', explicacao: 'é o pagamento pelo poder público de valores menores, bem mais rápido que o precatório' },
  { re: /audiencia una/, termo: 'audiência una', explicacao: 'é a audiência em que tudo acontece de uma vez: tentativa de acordo, depoimentos e testemunhas' },
  { re: /\bpauta\b/, termo: 'pauta', explicacao: 'é a agenda do tribunal: o caso entrou na fila de julgamento' },
  { re: /arquivad|baixa definitiva/, termo: 'arquivamento', explicacao: 'é o processo ser guardado; às vezes é temporário e ele pode voltar a andar' },
  { re: /\bpericia\b|perito/, termo: 'perícia', explicacao: 'é o exame feito por um especialista de confiança do juiz, que escreve um relatório técnico' },
];

const MAX_TERMOS = 3;

/**
 * Acha jargão no texto do tribunal e devolve as explicações, no máximo 3 —
 * mais que isso vira parede de texto e ninguém lê.
 */
export function traduzirTermos(texto: string | null | undefined): Array<{ termo: string; explicacao: string }> {
  if (!texto) return [];
  const alvo = normalize(texto);
  const achados: Array<{ termo: string; explicacao: string }> = [];
  for (const t of TERMOS) {
    if (achados.length >= MAX_TERMOS) break;
    if (t.re.test(alvo)) achados.push({ termo: t.termo, explicacao: t.explicacao });
  }
  return achados;
}

/**
 * Bloco "O que foi feito?": o texto do tribunal, do jeito que veio (para não
 * haver dúvida do que foi comunicado), seguido do glossário do que apareceu ali.
 */
export function blocoTextoDoTribunal(descricao: string | null | undefined): string {
  const texto = (descricao || '').replace(/\s+/g, ' ').trim();
  if (!texto) return 'Acompanhamos o andamento do seu processo e registramos esta atualização.';

  const glossario = traduzirTermos(texto);
  const linhas = [
    'Acompanhamos o seu processo e este foi o registro que apareceu:',
    `_"${texto}"_`,
  ];
  if (glossario.length > 0) {
    linhas.push(
      '',
      '📖 Explicando os termos que aparecem aí:',
      ...glossario.map((g) => `• *${g.termo}*: ${g.explicacao}.`),
    );
  }
  return linhas.join('\n');
}

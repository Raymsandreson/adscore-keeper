/**
 * O tom e o fio da conversa — o que a sugestão da IA precisa saber além da
 * transcrição para não escrever como atendente quando não é atendimento.
 *
 * Por que existe: numa conversa pessoal (a esposa do dono da conta), a IA
 * sugeria "Entendi, Wana. Você gostaria de mudar de assunto e falar sobre
 * Jeri? Posso ajudar com algo relacionado?" — formal, de atendimento, e
 * respondendo a uma palavra solta. Duas causas, as duas aqui resolvidas:
 *
 * 1. A âncora era só a ÚLTIMA mensagem. A pessoa tinha mandado quatro seguidas
 *    ("Amor" / "Vamos pra outro lugar" / "Prea" / "Jeri") — uma frase só,
 *    quebrada. A IA recebia ordem de responder a "Jeri" isolado.
 * 2. Nada dizia à IA como o dono da conta escreve. Sem amostra, ela escreve
 *    como manual de atendimento.
 *
 * Só montagem de texto — sem banco e sem React, para poder testar.
 */

/** Uma fala da conversa, no formato que vem de `whatsapp_messages`. */
export interface FalaDaConversa {
  /** 'outbound' = fui eu quem escreveu. Qualquer outro valor = o interlocutor. */
  direction?: string | null;
  message_text?: string | null;
}

const ehMinha = (m: FalaDaConversa) => String(m?.direction || '') === 'outbound';
const textoDa = (m: FalaDaConversa) => String(m?.message_text ?? '').trim();
const comTexto = (m: FalaDaConversa) => !!m && !!textoDa(m);

/**
 * O que o interlocutor falou e ainda não foi respondido: TODAS as falas
 * seguidas dele depois da última minha, em ordem, uma por linha.
 *
 * É isso que devolve o contexto à sugestão. Gente escreve WhatsApp quebrando a
 * frase em várias mensagens; ler só a última é ler um pedaço do meio.
 */
export function blocoDoInterlocutor(
  mensagens: FalaDaConversa[] | null | undefined,
  maxFalas = 12,
): string {
  const falas = (mensagens || []).filter(comTexto);
  const bloco: string[] = [];
  for (let i = falas.length - 1; i >= 0; i--) {
    if (ehMinha(falas[i])) break;
    bloco.unshift(textoDa(falas[i]));
    if (bloco.length >= maxFalas) break;
  }
  return bloco.join('\n');
}

/** Mediana de palavras — resistente à mensagem gigante isolada, que a média não é. */
function medianaDePalavras(textos: string[]): number {
  const tamanhos = textos.map((t) => t.split(/\s+/).filter(Boolean).length).sort((a, b) => a - b);
  if (!tamanhos.length) return 0;
  return tamanhos[Math.floor(tamanhos.length / 2)];
}

/** Mensagem que não ensina nada sobre estilo: só link, só mídia, ou muito longa. */
const naoServeDeExemplo = (t: string) =>
  t.length > 240 || /^https?:\/\/\S+$/i.test(t) || /^[\p{Emoji_Presentation}\s]+$/u.test(t);

/**
 * Como EU escrevo nesta conversa, em linhas prontas para o prompt. Devolve `[]`
 * quando não há exemplo suficiente — prompt sem informação é melhor que prompt
 * com instrução inventada sobre um estilo que não se viu.
 *
 * São exemplos reais, não adjetivos: dizer "seja informal" produz informalidade
 * genérica; mostrar três frases minhas produz a minha.
 */
export function montarLinhasDoEstilo(
  mensagens: FalaDaConversa[] | null | undefined,
  maxExemplos = 6,
): string[] {
  const minhas = (mensagens || [])
    .filter((m) => comTexto(m) && ehMinha(m))
    .map(textoDa)
    .filter((t) => !naoServeDeExemplo(t));
  // Repetição não ensina estilo novo e ainda gasta prompt.
  const unicas = Array.from(new Set(minhas)).slice(-maxExemplos);
  if (unicas.length < 2) return [];

  const palavras = medianaDePalavras(unicas);
  return [
    `COMO EU ESCREVO (mensagens reais que EU já enviei NESTA conversa — copie o jeito, nunca o conteúdo): ` +
      `${unicas.map((t) => `"${t}"`).join(' | ')}. ` +
      `A sugestão tem que soar como se eu tivesse digitado: mesmo grau de formalidade, mesma pontuação, ` +
      `mesmos apelidos e mesmas gírias que eu uso aí em cima. Se eu não uso emoji nesta conversa, não use. ` +
      `Se eu escrevo curto, escreva curto — as minhas mensagens aqui têm cerca de ${palavras} palavra(s).`,
  ];
}

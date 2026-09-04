import { authClient } from '@/integrations/supabase';

/**
 * Uma única fonte para a sugestão de resposta da IA.
 *
 * Usada pelo dialog "Sugerir resposta" (revisão completa, com tom e reformular)
 * e pela sugestão automática que já nasce escrita no campo de digitar. As duas
 * precisam pensar igual — por isso o prompt mora aqui, e não dentro da tela.
 */

/** Tons disponíveis. label = exibido na tela, prompt = instrução para a IA. */
export const TONS: Record<string, { label: string; prompt: string }> = {
  // Padrão. A MESMA conta fala com cliente, colega, fornecedor e família —
  // fixar "cordial e profissional" fazia a sugestão soar como atendimento até
  // numa conversa íntima. O tom certo é o que as duas pessoas já usam ali.
  auto: { label: 'Do jeito da conversa', prompt: 'exatamente no tom em que as duas pessoas já se falam nesta conversa' },
  cordial: { label: 'Cordial', prompt: 'em tom cordial e profissional' },
  formal: { label: 'Formal', prompt: 'em tom formal e respeitoso' },
  friendly: { label: 'Amigável', prompt: 'em tom amigável e acolhedor' },
  empathetic: { label: 'Empático', prompt: 'em tom empático e compreensivo' },
  concise: { label: 'Direto', prompt: 'em tom direto e objetivo, sem rodeios' },
  firm: { label: 'Firme', prompt: 'em tom firme e assertivo, porém educado' },
};

/**
 * Persona da sugestão.
 * 'client' = a pessoa dona da conta respondendo pelo WhatsApp — cliente ou não.
 * 'team'   = colega respondendo outro colega no chat interno da equipe.
 */
export type ModoDaSugestao = 'client' | 'team';

/** Estado da conversa usado para decidir se há resposta pendente. */
export interface EstadoDaResposta {
  /** true = a última mensagem é do interlocutor (há algo a responder). */
  pending: boolean;
  /** Texto da última mensagem enviada por nós (para a IA não repetir). */
  lastOutboundText: string;
  /**
   * O que o interlocutor falou e ainda não foi respondido — uma fala por linha
   * (`blocoDoInterlocutor`). Gente escreve WhatsApp quebrando a frase em várias
   * mensagens; ler só a última é ler um pedaço do meio.
   */
  lastClientText: string;
}

export interface PedidoDeSugestao {
  /** Transcrição da conversa. */
  contexto: string;
  modo?: ModoDaSugestao;
  /** Chave de TONS. Default: auto (espelha o tom da conversa). */
  tom?: string;
  /** Ajuste pedido pelo usuário ("mais curta", "peça os documentos"). */
  instrucao?: string;
  /** Mensagem específica que o usuário quer responder. */
  alvo?: string;
  /** Última mensagem que nós já enviamos — a IA não deve reescrevê-la. */
  jaEnviado?: string;
  /**
   * O que o interlocutor falou e ainda não foi respondido — uma fala por linha.
   * A resposta reage ao conjunto, não à última palavra solta.
   */
  ultimaDoInterlocutor?: string;
  /**
   * Como o dono da conta escreve nesta conversa, em linhas prontas
   * (`montarLinhasDoEstilo`). Sem isso a IA escreve como manual de atendimento
   * mesmo numa conversa íntima — e o pedido é que soe como a própria pessoa.
   */
  comoEuEscrevo?: string[];
  /**
   * O que o CLIENTE ficou de fazer e ainda está em aberto (`useClientCommitments`).
   * Sem isso a IA lia "tô mandando a documentação do pagamento" numa cobrança de
   * empréstimo e respondia "daremos andamento ao pagamento" — invertendo quem
   * deve a quem. Só vale no modo 'client'.
   */
  pendenciasDoCliente?: string[];
  /**
   * Quem é essa pessoa para nós, já em linhas prontas: Relacionamento Conosco,
   * caso ligado à conversa e dinheiro registrado entre as duas partes
   * (`montarLinhasDoRelacionamento`). Vem antes de tudo no prompt porque define
   * o papel de cada lado — o que a transcrição sozinha não diz. Só no modo 'client'.
   */
  contextoDaRelacao?: string[];
  /**
   * O que o PROCESSO andou, em linhas prontas (`montarLinhasDoAndamento`):
   * número do CNJ, fase atual e as últimas movimentações do tribunal. Sem isso
   * a IA respondia "ainda não temos o número do processo" a um cliente cujo
   * processo já estava distribuído e intimado. Só vale no modo 'client'.
   */
  andamentoDoProcesso?: string[];
}

/** Monta o prompt da sugestão. Exportado para teste. */
export function montarPromptDeSugestao(pedido: PedidoDeSugestao): string {
  const {
    modo = 'client', tom = 'auto', instrucao, alvo, jaEnviado, ultimaDoInterlocutor,
    pendenciasDoCliente, contextoDaRelacao, andamentoDoProcesso, comoEuEscrevo,
  } = pedido;
  const isTeam = modo === 'team';
  // Palavras conforme a persona: quem é o interlocutor e quem sou "Eu".
  const counterpart = isTeam ? 'colega' : 'interlocutor';
  const me = isTeam ? 'você' : 'dono da conta';
  const tonePrompt = TONS[tom]?.prompt || TONS.auto.prompt;

  // Dados do escritório sobre esta pessoa. Quem é ela para nós, o que o
  // processo andou e o que ela ficou de fazer.
  const relacao = (contextoDaRelacao || []).map((l) => String(l || '').trim()).filter(Boolean);
  const andamento = (andamentoDoProcesso || []).map((l) => String(l || '').trim()).filter(Boolean);
  const pendencias = (pendenciasDoCliente || []).map((p) => String(p || '').trim()).filter(Boolean);
  // O escritório só entra em cena quando existe ALGUM dado do escritório para
  // esta pessoa. Sem cadastro, sem caso e sem pendência, afirmar "você é o
  // atendente" é justamente o que fazia a sugestão tratar a esposa como cliente
  // ("Entendi, Wana. Posso ajudar com algo relacionado?").
  const ehDoTrabalho = !isTeam && (relacao.length > 0 || andamento.length > 0 || pendencias.length > 0);

  // Âncora: o bloco não respondido — todas as falas seguidas do interlocutor
  // depois da última nossa. Uma frase quebrada em quatro mensagens ("Amor" /
  // "Vamos pra outro lugar" / "Prea" / "Jeri") é UMA fala; responder só à
  // última era responder a uma palavra solta, fora do assunto.
  const falasPendentes = String(ultimaDoInterlocutor || '')
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  const anchorLine = !alvo?.trim() && falasPendentes.length
    ? (falasPendentes.length > 1
      ? ` O ${counterpart} mandou estas mensagens seguidas, ainda sem resposta, nesta ordem: ${falasPendentes.map((f) => `"${f}"`).join(' → ')}. ` +
        `Elas são UMA fala só, quebrada em várias mensagens: leia o conjunto e responda ao conjunto. ` +
        `Se a última for uma palavra solta, ela continua a frase anterior — um lugar, um nome, uma opção dentro do que já estava sendo conversado. ` +
        `NUNCA a trate como assunto novo nem pergunte se a pessoa quer mudar de assunto.`
      : ` A ÚLTIMA mensagem enviada pelo ${counterpart} foi: "${falasPendentes[0]}". Sua resposta DEVE reagir diretamente a essa fala, e não a mensagens anteriores já respondidas.`)
    : '';
  const targetLine = alvo?.trim()
    ? ` O ${me} quer responder ESPECIFICAMENTE a esta mensagem do ${counterpart}: "${alvo.trim()}". Foque a resposta nela; use o restante da conversa apenas como contexto.`
    : '';
  // Evita que a IA reescreva/parafraseie a última mensagem que "Eu" já enviei.
  const alreadyLine = jaEnviado?.trim() && jaEnviado.trim() !== alvo?.trim()
    ? ` ATENÇÃO: o ${me} JÁ enviou recentemente esta mensagem — NÃO a repita nem a reescreva com outras palavras: "${jaEnviado.trim()}". Escreva apenas a CONTINUAÇÃO, respondendo ao que o ${counterpart} falou depois disso.`
    : '';
  const extraLine = instrucao?.trim()
    ? ` Instrução adicional do ${me}: ${instrucao.trim()}.`
    : '';
  const relacaoLine = !isTeam && relacao.length
    ? ` ANTES DE ESCREVER, leia o que já sabemos desta pessoa (vem do cadastro do escritório, não da conversa): ${relacao.join(' ')}`
    : '';
  // O que o processo andou. Vem logo depois do relacionamento porque é a
  // resposta pronta para "e o meu processo?" — a pergunta que a IA respondia
  // com "ainda não temos informação" tendo o dado no sistema.
  const andamentoLine = !isTeam && andamento.length ? ` ${andamento.join(' ')}` : '';
  // O que o cliente ficou de fazer e não fez. Diz de que lado está a obrigação —
  // sem isso a IA presume que quem providencia é sempre o escritório.
  const pendenciasLine = !isTeam && pendencias.length
    ? ` CONTEXTO DA RELAÇÃO: o CLIENTE tem compromisso(s) em aberto COM o escritório — é ELE quem deve cumprir, não nós: ${pendencias.map((p) => `"${p}"`).join('; ')}. ` +
      `Leia a fala dele à luz disso: se ele fala de documento, pagamento ou prazo ligado a esse compromisso, quem cumpre é ele — não escreva como se o escritório fosse pagar, providenciar ou dar andamento.`
    : '';
  // Como a pessoa escreve, com exemplos reais. Adjetivo ("seja informal")
  // produz informalidade genérica; três frases dela produzem a dela.
  const estilo = (comoEuEscrevo || []).map((l) => String(l || '').trim()).filter(Boolean);
  const estiloLine = estilo.length ? ` ${estilo.join(' ')}` : '';

  // Ler a relação e o registro é obrigação em toda conversa de WhatsApp: a
  // mesma conta fala com cliente, fornecedor, colega, amigo e família. Antes
  // isto não existia — a persona já entrava afirmada como atendimento.
  const leituraDaRelacao = !isTeam
    ? (
      ` ANTES DE ESCREVER, identifique três coisas lendo a conversa: ` +
      `(a) que relação as duas pessoas têm de verdade — cliente do escritório, parceiro, fornecedor, colega, amigo, cônjuge ou familiar; ` +
      `(b) em que registro elas se tratam — formal, de trabalho, entre amigos, ou íntimo e afetuoso; ` +
      `(c) de que estão falando AGORA, seguindo o fio das mensagens anteriores e não só da última. ` +
      `Escreva no MESMO registro e com o MESMO vocabulário que as duas já usam ali. ` +
      `Se a conversa é pessoal ou íntima (apelidos e palavras de carinho, planos do casal, família, assuntos de casa), ` +
      `você é a própria pessoa falando com alguém próximo: é PROIBIDO soar como atendimento — ` +
      `nada de "Entendi, [Nome]", "posso ajudar", "algo relacionado", "estamos à disposição", ` +
      `nada de tratar a fala do outro como demanda de cliente, e nada de perguntar se a pessoa quer mudar de assunto. ` +
      `O ASSUNTO e o PAPEL de cada lado saem da conversa, nunca de suposição.`
    )
    : '';

  // Regras do escritório: entram quando existe dado do escritório para esta
  // pessoa (cadastro, caso, processo ou pendência) — não por padrão.
  const regrasDoTrabalho = ehDoTrabalho
    ? (
      ` Esta conversa É de trabalho: aqui você responde pelo escritório de advocacia. ` +
      `Pode ser atendimento, cobrança de valor que o CLIENTE deve ao escritório, empréstimo/adiantamento feito a ele, ` +
      `documento pendente ou audiência. Identifique quem está cobrando quem e quem ficou de fazer o quê. ` +
      `Se é o escritório que está cobrando, a resposta NÃO pode soar como se nós fôssemos pagar ou dar andamento a um pagamento nosso. ` +
      `Não invente fatos jurídicos nem prometa prazos ou valores.`
    )
    : '';

  const base = isTeam
    ? (
      `Você é um membro da equipe de um escritório de advocacia trocando mensagens com um COLEGA no chat interno da equipe. ` +
      `Abaixo está o histórico da conversa (Eu = você; o nome antes de cada fala é o colega que a enviou). ` +
      `Escreva APENAS a próxima mensagem que você deve enviar ao colega, ${tonePrompt}, ` +
      `em português brasileiro, natural e direto, como se fala entre colegas de trabalho. ` +
      `Responda ao que o colega falou por último e ainda não foi respondido. ` +
      `Não escreva saudações repetidas se a conversa já começou, não invente fatos. ` +
      `Responda só com o texto da mensagem, sem aspas.`
    )
    : (
      `Você escreve a próxima mensagem de WhatsApp NO LUGAR do dono desta conta — ela sai como se ele mesmo tivesse digitado. ` +
      `Ele trabalha num escritório de advocacia, mas a MESMA conta conversa com cliente, colega, fornecedor, amigo, cônjuge e família. ` +
      `Abaixo está o histórico da conversa (Eu = o dono da conta; o nome antes de cada fala é a pessoa com quem ele está falando). ` +
      `Escreva APENAS a próxima mensagem que ele deve enviar, ${tonePrompt}, em português brasileiro. ` +
      `Responda ao que a outra pessoa falou por último e ainda não foi respondido. ` +
      `Não escreva saudações repetidas se a conversa já começou, não invente fatos. ` +
      `Responda só com o texto da mensagem, sem aspas.`
    );

  return `${base}${leituraDaRelacao}${regrasDoTrabalho}${estiloLine}${relacaoLine}${andamentoLine}${pendenciasLine}${anchorLine}${targetLine}${alreadyLine}${extraLine}`;
}

/**
 * Pede as sugestões à IA. Devolve as opções (a primeira é a principal).
 * Lança se a chamada falhar — quem chama decide se avisa na tela ou silencia.
 */
export async function gerarSugestaoDeResposta(pedido: PedidoDeSugestao): Promise<string[]> {
  const ctx = pedido.contexto?.trim();
  if (!ctx) return [];
  const { data, error } = await authClient.functions.invoke('ai-text-editor', {
    body: { text: ctx, action: 'custom', custom_prompt: montarPromptDeSugestao(pedido) },
  });
  if (error) throw error;
  return Array.isArray(data?.options) ? data.options.filter(Boolean) : [];
}

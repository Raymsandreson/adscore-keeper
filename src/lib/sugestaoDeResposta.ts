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
  cordial: { label: 'Cordial', prompt: 'tom cordial e profissional' },
  formal: { label: 'Formal', prompt: 'tom formal e respeitoso' },
  friendly: { label: 'Amigável', prompt: 'tom amigável e acolhedor' },
  empathetic: { label: 'Empático', prompt: 'tom empático e compreensivo' },
  concise: { label: 'Direto', prompt: 'tom direto e objetivo, sem rodeios' },
  firm: { label: 'Firme', prompt: 'tom firme e assertivo, porém educado' },
};

/**
 * Persona da sugestão.
 * 'client' = atendente respondendo um cliente pelo WhatsApp.
 * 'team'   = colega respondendo outro colega no chat interno da equipe.
 */
export type ModoDaSugestao = 'client' | 'team';

/** Estado da conversa usado para decidir se há resposta pendente. */
export interface EstadoDaResposta {
  /** true = a última mensagem é do interlocutor (há algo a responder). */
  pending: boolean;
  /** Texto da última mensagem enviada por nós (para a IA não repetir). */
  lastOutboundText: string;
  /** Texto da última mensagem do interlocutor (âncora do que responder). */
  lastClientText: string;
}

export interface PedidoDeSugestao {
  /** Transcrição da conversa. */
  contexto: string;
  modo?: ModoDaSugestao;
  /** Chave de TONS. Default: cordial. */
  tom?: string;
  /** Ajuste pedido pelo usuário ("mais curta", "peça os documentos"). */
  instrucao?: string;
  /** Mensagem específica que o usuário quer responder. */
  alvo?: string;
  /** Última mensagem que nós já enviamos — a IA não deve reescrevê-la. */
  jaEnviado?: string;
  /** Última mensagem do interlocutor — é a ela que a resposta reage. */
  ultimaDoInterlocutor?: string;
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
}

/** Monta o prompt da sugestão. Exportado para teste. */
export function montarPromptDeSugestao(pedido: PedidoDeSugestao): string {
  const {
    modo = 'client', tom = 'cordial', instrucao, alvo, jaEnviado, ultimaDoInterlocutor,
    pendenciasDoCliente, contextoDaRelacao,
  } = pedido;
  const isTeam = modo === 'team';
  // Palavras conforme a persona: quem é o interlocutor e quem sou "Eu".
  const counterpart = isTeam ? 'colega' : 'cliente';
  const me = isTeam ? 'você' : 'atendente';
  const tonePrompt = TONS[tom]?.prompt || TONS.cordial.prompt;

  // Âncora: a última fala do interlocutor é o que deve ser respondido (quando não há alvo explícito).
  const anchorLine = !alvo?.trim() && ultimaDoInterlocutor?.trim()
    ? ` A ÚLTIMA mensagem enviada pelo ${counterpart} foi: "${ultimaDoInterlocutor.trim()}". Sua resposta DEVE reagir diretamente a essa fala do ${counterpart}, e não a mensagens anteriores já respondidas.`
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
  // Quem é a pessoa para nós, antes de qualquer palavra da conversa: papel,
  // caso ligado e dinheiro entre as duas partes.
  const relacao = (contextoDaRelacao || []).map((l) => String(l || '').trim()).filter(Boolean);
  const relacaoLine = !isTeam && relacao.length
    ? ` ANTES DE ESCREVER, leia o que já sabemos desta pessoa (vem do cadastro do escritório, não da conversa): ${relacao.join(' ')}`
    : '';
  // O que o cliente ficou de fazer e não fez. Diz de que lado está a obrigação —
  // sem isso a IA presume que quem providencia é sempre o escritório.
  const pendencias = (pendenciasDoCliente || []).map((p) => String(p || '').trim()).filter(Boolean);
  const pendenciasLine = !isTeam && pendencias.length
    ? ` CONTEXTO DA RELAÇÃO: o CLIENTE tem compromisso(s) em aberto COM o escritório — é ELE quem deve cumprir, não nós: ${pendencias.map((p) => `"${p}"`).join('; ')}. ` +
      `Leia a fala dele à luz disso: se ele fala de documento, pagamento ou prazo ligado a esse compromisso, quem cumpre é ele — não escreva como se o escritório fosse pagar, providenciar ou dar andamento.`
    : '';

  const base = isTeam
    ? (
      `Você é um membro da equipe de um escritório de advocacia trocando mensagens com um COLEGA no chat interno da equipe. ` +
      `Abaixo está o histórico da conversa (Eu = você; o nome antes de cada fala é o colega que a enviou). ` +
      `Escreva APENAS a próxima mensagem que você deve enviar ao colega, em ${tonePrompt}, ` +
      `em português brasileiro, natural e direto, como se fala entre colegas de trabalho. ` +
      `Responda ao que o colega falou por último e ainda não foi respondido. ` +
      `Não escreva saudações repetidas se a conversa já começou, não invente fatos. ` +
      `Responda só com o texto da mensagem, sem aspas.`
    )
    : (
      `Você é o atendente de um escritório de advocacia respondendo um contato pelo WhatsApp. ` +
      `Abaixo está o histórico da conversa (Eu = atendente, Cliente = a pessoa atendida). ` +
      `Escreva APENAS a próxima mensagem que o atendente deve enviar como resposta, em ${tonePrompt}, ` +
      `em português brasileiro, natural e claro. Responda ao que o CLIENTE falou por último e ainda não foi respondido. ` +
      // O escritório não faz só previdenciário: a mesma conversa pode ser cobrança
      // de empréstimo adiantado ao cliente, acordo, documento ou audiência. Assumir
      // o assunto (e o papel de cada lado) já fez a IA responder o contrário do que
      // estava sendo dito — por isso a instrução é ler, não presumir.
      `O ASSUNTO e o PAPEL de cada lado saem da conversa, nunca de suposição: pode ser atendimento, cobrança de valor que o CLIENTE deve ao escritório, ` +
      `empréstimo/adiantamento feito a ele, documento pendente ou audiência. Antes de escrever, identifique quem está cobrando quem e quem ficou de fazer o quê. ` +
      `Se é o escritório que está cobrando, a resposta NÃO pode soar como se nós fôssemos pagar ou dar andamento a um pagamento nosso. ` +
      `Não escreva saudações repetidas se a conversa já começou, ` +
      `não invente fatos jurídicos nem prometa prazos ou valores. Responda só com o texto da mensagem, sem aspas.`
    );

  return `${base}${relacaoLine}${pendenciasLine}${anchorLine}${targetLine}${alreadyLine}${extraLine}`;
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

import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/**
 * Freio de abordagem a número novo — a ponte entre o gate do banco e a tela.
 *
 * A edge `send-whatsapp` v30 chama `wa_gate_envio` antes de enviar. Quando o
 * gate barra, ela devolve `error_code: RITMO_<codigo>` com o motivo e, quando
 * dá, a saída: outra instância que pode mandar, quantos segundos esperar, ou o
 * aviso de que o texto já foi para gente demais.
 *
 * Erro barrado não pode virar só um toast vermelho: o operador ficaria sem
 * saber o que fazer e tentaria de novo no mesmo texto, pelo mesmo número. Este
 * arquivo transporta a decisão do gate — com a função de reenvio em mãos —
 * para um painel lateral que oferece o caminho de saída.
 */

export const WHATSAPP_FREIO_EVENT = 'whatsapp:freio-de-ritmo';

/** Códigos que `wa_gate_envio` pode devolver, já com o prefixo da edge. */
export type CodigoDoFreio =
  | 'RITMO_TETO_DIARIO'
  | 'RITMO_RITMO'
  | 'RITMO_TEXTO_REPETIDO'
  | 'RITMO_INSTANCIA_FORA_DO_AR';

export interface FreioDeRitmoDetail {
  codigo: string;
  motivo: string;
  /** Texto que o operador tentou mandar, sem a assinatura do remetente. */
  texto: string;
  telefone: string;
  instanceName?: string | null;
  /** Instância saudável que o gate sugeriu no lugar desta. */
  instanciaSugerida?: string | null;
  /** Segundos que faltam para a próxima abordagem poder sair. */
  esperarSegundos?: number | null;
  /** O gate pediu variação: este texto já foi para N desconhecidos. */
  variarTexto?: boolean;
  textoRepetidoEm?: number;
  /**
   * Reenvia. Recebe o texto escolhido e, opcionalmente, a instância que deve
   * mandar. Devolve true quando o envio saiu. É um closure sobre a chamada
   * original — o painel não precisa saber nada de lead, contato ou citação.
   */
  reenviar: (texto: string, instanceName?: string | null) => Promise<boolean>;
}

/** Resposta de envio barrada pelo freio (e não por outro motivo qualquer). */
export function isFreioDeRitmoError(
  data: { error_code?: string } | null | undefined,
): boolean {
  return typeof data?.error_code === 'string' && data.error_code.startsWith('RITMO_');
}

export function abrirFreioDeRitmo(detail: FreioDeRitmoDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WHATSAPP_FREIO_EVENT, { detail }));
}

/**
 * Fallback para telas que não montam o painel (formulário de atividade, ficha
 * do lead). Sem saída clicável, mas com o motivo por extenso — melhor que
 * "erro ao enviar".
 */
export function showFreioToast(motivo: string, instanciaSugerida?: string | null) {
  toast.warning(motivo, {
    duration: 12000,
    description: instanciaSugerida
      ? `Sugestão: mandar por "${instanciaSugerida}".`
      : undefined,
  });
}

/**
 * Instrução de variação para a IA.
 *
 * Não é "reescreva bonito": é fazer a MESMA mensagem soar como pessoa
 * diferente escrevendo, porque o que queima o número é o texto colado indo
 * para desconhecido depois de desconhecido. As proibições são as mesmas que a
 * apresentação de indicação já usa (`referral-outreach.ts`) — sem isso a IA
 * devolve exatamente o telemarketing que estamos tentando evitar.
 */
export function promptDeVariacao(quantosDestinos: number): string {
  return [
    'Reescreva a mensagem de WhatsApp abaixo mantendo EXATAMENTE a mesma intenção e as mesmas informações.',
    `O texto original já foi enviado a ${quantosDestinos} números diferentes, e repetir texto para desconhecido é o que faz o WhatsApp bloquear o número.`,
    '',
    'Regras:',
    '- Cada opção tem que parecer escrita por uma pessoa, na hora, para UMA pessoa.',
    '- Mude a construção das frases, não só uma ou duas palavras. Trocar sinônimo não resolve.',
    '- Português brasileiro, curto, tom de conversa. No máximo 3 frases.',
    '- NÃO invente informação que não está no original: nada de nome, valor, prazo, benefício ou doença que o texto não traga.',
    '- NÃO prometa resultado e NÃO afirme que a pessoa tem direito a algo.',
    '- PROIBIDO abertura de telemarketing ("Olá, tudo bem? Passando para saber...", "Espero que esteja bem").',
    '- Sem emoji em excesso, sem "prezado", sem "venho por meio desta".',
  ].join('\n');
}

/**
 * Pede 3 variações ao `ai-text-editor`.
 *
 * Descarta opção idêntica ao original: devolvê-la seria mandar o operador
 * bater na mesma porta — o gate barraria de novo pelo mesmo hash, e ele não
 * entenderia por quê.
 */
export async function gerarVariacoes(
  texto: string,
  quantosDestinos: number,
): Promise<{ opcoes: string[]; aviso?: string }> {
  const { data, error } = await supabase.functions.invoke('ai-text-editor', {
    body: {
      text: texto,
      action: 'custom',
      custom_prompt: promptDeVariacao(quantosDestinos),
    },
  });

  if (error) return { opcoes: [], aviso: 'Não consegui falar com a IA agora.' };

  if (data?.error === 'AI_UNAVAILABLE') {
    return { opcoes: [], aviso: data?.message || 'A IA está sobrecarregada. Tente em instantes.' };
  }

  const normalizar = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const original = normalizar(texto);
  const opcoes = (Array.isArray(data?.options) ? data.options : [])
    .map((o: unknown) => String(o ?? '').trim())
    .filter((o: string) => o.length > 0 && normalizar(o) !== original);

  if (opcoes.length === 0) {
    return { opcoes: [], aviso: 'A IA devolveu o mesmo texto. Reescreva à mão desta vez.' };
  }
  return { opcoes };
}

/**
 * Enfileira conversões para a Meta CAPI.
 *
 * Substitui o disparo direto de `facebookCAPI` nos pontos de desfecho. Duas
 * diferenças que importam:
 *
 * 1. Manda só `lead_id`. E-mail, telefone, nome e valor são resolvidos no
 *    servidor com service role — dado pessoal do cliente deixa de trafegar
 *    pelo navegador e a fila guarda só SHA-256 (LGPD).
 * 2. Não fala com a Meta. Grava a intenção e volta. Quem despacha é o cron do
 *    Railway. Fechar um lead nunca mais fica preso — nem calado — por causa da
 *    Meta: em 31/07/2026 o app da Meta foi apagado e a integração ficou muda
 *    por um mês, porque o erro só ia para um `console.warn`.
 *
 * Idempotente por `event_id` no banco: chamar duas vezes grava uma linha.
 */
import { cloudFunctions } from '@/lib/functionRouter';

export type OrigemConversao = 'kanban' | 'pipeline' | 'planilha' | 'auto_enrich' | 'manual' | 'backfill' | 'zapsign';
export type EventoConversao = 'Purchase' | 'Lead' | 'CompleteRegistration';

interface PedidoEnfileiramento {
  leadId: string;
  evento: EventoConversao;
  origem: OrigemConversao;
  /** Valor capturado na tela agora; sem ele o servidor resolve pelo lead/produto. */
  valor?: number;
}

/**
 * Fechar lead é a conversão que importa: é o `Purchase` que ensina a Meta a
 * procurar mais gente parecida com quem virou cliente.
 *
 * Fechar acontece em três telas — arrastar o card para ✅ Fechado, o menu
 * "marcar como fechado" e salvar a ficha com o desfecho — e até 04/09/2026 só
 * a terceira lembrava de enfileirar. Resultado medido: 84 fechamentos no CRM,
 * 3 eventos na fila.
 *
 * Tela que fecha lead chama ESTA função, não `enfileiraConversao` na mão. Assim
 * a próxima tela de fechamento tem uma coisa óbvia para chamar, e a regra do
 * que um fechamento significa para a Meta mora num lugar só.
 */
export function registrarFechamentoDeLead(
  leadId: string,
  origem: OrigemConversao,
  valor?: number,
): void {
  void enfileiraConversao({ leadId, evento: 'Purchase', origem, valor });
}

/**
 * Nunca lança: enfileirar é efeito colateral de salvar, e falhar aqui não pode
 * derrubar o salvamento. O erro vai para o console e, quando a chamada chega
 * ao servidor, para a própria fila.
 */
export async function enfileiraConversao(p: PedidoEnfileiramento): Promise<void> {
  try {
    const { data, error } = await cloudFunctions.invoke('meta-capi-enqueue', {
      body: {
        lead_id: p.leadId,
        event_name: p.evento,
        origem: p.origem,
        ...(typeof p.valor === 'number' && p.valor > 0 ? { valor: p.valor } : {}),
      },
    });

    if (error) {
      console.warn('[capi] falha ao enfileirar', p.evento, p.leadId, error.message);
      return;
    }
    const r = (data as any)?.resultados?.[0];
    if (r?.situacao === 'ignorado') {
      console.info(`[capi] ${p.evento} não enfileirado para ${p.leadId}: ${r.motivo}`);
    }
  } catch (err) {
    console.warn('[capi] erro ao enfileirar', p.evento, p.leadId, err);
  }
}

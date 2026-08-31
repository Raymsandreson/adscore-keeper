import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

/**
 * 1ª mensagem proativa quando o agente é ativado PELA TELA.
 *
 * A configuração "⚡ Mandar 1ª mensagem proativa" só valia para a ativação por
 * etiqueta do WhatsApp — o webhook chamava o disparo, e quem ligava o agente
 * pelo sistema (menu da conversa, cabeçalho do chat, popup do aviso) via o
 * "Agente ativado" e mais nada: o agente ficava esperando o cliente falar
 * primeiro, exatamente o que a mensagem proativa existe para evitar.
 *
 * O disparo em si (ler o histórico, gerar com a IA, enviar, gravar) mora no
 * Railway e é idempotente por conversa+agente — ligar de novo não manda duas
 * vezes. Aqui só avisamos a pessoa do que aconteceu.
 */

interface Alvo {
  phone: string;
  instanceName: string | null;
  agentId: string;
  /** Nome do agente, só para o aviso na tela. */
  agentName?: string | null;
}

export async function dispararPrimeiraMensagemProativa({ phone, instanceName, agentId, agentName }: Alvo): Promise<void> {
  if (!phone || !instanceName || !agentId) return;

  try {
    const { data, error } = await cloudFunctions.invoke('agent-proactive-first-message', {
      body: { phone, instance_name: instanceName, agent_id: agentId },
    });
    if (error) throw error;

    if (data?.sent) {
      toast.success(`💬 ${agentName || 'O agente'} já mandou a primeira mensagem`);
      return;
    }

    // Silêncio de propósito nos casos esperados: agente sem proativa ligada é a
    // maioria, e "já enviada" acontece toda vez que se religa o mesmo agente.
    // Virar toast em cima do "Agente ativado" seria barulho, não informação.
    const motivo = String(data?.reason || '');
    if (motivo && !/desligada|já enviada|faltam dados/i.test(motivo)) {
      toast.error(`Não consegui mandar a 1ª mensagem: ${motivo}`);
    }
  } catch (e) {
    // A ativação já deu certo — a mensagem que falhou não pode desfazer isso.
    console.error('[agentePrimeiraMensagem] falha no disparo:', e);
    toast.error('Agente ativado, mas a 1ª mensagem não saiu');
  }
}

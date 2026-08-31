// Dispara a 1ª mensagem proativa do agente quando ele é ativado PELA TELA
// (menu da conversa, cabeçalho do chat, popup do aviso).
//
// Até aqui só a etiqueta aplicada no WhatsApp acionava isso, dentro do webhook:
// quem ligava o agente pelo sistema via o "Agente ativado" e mais nada acontecia
// — o agente ficava esperando o cliente falar primeiro, que é justamente o que a
// 1ª mensagem proativa existe para evitar.
//
// A idempotência mora na própria triggerProactiveFirstMessage: ligar o mesmo
// agente de novo na mesma conversa não manda a mensagem duas vezes.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { triggerProactiveFirstMessage } from '../lib/proactive-first-message';

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { phone, instance_name, agent_id } = (req.body || {}) as {
      phone?: string;
      instance_name?: string;
      agent_id?: string;
    };

    if (!phone || !instance_name || !agent_id) {
      return ok({ success: false, error: 'phone, instance_name e agent_id são obrigatórios' });
    }

    const resultado = await triggerProactiveFirstMessage(ext, phone, instance_name, agent_id);
    return ok({ success: true, ...resultado });
  } catch (err) {
    console.error('[agent-proactive-first-message] erro:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

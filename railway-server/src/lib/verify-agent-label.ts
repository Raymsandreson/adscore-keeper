// Verificação no envio: antes do bot responder, confere via UazAPI se a
// etiqueta do agente ainda existe no chat. Se sumiu (usuário removeu mas o
// webhook chat_labels não chegou), desativa em whatsapp_conversation_agents
// e retorna false pra bloquear o envio.
//
// Metáfora: porteiro que liga pro síndico (UazAPI) antes de deixar alguém
// entrar — não confia só no caderno (DB) que pode estar desatualizado.
//
// Política fail-open: se UazAPI falhar/timeout, autoriza o envio (não trava
// o bot inteiro por instabilidade de rede). Se a etiqueta sumir → bloqueia.

import { supabase } from './supabase';
import { fetchChatDetailsRaw, normalizeChatDetails } from './uazapi-chat-details';

// Timeout curto de propósito: isto roda no caminho do envio da mensagem, e a
// política é fail-open — esperar 10s pela UazAPI atrasaria toda resposta do bot.
const UAZ_TIMEOUT_MS = 4000;

interface VerifyResult {
  allowed: boolean;
  reason: string;
}

/** Etiquetas do chat, já sem o prefixo "instancia:". null = UazAPI indisponível. */
async function fetchChatLabels(baseUrl: string, token: string, number: string): Promise<string[] | null> {
  try {
    const raw = await fetchChatDetailsRaw(baseUrl, token, number, {
      preview: false,
      timeoutMs: UAZ_TIMEOUT_MS,
    });
    return normalizeChatDetails(raw).wa_labels;
  } catch {
    return null;
  }
}

/**
 * Verifica se a etiqueta do agente ativo ainda está no chat na UazAPI.
 * - Sem agente ativo no DB → não interfere (return allowed=true; o caller já decide pelo DB).
 * - UazAPI indisponível / lookup falhou → fail-open (allowed=true).
 * - Etiqueta sumiu → desativa no DB e retorna allowed=false.
 */
export async function verifyAgentLabelBeforeSend(phone: string, instanceName: string): Promise<VerifyResult> {
  try {
    const { data: convAgent } = await supabase
      .from('whatsapp_conversation_agents')
      .select('agent_id, is_active')
      .eq('phone', phone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (!convAgent || !(convAgent as any).is_active) {
      // DB já diz inativo → caller decide. Não interfere.
      return { allowed: true, reason: 'no-active-agent-in-db' };
    }

    const agentId = (convAgent as any).agent_id;
    if (!agentId) return { allowed: true, reason: 'no-agent-id' };

    // Pega label_id mapeado para esse agente nessa instância
    const { data: mapping } = await supabase
      .from('agent_instance_labels')
      .select('label_id, deleted_at')
      .eq('agent_id', agentId)
      .ilike('instance_name', instanceName)
      .maybeSingle();

    if (!mapping || (mapping as any).deleted_at || !(mapping as any).label_id) {
      // Sem mapping → não conseguimos verificar. Fail-open.
      return { allowed: true, reason: 'no-label-mapping' };
    }

    const expectedLabelId = String((mapping as any).label_id);

    // Pega credenciais da instância
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instance_token, base_url')
      .ilike('instance_name', instanceName)
      .eq('is_active', true)
      .maybeSingle();

    if (!inst || !(inst as any).instance_token) {
      return { allowed: true, reason: 'no-instance-creds' };
    }

    const baseUrl = (inst as any).base_url || 'https://abraci.uazapi.com';
    const labelsOnChat = await fetchChatLabels(baseUrl, (inst as any).instance_token, phone);

    if (labelsOnChat === null) {
      // UazAPI falhou → fail-open
      return { allowed: true, reason: 'uazapi-unreachable' };
    }

    const present = labelsOnChat.includes(expectedLabelId);
    if (present) return { allowed: true, reason: 'label-present' };

    // Etiqueta sumiu na UazAPI mas DB diz ativo → reconcilia e bloqueia.
    await supabase
      .from('whatsapp_conversation_agents')
      .update({ is_active: false, human_paused_until: null, updated_at: new Date().toISOString() } as any)
      .eq('phone', phone)
      .eq('instance_name', instanceName);

    console.log(`[verify-label] BLOCKED reply phone=${phone} instance=${instanceName} expected_label=${expectedLabelId} found=[${labelsOnChat.join(',')}] → deactivated`);
    return { allowed: false, reason: 'label-missing-deactivated' };
  } catch (e) {
    console.warn('[verify-label] error (fail-open):', (e as Error)?.message);
    return { allowed: true, reason: 'error-fail-open' };
  }
}

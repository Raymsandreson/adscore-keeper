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
import { loadCurrentLabelNames, checkLabelName, labelIdSuffix } from './label-name-guard';

const UAZ_TIMEOUT_MS = 4000;

interface VerifyResult {
  allowed: boolean;
  reason: string;
}

async function fetchChatLabels(baseUrl: string, token: string, number: string): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UAZ_TIMEOUT_MS);
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number, preview: false }),
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const data: any = await r.json().catch(() => null);
    const chat = data?.chat || data || {};
    const waLabel = chat?.wa_label ?? chat?.wa_labels ?? data?.wa_label ?? data?.wa_labels;
    if (!Array.isArray(waLabel)) return [];
    const ids: string[] = [];
    for (const raw of waLabel) {
      if (typeof raw !== 'string') continue;
      const id = raw.includes(':') ? raw.split(':').pop() : raw;
      if (id) ids.push(String(id).trim());
    }
    return ids;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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
      .select('label_id, label_name, deleted_at')
      .eq('agent_id', agentId)
      .ilike('instance_name', instanceName)
      .maybeSingle();

    if (!mapping || (mapping as any).deleted_at || !(mapping as any).label_id) {
      // Sem mapping → não conseguimos verificar. Fail-open.
      return { allowed: true, reason: 'no-label-mapping' };
    }

    // O banco guarda "owner:id" ("558681595991:29") mas fetchChatLabels devolve
    // só o sufixo ("29"). Sem normalizar, o includes abaixo NUNCA batia e todo
    // envio com mapping caía no ramo "etiqueta sumiu" — bloqueava e desativava
    // o agente por engano. Bug pré-existente, corrigido aqui.
    const expectedLabelId = labelIdSuffix((mapping as any).label_id);

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
    if (present) {
      // Segunda camada contra ID reciclado: a etiqueta está no chat, mas ainda
      // se chama o que o mapping diz? Se o número foi herdado por outra
      // etiqueta, o webhook pode ter ativado antes do guard existir (ou com a
      // UazAPI fora do ar). Aqui é o último portão antes de falar com o cliente.
      const currentNames = await loadCurrentLabelNames(instanceName);
      const verdict = checkLabelName(currentNames, expectedLabelId, (mapping as any).label_name);
      if (verdict === 'stale') {
        await supabase
          .from('whatsapp_conversation_agents')
          .update({ is_active: false, human_paused_until: null, updated_at: new Date().toISOString() } as any)
          .eq('phone', phone)
          .eq('instance_name', instanceName);
        console.log(`[verify-label] BLOCKED reply phone=${phone} instance=${instanceName} label=${expectedLabelId} nome_no_banco="${(mapping as any).label_name}" nome_na_uazapi="${currentNames?.get(expectedLabelId)}" → ID reciclado, agente desativado`);
        return { allowed: false, reason: 'label-name-mismatch-deactivated' };
      }
      return { allowed: true, reason: 'label-present' };
    }

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

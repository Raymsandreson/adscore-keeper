import { geminiChat } from './gemini';

/**
 * 1ª mensagem proativa do agente.
 *
 * Mora aqui, e não dentro do webhook, porque agora tem DOIS gatilhos: a etiqueta
 * aplicada no WhatsApp (webhook) e a ativação do agente pela tela do sistema
 * (menu da conversa, cabeçalho do chat, popup do aviso), que chega pela função
 * agent-proactive-first-message.
 *
 * Gera a mensagem com a IA (lendo o histórico, para não soar telemarketing) e
 * envia pelo UazAPI sem esperar o cliente abrir a conversa. Idempotente por
 * (phone, instance_name, agent_id): ativar de novo não manda duas vezes.
 */
/** O que aconteceu com o disparo — a tela avisa quem mandou ativar. */
export interface ResultadoProativa {
  sent: boolean;
  /** Por que não saiu (proativa desligada, já enviada antes, erro no envio…). */
  reason?: string;
  text?: string;
}

export async function triggerProactiveFirstMessage(
  supabase: any,
  phone: string,
  instanceName: string,
  agentId: string,
): Promise<ResultadoProativa> {
  try {
    if (!agentId || !phone || !instanceName) return { sent: false, reason: 'faltam dados da conversa' };

    const { data: agent } = await supabase
      .from('wjia_command_shortcuts')
      .select('id, shortcut_name, base_prompt, prompt_instructions, proactive_first_message_enabled, proactive_first_message_instruction')
      .eq('id', agentId)
      .maybeSingle();

    if (!agent || !(agent as any).proactive_first_message_enabled) return { sent: false, reason: 'proativa desligada neste agente' };

    // Idempotência: já mandou pra esse phone+instance+agent? não repete.
    const { data: prior } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('phone', phone)
      .ilike('instance_name', instanceName)
      .eq('action_source', 'proactive_first_message')
      .eq('action_source_detail', String(agentId))
      .limit(1)
      .maybeSingle();
    if (prior) {
      console.log('[proactive] já disparado antes, skip', { phone, instanceName, agentId });
      return { sent: false, reason: 'já enviada nesta conversa' };
    }

    // Credenciais da instância
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instance_token, base_url')
      .ilike('instance_name', instanceName)
      .limit(1)
      .maybeSingle();
    const token = (inst as any)?.instance_token;
    const baseUrl = (inst as any)?.base_url || 'https://abraci.uazapi.com';
    if (!token) {
      console.warn('[proactive] instância sem token, abortando', { instanceName });
      return { sent: false, reason: 'instância sem token' };
    }

    // Monta prompt
    const basePrompt = (agent as any).base_prompt || '';
    const extra = (agent as any).prompt_instructions || '';
    const proactiveExtra = (agent as any).proactive_first_message_instruction || '';

    // Puxa últimas 30 mensagens da conversa pra dar contexto à IA.
    // Sem isso, o agente fala como telemarketing ("oi tudo bem, passando pra saber...").
    let historyBlock = '';
    let lastContactName: string | null = null;
    try {
      const { data: history } = await supabase
        .from('whatsapp_messages')
        .select('created_at, direction, message_text, contact_name, message_type')
        .eq('phone', phone)
        .ilike('instance_name', instanceName)
        .order('created_at', { ascending: false })
        .limit(30);
      if (Array.isArray(history) && history.length) {
        const ordered = [...history].reverse();
        lastContactName = (ordered.find((m: any) => m.contact_name)?.contact_name) || null;
        const lines = ordered
          .map((m: any) => {
            const who = m.direction === 'inbound' ? 'CLIENTE' : 'ATENDENTE';
            const txt = (m.message_text && String(m.message_text).trim())
              || (m.message_type && m.message_type !== 'text' ? `[${m.message_type}]` : '');
            if (!txt) return '';
            return `${who}: ${txt.replace(/\s+/g, ' ').slice(0, 400)}`;
          })
          .filter(Boolean)
          .join('\n');
        if (lines) historyBlock = `--- HISTÓRICO RECENTE DA CONVERSA (mais antiga → mais recente) ---\n${lines}`;
      }
    } catch (e: any) {
      console.warn('[proactive] falha lendo histórico (segue sem):', e?.message);
    }

    const hasHistory = !!historyBlock;
    const system = [
      basePrompt,
      extra,
      historyBlock,
      '--- DISPARO PROATIVO ---',
      hasHistory
        ? 'Você está RETOMANDO uma conversa que já existe acima. Leia o histórico e escreva UMA mensagem curta, humana, no tom do agente, que continue de onde parou — referenciando o último assunto/contexto real. NUNCA escreva saudações genéricas tipo "Olá, tudo bem? Passando pra saber..." — isso soa telemarketing e está PROIBIDO. Se houver pendência clara, pergunte sobre ela. Se a última mensagem foi sua, dê seguimento natural.'
        : 'Esta é a PRIMEIRA mensagem que o cliente vai receber. Ele ainda não escreveu nada. Inicie a conversa de forma natural, curta e humana, no tom do agente.',
      lastContactName ? `Nome do contato: ${lastContactName}` : '',
      proactiveExtra ? `Instrução extra do operador: ${proactiveExtra}` : '',
    ].filter(Boolean).join('\n\n');

    let aiText = '';
    try {
      const aiResp = await geminiChat({
        model: 'google/gemini-3.6-flash',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: hasHistory
              ? 'Gere agora a próxima mensagem para retomar a conversa, levando em conta o histórico acima.'
              : 'Gere agora a primeira mensagem para iniciar a conversa.' },
        ],
        temperature: 0.7,
        max_tokens: 400,
      });
      aiText = String(aiResp?.choices?.[0]?.message?.content || '').trim();
    } catch (e: any) {
      console.error('[proactive] erro na IA:', e?.message);
      return { sent: false, reason: 'falha ao gerar com a IA' };
    }
    if (!aiText) {
      console.warn('[proactive] IA retornou vazio, abortando');
      return { sent: false, reason: 'a IA não devolveu texto' };
    }

    // Envia via UazAPI
    let externalId: string | null = null;
    try {
      const sendResp = await fetch(`${String(baseUrl).replace(/\/$/, '')}/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ number: phone, text: aiText }),
      });
      const sendJson: any = await sendResp.json().catch(() => null);
      externalId = sendJson?.id || sendJson?.messageId || sendJson?.key?.id || null;
      if (!sendResp.ok) {
        console.warn('[proactive] UazAPI retornou erro', sendResp.status, sendJson);
        return { sent: false, reason: 'o WhatsApp recusou o envio' };
      }
    } catch (e: any) {
      console.error('[proactive] erro enviando UazAPI:', e?.message);
      return { sent: false, reason: 'falha ao enviar pelo WhatsApp' };
    }

    // Loga como outbound + marca idempotência
    try {
      await supabase.from('whatsapp_messages').insert({
        phone,
        instance_name: instanceName,
        message_text: aiText,
        message_type: 'text',
        direction: 'outbound',
        external_message_id: externalId,
        action_source: 'proactive_first_message',
        action_source_detail: String(agentId),
      } as any);
    } catch (e: any) {
      console.warn('[proactive] falha registrando mensagem (não-fatal):', e?.message);
    }

    console.log('[proactive] 1ª mensagem enviada', { phone, instanceName, agentId, length: aiText.length });
    return { sent: true, text: aiText };
  } catch (e: any) {
    console.error('[proactive] erro inesperado:', e?.message);
    return { sent: false, reason: e?.message || 'erro inesperado' };
  }
}

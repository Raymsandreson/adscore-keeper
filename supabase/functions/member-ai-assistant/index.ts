import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { geminiChat } from "../_shared/gemini.ts";
import { toolDefinitions } from "./tools-definitions.ts";
import { executeToolCall } from "./tools-executor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function formatDatePtBr(dateValue: string | null | undefined) {
  if (!dateValue) return 'Não informado'
  const d = new Date(dateValue)
  if (Number.isNaN(d.getTime())) return dateValue
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { phone, instance_name, message_text, member_user_id, member_name, external_message_id, media_url, message_type, media_type } = await req.json()
    if (!phone || !instance_name || (!message_text && !media_url)) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ========== MESSAGE BATCHING DELAY ==========
    // Read delay from config, default 6 seconds
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: memberConfig } = await supabase
      .from('member_assistant_config')
      .select('batch_delay_seconds, assistant_prompt')
      .limit(1)
      .maybeSingle()

    const MEMBER_BATCH_DELAY_SECONDS = (memberConfig as any)?.batch_delay_seconds ?? 6
    if (MEMBER_BATCH_DELAY_SECONDS > 0) {
      console.log(`Member assistant batching: waiting ${MEMBER_BATCH_DELAY_SECONDS}s for more messages from ${phone}`)
      await new Promise(resolve => setTimeout(resolve, MEMBER_BATCH_DELAY_SECONDS * 1000))
    }




    // Check if newer messages arrived during the batching delay — if so, skip this invocation
    if (MEMBER_BATCH_DELAY_SECONDS > 0) {
      const cutoffTime = new Date(Date.now() - MEMBER_BATCH_DELAY_SECONDS * 1000).toISOString()
      const { data: newerMsgs } = await supabase
        .from('whatsapp_messages')
        .select('id, created_at')
        .eq('phone', phone)
        .eq('instance_name', instance_name)
        .eq('direction', 'inbound')
        .gt('created_at', cutoffTime)
        .order('created_at', { ascending: false })
        .limit(1)

      if (newerMsgs && newerMsgs.length > 0) {
        const newestAge = Date.now() - new Date((newerMsgs[0] as any).created_at).getTime()
        const freshThreshold = MEMBER_BATCH_DELAY_SECONDS * 800 // 80% of delay
        if (newestAge < freshThreshold) {
          console.log(`Member batching: newer message detected (age: ${newestAge}ms), skipping this invocation`)
          return new Response(JSON.stringify({ skipped: true, reason: 'batching_dedup' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
      console.log(`Member batching delay complete: processing accumulated messages for ${phone}`)
    }

    // Get instance credentials for sending reply
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url')
      .eq('instance_name', instance_name)
      .eq('is_active', true)
      .single()

    if (!inst) {
      console.error('No active instance found:', instance_name)
      return new Response(JSON.stringify({ error: 'Instance not found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ========== CONTEXT ISOLATION ==========
    // Strategy: only load messages AFTER the last completed action (outbound with link/summary).
    // This prevents old commands from influencing new ones.
    // If the AI asked a follow-up question (no action completed), keep that context.

    // Find the last outbound message that contains action completion markers
    const { data: lastCompletedAction } = await supabase
      .from('whatsapp_messages')
      .select('created_at')
      .eq('phone', phone)
      .eq('instance_name', instance_name)
      .eq('direction', 'outbound')
      .not('message_text', 'is', null)
      .or('message_text.ilike.%🔗 *Acessar:*%,message_text.ilike.%📌 *Atividade criada*%,message_text.ilike.%✅%Lead%criado%,message_text.ilike.%✅%Contato%criado%,message_text.ilike.%✅%movido%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const contextStartTime = lastCompletedAction?.created_at
      ? new Date(lastCompletedAction.created_at).toISOString()
      : new Date(Date.now() - 5 * 60 * 1000).toISOString() // fallback: 5 min window

    let historyQuery = supabase
      .from('whatsapp_messages')
      .select('direction, message_text, created_at')
      .eq('phone', phone)
      .eq('instance_name', instance_name)
      .not('message_text', 'is', null)
      .gt('created_at', contextStartTime)
      .order('created_at', { ascending: false })
      .limit(15)

    const { data: historyData } = await historyQuery

    const currentText = (message_text || '').trim()
    const conversationMessages = (historyData || [])
      .reverse()
      .filter((m: any) => {
        const text = m.message_text?.trim()
        if (!text) return false
        if (/^⚠️\s*\*?Alerta de Desconexão/i.test(text)) return false
        if (text.startsWith('🤖 *WhatsJUD IA*')) return false
        if (currentText && text === currentText) return false
        return true
      })
      .map((m: any) => ({
        role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
        content: m.message_text,
      }))

    const systemPrompt = `Você é o assistente interno da equipe, acessado via WhatsApp. 
O membro que está falando com você é: ${member_name || 'Membro da equipe'} (ID: ${member_user_id}).

Você pode:
- Buscar tarefas atrasadas (do membro ou da equipe)
- Gerar resumos de produtividade do dia
- Consultar leads e seus status
- Criar novas atividades/tarefas
- Consultar progresso de metas
- *Criar leads* no sistema (funis de vendas ou fluxos de trabalho)
- *Editar/atualizar leads* existentes (nome, valor, responsável, etapa, etc.)
- *Criar contatos* no sistema
- *Vincular contatos a leads* existentes
- *Mudar a etapa/fase* de um lead no funil
- *Buscar leads por localização* (cidade/estado) — encontrar leads próximos
- *Ver detalhes completos* de um lead (campos customizados, valor, etapa, etc.)
- *Resumo de contatos* vinculados a um lead (relacionamento, ligações, atividades)
- *Gerenciar agentes de IA* em conversas WhatsApp (ativar, desativar, verificar status)

Regras:
- Responda de forma concisa e direta, formatado para WhatsApp (use *negrito* e listas com •)
- Quando o usuário pedir algo vago como "resumo", use a ferramenta get_daily_summary
- Quando perguntar sobre tarefas, use get_overdue_tasks
- Sempre execute as ferramentas necessárias antes de responder
- Use "mine" como scope padrão, a menos que o membro peça informações da equipe toda
- Ao criar atividades, preencha campos automaticamente com base no contexto (prioridade, deadline)
- Ao criar leads, pergunte pelo menos o nome e o quadro/funil se não informados
- Ao mover lead de etapa, primeiro busque o lead e as etapas disponíveis se necessário
- Inclua emojis relevantes nas respostas para melhor legibilidade
- Quando o membro pedir para criar contato e vincular a lead, execute ambas ferramentas em sequência

REGRA OBRIGATÓRIA DE LINKS:
Quando uma ferramenta retornar um campo "link" no resultado, você DEVE incluir esse link na sua resposta final. 
Formato obrigatório: coloque o link em uma linha separada no final da resposta, assim:
🔗 *Acessar:* <cole aqui o valor do campo link>
Se a ferramenta retornou link, sua resposta PRECISA conter esse link. Não resuma, não omita, não substitua.
- Para gerenciar agentes: quando o membro pedir "desativar assistente na conversa com X", use manage_conversation_agent com action=deactivate e contact_name=X
- Sempre busque o contato pelo nome quando o membro não informar o telefone diretamente

REGRA DE MÍDIA ANEXADA:
- Quando o membro enviar uma mensagem junto com uma imagem ou documento (indicado por [MÍDIA ANEXADA]), você DEVE:
  1. Analisar o conteúdo da mídia (a descrição já foi extraída para você)
  2. Usar as informações da mídia para preencher campos da atividade (descrição, notas, etc.)
  3. Ao criar atividade com mídia, SEMPRE passe media_url no parâmetro da ferramenta create_activity
  4. Mencione na resposta que a mídia foi analisada e anexada à atividade
- Se o membro enviar APENAS uma mídia sem texto claro de comando, pergunte o que ele deseja fazer com ela`

    // Build user message content with media if present
    const hasMedia = media_url && message_type !== 'text'
    let userContent: any = message_text || ''
    
    if (hasMedia) {
      // For images, use vision capability
      if (message_type === 'image' && media_url) {
        userContent = [
          { type: 'text', text: `[MÍDIA ANEXADA: imagem]\n${message_text || 'O membro enviou uma imagem. Analise o conteúdo e pergunte o que deseja fazer.'}` },
          { type: 'image_url', image_url: { url: media_url } },
        ]
      } else if (message_type === 'document') {
        userContent = `[MÍDIA ANEXADA: documento - ${media_type || 'arquivo'}]\nURL: ${media_url}\n${message_text || 'O membro enviou um documento. Pergunte o que deseja fazer com ele.'}`
      } else {
        userContent = `[MÍDIA ANEXADA: ${message_type} - ${media_type || ''}]\nURL: ${media_url}\n${message_text || 'O membro enviou uma mídia. Pergunte o que deseja fazer.'}`
      }
    }

    // First AI call with tools
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationMessages.slice(-10),
      { role: 'user' as const, content: userContent },
    ]

    let response = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: aiMessages,
      tools: toolDefinitions,
    })

    let assistantMessage = response.choices?.[0]?.message
    let finalText = assistantMessage?.content || ''

    // Admin tools that should result in ephemeral (auto-delete) responses
    const ADMIN_TOOLS = new Set(['manage_conversation_agent'])
    let usedAdminTool = false
    const collectedLinks: string[] = []
    const createdActivitySummaries: string[] = []
    let hasCreatedActivityInRequest = false

    // Process tool calls if any (support multi-turn)
    let iterations = 0
    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < 5) {
      iterations++
      const toolResults: any[] = []

      for (const toolCall of assistantMessage.tool_calls) {
        const fnName = toolCall.function?.name
        const fnArgs = JSON.parse(toolCall.function?.arguments || '{}')
        console.log('Executing tool:', fnName, 'with args:', fnArgs)

        if (ADMIN_TOOLS.has(fnName)) usedAdminTool = true

        let result: any = null
        if (fnName === 'create_activity' && hasCreatedActivityInRequest) {
          result = { skipped: true, reason: 'duplicate_create_activity_ignored' }
        }
        try {
          if (!result) {
            result = await executeToolCall(supabase, fnName, fnArgs, member_user_id, member_name)
          }
          if (fnName === 'create_activity' && result?.success) {
            hasCreatedActivityInRequest = true
          }
        } catch (e) {
          result = { error: String(e) }
        }

        // Collect links from tool results for fallback
        if (result?.link) collectedLinks.push(result.link)

        if (fnName === 'create_activity' && result?.success) {
          createdActivitySummaries.push(
            [
              '📌 *Atividade criada*',
              `• Título: ${result.title || 'Não informado'}`,
              `• Data de criação: ${formatDatePtBr(result.created_at)}`,
              `• Tipo: ${result.activity_type || 'tarefa'}`,
              `• Status: ${result.status || 'pendente'}`,
              `• O que foi feito: ${result.what_was_done || 'Não informado'}`,
              `• Próximo passo: ${result.next_steps || 'Não informado'}`,
              `• Observação: ${result.current_status_notes || result.notes || 'Não informado'}`,
            ].join('\n')
          )
        }

        toolResults.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: JSON.stringify(result || { error: 'Unknown tool' }),
        })
      }

      // Follow-up AI call with tool results
      aiMessages.push(assistantMessage, ...toolResults)

      const followUp = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: aiMessages,
        tools: toolDefinitions,
      })

      assistantMessage = followUp.choices?.[0]?.message
      finalText = assistantMessage?.content || ''
    }

    if (createdActivitySummaries.length > 0) {
      const summaryBlock = createdActivitySummaries.join('\n\n')
      if (!finalText) finalText = summaryBlock
      else if (!finalText.includes('📌 *Atividade criada*')) finalText += `\n\n${summaryBlock}`
    }

    // Fallback: if tool returned links but AI omitted them, append
    if (collectedLinks.length > 0 && finalText) {
      for (const link of collectedLinks) {
        if (!finalText.includes(link)) {
          finalText += `\n\n🔗 *Acessar:* ${link}`
        }
      }
    }

    if (!finalText) {
      finalText = 'Desculpe, não consegui gerar uma resposta. Tente novamente.'
    }

    // Send reply via WhatsApp
    const sendResp = await fetch(`${inst.base_url}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': inst.instance_token },
      body: JSON.stringify({ number: phone, text: finalText }),
    })

    const sendResult = await sendResp.json().catch(() => ({}))
    console.log('Member assistant reply sent:', sendResp.status, 'to:', phone, 'ephemeral:', usedAdminTool)

    // For admin tool responses, auto-delete the reply and original command after a delay
    if (usedAdminTool && sendResp.ok) {
      // Wait 8 seconds so the member can read the notification pop-up
      setTimeout(async () => {
        try {
          // Delete the AI reply message
          const replyMsgId = sendResult?.key?.id || sendResult?.id || sendResult?.messageId
          if (replyMsgId) {
            await fetch(`${inst.base_url}/message/delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': inst.instance_token },
              body: JSON.stringify({ id: replyMsgId }),
            })
            console.log('Ephemeral reply deleted:', replyMsgId)
          }
          // Delete the original command message from member
          if (external_message_id) {
            await fetch(`${inst.base_url}/message/delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': inst.instance_token },
              body: JSON.stringify({ id: external_message_id }),
            })
            console.log('Original command deleted:', external_message_id)
          }
          // Also clean up from DB
          if (external_message_id) {
            await supabase.from('whatsapp_messages').delete().eq('external_message_id', external_message_id)
          }
        } catch (e) {
          console.error('Error deleting ephemeral messages:', e)
        }
      }, 8000)
    }

    return new Response(
      JSON.stringify({ success: true, reply_sent: sendResp.ok, ephemeral: usedAdminTool }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Member AI assistant error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

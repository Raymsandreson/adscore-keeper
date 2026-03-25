import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { geminiChat } from "../_shared/gemini.ts";
import { toolDefinitions } from "./tools-definitions.ts";
import { executeToolCall } from "./tools-executor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

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

    // Load conversation history for context (last 20 messages)
    const { data: history } = await supabase
      .from('whatsapp_messages')
      .select('direction, message_text, created_at')
      .eq('phone', phone)
      .eq('instance_name', instance_name)
      .not('message_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)

    const conversationMessages = (history || [])
      .reverse()
      .filter((m: any) => m.message_text?.trim())
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
- Sempre busque o contato pelo nome quando o membro não informar o telefone diretamente`

    // First AI call with tools
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationMessages.slice(-10),
      { role: 'user' as const, content: message_text },
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
        try {
          result = await executeToolCall(supabase, fnName, fnArgs, member_user_id, member_name)
        } catch (e) {
          result = { error: String(e) }
        }

        // Collect links from tool results for fallback
        if (result?.link) collectedLinks.push(result.link)

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

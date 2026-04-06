import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name } = await req.json();
    if (!phone) {
      return new Response(JSON.stringify({ error: 'phone is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('EXTERNAL_SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch last messages from conversation
    const normalizedPhone = phone.replace(/\D/g, '');
    const { data: messages } = await supabase
      .from('whatsapp_messages')
      .select('message_text, direction, message_type')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(20);

    const conversationText = (messages || [])
      .reverse()
      .filter(m => m.message_text)
      .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.message_text}`)
      .join('\n');

    // Fetch all active agents
    const { data: agents } = await supabase
      .from('whatsapp_ai_agents')
      .select('id, name, description, system_prompt')
      .eq('is_active', true)
      .order('name');

    if (!agents || agents.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum agente disponível' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const agentDescriptions = agents.map((a, i) => 
      `${i + 1}. **${a.name}** (ID: ${a.id}): ${a.description || a.system_prompt?.substring(0, 200) || 'Sem descrição'}`
    ).join('\n');

    const prompt = `Analise a conversa abaixo e determine qual agente de IA seria o mais adequado para atender este cliente.

CONVERSA:
${conversationText || 'Sem mensagens ainda'}

AGENTES DISPONÍVEIS:
${agentDescriptions}

Responda SOMENTE com um JSON no formato:
{"agent_id": "ID_DO_AGENTE", "agent_name": "NOME_DO_AGENTE", "reason": "Explicação curta de por que este agente é o melhor"}`;

    const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!googleApiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
      }
    );

    const aiData = await aiResponse.json();
    const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'Failed to parse AI response' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const suggestion = JSON.parse(jsonMatch[0]);

    // Validate agent_id exists
    const validAgent = agents.find(a => a.id === suggestion.agent_id);
    if (!validAgent) {
      // Fallback: try matching by name
      const byName = agents.find(a => a.name.toLowerCase().includes(suggestion.agent_name?.toLowerCase() || ''));
      if (byName) {
        suggestion.agent_id = byName.id;
        suggestion.agent_name = byName.name;
      } else {
        return new Response(JSON.stringify({ error: 'Agent not found', suggestion }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify(suggestion), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

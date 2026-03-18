import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, existing_config } = await req.json();
    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: "Descrição é obrigatória" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um especialista em configurar atalhos de automação para um sistema de CRM jurídico via WhatsApp.

O sistema funciona assim: quando o usuário envia "@wjia <nome_atalho>" no WhatsApp, o robô executa ações automatizadas.

Cada atalho tem:
1. **shortcut_name**: Nome curto do atalho (sem espaços, minúsculo, ex: "procuracao", "contrato", "honorarios")
2. **description**: Descrição breve do que o atalho faz
3. **prompt_instructions**: Instruções detalhadas para a IA sobre como conduzir a conversa, coletar dados, gerar documentos, etc.
   IMPORTANTE: O prompt_instructions DEVE incluir também as instruções de COMO o follow-up deve funcionar (o que dizer em cada etapa, tom, abordagem). NÃO há campo separado para mensagem de follow-up — tudo fica no prompt.
4. **media_extraction_prompt**: Instruções ESPECÍFICAS de como a IA deve interpretar documentos recebidos por mídia (RG, CNH, comprovantes de endereço, etc). Estas instruções são usadas quando o cliente envia fotos de documentos e a IA precisa extrair dados via OCR.
   - Se o atalho solicita documentos, SEMPRE gere instruções detalhadas de extração
   - Inclua regras específicas para documentos brasileiros (RG, CNH, CPF, etc)
   - Explique onde encontrar cada dado no documento (ex: "O NOME está em letras grandes/vermelhas")
   - Inclua armadilhas comuns (ex: não confundir FILIAÇÃO com o nome do titular, ignorar nomes de diretores/funcionários no verso)
   - Se o atalho NÃO envolve documentos, deixe este campo vazio
5. **followup_steps**: Array de etapas de follow-up automático — define apenas TIPO de ação e TEMPO de espera.

Tipos de ações para followup_steps:
- "whatsapp_message": Envia mensagem WhatsApp (o prompt define o que dizer)
- "call": Agenda ligação. Tem "assigned_to" (deixe vazio)
- "create_activity": Cria atividade/tarefa. Tem "assigned_to" (deixe vazio), "activity_type" (ex: "tarefa", "ligacao")

Para delay_minutes: use valores realistas e VARIADOS conforme a urgência e bom senso:
- 1ª cobrança: 60-120 min (1-2h)
- 2ª: 1440-2880 (1-2 dias)
- Ligação: geralmente após 2ª ou 3ª mensagem sem resposta
- Escale gradualmente os tempos
- Monte uma sequência infinita lógica (mínimo 4-6 etapas), alternando mensagens, ligações e atividades conforme faça sentido

O prompt_instructions deve ser COMPLETO e incluir:
- Papel/persona do agente
- Tom de voz adequado
- Dados que precisa coletar do cliente
- Fluxo da conversa (saudação → coleta → confirmação → geração)
- Regras de comportamento
- Formato das respostas (curtas, com emojis, profissional)
- Instruções de follow-up: o que dizer em cada etapa de cobrança, como escalar o tom, quando ser mais insistente

IMPORTANTE: O prompt_instructions deve ser extremamente detalhado e cobrir todas as situações possíveis.

Responda APENAS com JSON válido no formato:
{
  "shortcut_name": "string",
  "description": "string",
  "prompt_instructions": "string",
  "media_extraction_prompt": "string (instruções OCR, ou string vazia se não aplicável)",
  "followup_steps": [
    {
      "action_type": "whatsapp_message" | "call" | "create_activity",
      "delay_minutes": number,
      "assigned_to": "string (opcional, deixe vazio)",
      "activity_type": "string (opcional)"
    }
  ]
}`;

    let userMessage: string;
    if (existing_config) {
      userMessage = `O atalho atual é:
- Nome: ${existing_config.shortcut_name}
- Descrição: ${existing_config.description || '(sem descrição)'}
- Prompt: ${existing_config.prompt_instructions || '(sem prompt)'}
- Follow-up: ${JSON.stringify(existing_config.followup_steps || [])}

O usuário quer as seguintes mudanças: ${description.trim()}

Retorne a configuração COMPLETA atualizada (não apenas as mudanças), mantendo o que não foi pedido para alterar.`;
    } else {
      userMessage = `Crie um atalho completo para: ${description.trim()}`;
    }

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const rawContent = result.choices?.[0]?.message?.content || "";
    
    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = rawContent.trim();
    // Try multiple patterns to extract JSON
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // Try to find raw JSON object
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }
    }
    
    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.shortcut_name || !parsed.prompt_instructions) {
      throw new Error("Resposta incompleta da IA");
    }

    // Ensure followup_steps is array
    if (!Array.isArray(parsed.followup_steps)) {
      parsed.followup_steps = [];
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-shortcut-config error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro ao gerar configuração" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

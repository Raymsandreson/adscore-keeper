import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callGemini } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      fieldLabel,
      phaseLabel,
      objectiveLabel,
      stepLabel,
      existingNames = [],
      tone = "profissional, cordial, em português brasileiro",
      extraContext = "",
    } = await req.json();

    if (!stepLabel && !fieldLabel) {
      return new Response(
        JSON.stringify({ success: false, error: "stepLabel ou fieldLabel é obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `Você é um assistente de CRM jurídico brasileiro especializado em redigir modelos de mensagem de WhatsApp para equipes de captação e pós-venda.

Sua tarefa: gerar UM modelo de mensagem (sem alternativas) para o campo "${fieldLabel || "mensagem"}" considerando o contexto do fluxo de trabalho abaixo.

Regras OBRIGATÓRIAS:
- Idioma: português brasileiro.
- Tom: ${tone}.
- Use as variáveis dinâmicas suportadas quando fizer sentido: {{saudacao}}, {{lead_name}}, {{titulo}}, {{responsavel_dr}}, {{data_retorno}}, {{campos_dinamicos}}, {{tempo_dedicado}}, {{what_was_done}}, {{current_status}}, {{next_steps}}, {{notes}}, {{case_number}}, {{process_number}}.
- Não invente variáveis fora dessa lista.
- Pode usar formatação WhatsApp (*negrito*, _itálico_) e quebras de linha.
- Não inclua preâmbulo, explicação, nem aspas envolvendo a resposta — devolva APENAS o texto do modelo.
- Tamanho: entre 3 e 10 linhas, direto e útil.
- Se já existem modelos com nomes ${JSON.stringify(existingNames)}, gere algo DIFERENTE em abordagem ou tom.

Devolva também um nome curto (até 4 palavras) que descreva esse modelo.`;

    const userPrompt = `Contexto do fluxo:
- Fase: ${phaseLabel || "(não informada)"}
- Objetivo: ${objectiveLabel || "(não informado)"}
- Passo atual: ${stepLabel || "(não informado)"}
- Campo da atividade: ${fieldLabel || "(não informado)"}
${extraContext ? `\nContexto adicional:\n${extraContext}` : ""}

Responda no formato EXATO:
NOME: <nome curto>
---
<conteúdo do modelo>`;

    const response = await callGemini({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 600,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", response.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `AI error: ${response.status}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await response.json();
    const raw: string =
      aiData.choices?.[0]?.message?.content ||
      aiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    let name = "";
    let content = raw.trim();
    const m = raw.match(/^\s*NOME:\s*(.+?)\s*\n-{3,}\s*\n([\s\S]+)$/i);
    if (m) {
      name = m[1].trim();
      content = m[2].trim();
    }

    return new Response(
      JSON.stringify({ success: true, name, content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[suggest-message-template]", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

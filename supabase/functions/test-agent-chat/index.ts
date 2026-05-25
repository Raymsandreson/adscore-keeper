import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callGemini, transformGeminiStream } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Substitui {lead.nome}, {contato.cidade}, {campo.X}... no prompt
 * pelos valores em `variables` (chave = caminho com ponto). Mantém
 * o placeholder se não houver valor (pra ficar visível o que falta).
 */
function applyVariables(text: string, variables: Record<string, string>) {
  if (!text) return text;
  return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (full, path) => {
    const v = variables?.[path];
    return v != null && v !== "" ? String(v) : full;
  });
}

const TEST_MODE_HINT = `\n\n[MODO TESTE]\nVocê está em uma sandbox de teste. Pode usar comandos do sistema normalmente entre colchetes (ex: [STATUS:inviavel], [TRANSFERIR:motivo], [FOLLOWUP:30], [ENCERRAR], [ATIVIDADE:tipo:descrição], [GRUPO]). Nada será executado de verdade, é só pra validar o comportamento.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      system_prompt = "",
      messages = [],
      model = "google/gemini-2.5-flash",
      variables = {},
    } = await req.json();

    const finalSystem = applyVariables(system_prompt, variables) + TEST_MODE_HINT;

    const payload = [
      { role: "system", content: finalSystem },
      ...messages.map((m: any) => ({
        role: m.role,
        // mantém arrays (multimodal: texto + imagem + áudio); senão coage pra string
        content: Array.isArray(m.content) ? m.content : String(m.content || ""),
      })),
    ];

    const response = await callGemini({ model, messages: payload, stream: true });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos esgotados. Adicione fundos no workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("test-agent-chat AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    return new Response(transformGeminiStream(response.body!), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("test-agent-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

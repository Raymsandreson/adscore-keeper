import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AVAILABLE_MODULES = [
  { key: "activities", label: "Atividades" },
  { key: "leads", label: "Leads / Funis" },
  { key: "analytics", label: "Analytics / Métricas" },
  { key: "finance", label: "Financeiro" },
  { key: "instagram", label: "Instagram / Comentários" },
  { key: "calls", label: "Ligações" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "whatsapp_private", label: "Conversas Privadas" },
  { key: "contacts", label: "Contatos" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Prompt inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

    const systemPrompt = `Você é um assistente que cria perfis de acesso para um sistema de CRM/gestão.

Módulos disponíveis (use EXATAMENTE estas keys):
${AVAILABLE_MODULES.map(m => `- "${m.key}": ${m.label}`).join("\n")}

Níveis de acesso: "view" (apenas visualizar) ou "edit" (visualizar e editar).

Baseado na descrição do usuário, gere um perfil de acesso com:
1. name: nome curto do perfil
2. description: descrição breve
3. module_permissions: array de objetos {module_key, access_level} com os módulos relevantes

Responda APENAS com JSON válido, sem markdown, sem explicações. Exemplo:
{"name":"Comercial","description":"Equipe de vendas","module_permissions":[{"module_key":"leads","access_level":"edit"},{"module_key":"whatsapp","access_level":"edit"}]}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: systemPrompt + "\n\nDescrição do perfil: " + prompt.trim() }] },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", response.status, errText);
      throw new Error("Erro na API de IA");
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    let profile;
    try {
      profile = JSON.parse(text);
    } catch {
      throw new Error("IA retornou formato inválido");
    }

    // Validate
    const validKeys = AVAILABLE_MODULES.map(m => m.key);
    if (!profile.name || !Array.isArray(profile.module_permissions)) {
      throw new Error("Perfil gerado incompleto");
    }
    profile.module_permissions = profile.module_permissions.filter(
      (p: any) => validKeys.includes(p.module_key) && ["view", "edit"].includes(p.access_level)
    );

    return new Response(JSON.stringify(profile), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-access-profile error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

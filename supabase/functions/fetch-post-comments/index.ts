import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
    if (!APIFY_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'APIFY_API_KEY não configurada', comments: [], total: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { postUrl, maxComments = 50, analyzeWithAI = true } = await req.json();

    if (!postUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL do post é obrigatória', comments: [], total: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Buscando comentários: ${postUrl}`);

    // Use run-sync-get-dataset-items for simpler flow (waits and returns items directly)
    const actorId = 'apify~instagram-comment-scraper';
    const syncUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;

    const runResponse = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [postUrl],
        resultsLimit: maxComments,
      }),
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error('Apify error:', runResponse.status, errorText);
      return new Response(
        JSON.stringify({ success: false, error: `Erro Apify: ${runResponse.status}`, comments: [], total: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const comments = await runResponse.json();
    console.log(`✅ ${comments.length} comentários extraídos`);

    // Analyze with AI if requested and comments exist
    let analysis = null;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (analyzeWithAI && LOVABLE_API_KEY && comments.length > 0) {
      const commentsText = comments
        .slice(0, 50)
        .map((c: any, i: number) => `[${i + 1}] @${c.ownerUsername || c.username || 'anon'}: ${c.text || ''}`)
        .join("\n");

      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `Você analisa comentários de posts sobre acidentes (trabalho, trânsito, etc). Extraia informações úteis.

Retorne APENAS um JSON válido:
{
  "victim_info": {
    "name": "Nome da vítima se mencionado nos comentários",
    "age": "Idade se mencionada",
    "profession": "Profissão se mencionada",
    "condition": "Estado de saúde / tipo de lesão mencionado"
  },
  "accident_info": {
    "date": "Data do acidente se mencionada (DD/MM/AAAA)",
    "location": "Local/cidade do acidente",
    "state": "Estado/UF se mencionado",
    "description": "Descrição adicional do acidente",
    "company": "Empresa mencionada"
  },
  "potential_contacts": [
    {
      "username": "@usuario",
      "type": "familiar|testemunha|conhecido|advogado|outro",
      "relationship": "Relação com a vítima",
      "info": "Informação relevante que mencionou",
      "phone": "Telefone se mencionado"
    }
  ],
  "additional_details": "Qualquer detalhe extra relevante",
  "sentiment": "solidariedade|revolta|informativo|misto",
  "key_comments": ["Até 5 comentários mais relevantes com informações úteis"]
}

Se não encontrar informação para um campo, use null.
Foque em identificar pessoas que conhecem a vítima (possíveis pontes/indicações).`
              },
              {
                role: "user",
                content: `Analise estes ${comments.length} comentários:\n\n${commentsText}`,
              },
            ],
            temperature: 0.2,
            response_format: { type: "json_object" },
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || "{}";
          try {
            analysis = JSON.parse(content);
          } catch {
            analysis = { additional_details: content };
          }
          console.log("✅ Análise de comentários concluída");
        }
      } catch (aiErr) {
        console.error("AI analysis error:", aiErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, comments, analysis, total: comments.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Fetch comments error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        comments: [],
        total: 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

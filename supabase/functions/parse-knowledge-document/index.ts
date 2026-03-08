import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { document_id } = await req.json();
    if (!document_id) {
      return new Response(JSON.stringify({ error: "Missing document_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get document record
    const { data: doc, error: docError } = await supabase
      .from("agent_knowledge_documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (docError || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status to processing
    await supabase
      .from("agent_knowledge_documents")
      .update({ status: "processing" } as any)
      .eq("id", document_id);

    // Download the PDF
    const fileUrl = (doc as any).file_url;
    console.log("Downloading PDF from:", fileUrl);

    const pdfResponse = await fetch(fileUrl);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfBuffer);

    // Extract text from PDF using simple text extraction
    let extractedText = extractTextFromPdf(pdfBytes);

    // If simple extraction fails or returns very little, use AI to summarize/extract
    if (extractedText.trim().length < 100 && LOVABLE_API_KEY) {
      console.log("Simple extraction yielded little text, attempting AI-based extraction...");
      
      // Convert to base64 for AI processing
      const base64 = btoa(String.fromCharCode(...pdfBytes));
      
      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extraia todo o texto deste documento PDF. Retorne apenas o conteúdo textual completo, sem formatação adicional ou comentários seus. Se houver tabelas, converta-as em texto legível."
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:application/pdf;base64,${base64}`
                    }
                  }
                ]
              }
            ],
            max_tokens: 8000,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const aiText = aiData.choices?.[0]?.message?.content || "";
          if (aiText.trim().length > extractedText.trim().length) {
            extractedText = aiText;
          }
        }
      } catch (aiErr) {
        console.error("AI extraction failed, using simple extraction:", aiErr);
      }
    }

    if (!extractedText.trim()) {
      await supabase
        .from("agent_knowledge_documents")
        .update({ 
          status: "error", 
          error_message: "Não foi possível extrair texto do PDF. Verifique se o arquivo contém texto legível.",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", document_id);

      return new Response(JSON.stringify({ error: "No text extracted" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Truncate if too long (max ~50k chars to avoid DB issues)
    const maxChars = 50000;
    if (extractedText.length > maxChars) {
      extractedText = extractedText.substring(0, maxChars) + "\n\n[... documento truncado por limite de tamanho]";
    }

    // Update document with extracted text
    await supabase
      .from("agent_knowledge_documents")
      .update({ 
        extracted_text: extractedText, 
        status: "ready",
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", document_id);

    console.log(`Document ${document_id} processed: ${extractedText.length} chars extracted`);

    return new Response(JSON.stringify({ 
      success: true, 
      chars_extracted: extractedText.length,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Parse error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Simple PDF text extraction - extracts text streams from PDF
function extractTextFromPdf(bytes: Uint8Array): string {
  const text: string[] = [];
  const decoder = new TextDecoder("latin1");
  const content = decoder.decode(bytes);

  // Find text between BT and ET operators (text blocks)
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;

  while ((match = btEtRegex.exec(content)) !== null) {
    const block = match[1];
    
    // Extract text from Tj and TJ operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const decoded = decodePdfString(tjMatch[1]);
      if (decoded.trim()) text.push(decoded);
    }

    // TJ arrays
    const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
    let arrMatch;
    while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
      const parts = arrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      const line: string[] = [];
      while ((strMatch = strRegex.exec(parts)) !== null) {
        line.push(decodePdfString(strMatch[1]));
      }
      if (line.join("").trim()) text.push(line.join(""));
    }
  }

  return text.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .replace(/\\([()])/g, "$1");
}

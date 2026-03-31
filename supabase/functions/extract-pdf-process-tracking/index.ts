import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return new Response(JSON.stringify({ error: "Nenhum arquivo enviado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = base64Encode(arrayBuffer);

    const prompt = `Analise este PDF e extraia todos os registros de processos/casos encontrados. 
Para cada registro, extraia os seguintes campos (use null se não encontrar):
- cliente (nome do cliente)
- caso (número/identificador do caso, ex: CASO 141, PREV 50)
- cpf (CPF do cliente)
- senha_gov (senha gov.br)
- data_criacao (data de criação)
- tipo (tipo do processo/benefício)
- acolhedor (nome do acolhedor)
- numero_processo (número do processo judicial)
- pendencia (pendências)
- data_gerar_guia (data para gerar guia)
- data_nascimento_bebe (data de nascimento do bebê)
- protocolado (se foi protocolado)
- data_protocolo_cancelamento (data do protocolo de cancelamento)
- tempo_dias (tempo em dias)
- status_processo (status do processo)
- data_decisao_final (data da decisão final)
- motivo_indeferimento (motivo do indeferimento)
- observacao (observações)
- cliente_no_grupo (se o cliente está no grupo)
- atividade_criada (se a atividade foi criada)
- pago_acolhedor (se foi pago ao acolhedor)
- data_pagamento (data do pagamento)

Retorne APENAS um JSON array válido com os registros encontrados. Exemplo:
[{"cliente": "João Silva", "caso": "CASO 100", "cpf": "123.456.789-00", ...}]

Se o PDF for uma planilha/tabela, extraia cada linha como um registro separado.
Se não encontrar dados de processos, retorne um array vazio [].`;

    const result = await geminiChat({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:application/pdf;base64,${base64}`,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    const content = result.choices?.[0]?.message?.content || "[]";
    
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    let rows;
    try {
      rows = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response:", content);
      rows = [];
    }

    if (!Array.isArray(rows)) {
      rows = [rows];
    }

    return new Response(JSON.stringify({ rows, total: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

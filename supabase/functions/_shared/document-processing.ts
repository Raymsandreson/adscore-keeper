/**
 * Document processing: OCR, classification, base64 conversion.
 */

import { geminiChat } from "./gemini.ts";
import {
  type TemplateFieldRef,
  normalizeFieldKey,
  normalizeIncomingField,
} from "./field-utils.ts";

// ============================================================
// BASE64 CONVERSION
// ============================================================

export async function urlToBase64DataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return url;
    const buffer = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)),
      );
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return url;
  }
}

// ============================================================
// DOCUMENT CLASSIFICATION
// ============================================================

export async function classifyDocument(
  mediaUrl: string,
  pendingTypes: string[],
): Promise<{ type: string; confidence: string; description: string }> {
  if (pendingTypes.length === 1) {
    return {
      type: pendingTypes[0],
      confidence: "alta",
      description: "Auto-assigned (single pending)",
    };
  }
  try {
    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            `Classifique o documento. TIPOS POSSÍVEIS: rg_cnh (identidade), comprovante_endereco, comprovante_renda, outros, invalido. PENDENTES: ${
              pendingTypes.join(", ")
            }`,
        },
        {
          role: "user",
          content: [{ type: "text", text: "Classifique:" }, {
            type: "image_url",
            image_url: { url: await urlToBase64DataUri(mediaUrl) },
          }],
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "classify_document",
          description: "Classifica",
          parameters: {
            type: "object",
            properties: {
              document_type: {
                type: "string",
                enum: [
                  "rg_cnh",
                  "comprovante_endereco",
                  "comprovante_renda",
                  "outros",
                  "invalido",
                ],
              },
              confidence: { type: "string" },
              description: { type: "string" },
            },
            required: ["document_type", "confidence", "description"],
          },
        },
      }],
      tool_choice: {
        type: "function",
        function: { name: "classify_document" },
      },
      temperature: 0.1,
    });
    const tc = result.choices?.[0]?.message?.tool_calls?.[0];
    return tc?.function?.arguments
      ? JSON.parse(tc.function.arguments)
      : { type: pendingTypes[0], confidence: "baixa", description: "Fallback" };
  } catch {
    return {
      type: pendingTypes[0],
      confidence: "baixa",
      description: "Error fallback",
    };
  }
}

// ============================================================
// OCR / DATA EXTRACTION FROM DOCUMENTS
// ============================================================

export async function extractFromDocuments(
  imageUrls: string[],
  catalog: TemplateFieldRef[],
  fields: any[],
  customPrompt: string | null,
  docTypes: string[],
) {
  if (imageUrls.length === 0) return { extractedFields: [], signerName: null };

  const hasOnlyIdentityDocs = docTypes.every((t) => t === "rg_cnh");
  const BLOCKED_FROM_ID = new Set([
    "ESTADOCIVIL",
    "PROFISSAO",
    "ENDERECOCOMPLETO",
    "ENDERECO",
    "CEP",
    "CIDADE",
    "MUNICIPIO",
    "UF",
    "ESTADO",
    "BAIRRO",
    "RUA",
    "LOGRADOURO",
    "NUMERO",
    "COMPLEMENTO",
    "DATAASSINATURA",
    "LOCALASSINATURA",
  ]);

  const defaultPrompt =
    `Você é um especialista em OCR de documentos brasileiros. Extraia os dados do TITULAR.
REGRAS:
- Em RG: NOME está em letras grandes. FILIAÇÃO são os pais (NÃO confunda). NATURALIDADE = local de nascimento.
- Em CNH: NOME está no campo "Nome". LOCAL DE NASCIMENTO = naturalidade.
- NUNCA invente dados inexistentes (endereço, estado civil, profissão, data de assinatura NÃO existem em RG/CNH).
- Formate CPF como XXX.XXX.XXX-XX e datas como DD/MM/AAAA.
- Se não conseguir ler com certeza, deixe em branco.`;

  const base64Urls = await Promise.all(
    imageUrls.map((u) => urlToBase64DataUri(u)),
  );

  try {
    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `${customPrompt || defaultPrompt}\n\nCAMPOS: ${
            catalog.map((f) => `${f.variable} (${f.label})`).join(", ")
          }\n\nJÁ PREENCHIDOS: ${
            fields.filter((f) => f.para).map((f) => `${f.de}: ${f.para}`).join(
              ", ",
            ) || "(nenhum)"
          }`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extraia:" },
            ...base64Urls.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ],
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "extracted_document_data",
          description: "Dados extraídos",
          parameters: {
            type: "object",
            properties: {
              extracted_fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    de: { type: "string" },
                    para: { type: "string" },
                  },
                  required: ["de", "para"],
                },
              },
              signer_name: { type: "string" },
            },
            required: ["extracted_fields"],
          },
        },
      }],
      tool_choice: {
        type: "function",
        function: { name: "extracted_document_data" },
      },
      temperature: 0.1,
    });

    const tc = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc?.function?.arguments) {
      return { extractedFields: [], signerName: null };
    }

    const data = JSON.parse(tc.function.arguments);
    const validFields: { variable: string; value: string }[] = [];

    for (const field of (data.extracted_fields || [])) {
      const normalized = normalizeIncomingField(field, catalog);
      if (!normalized) continue;
      const normKey = normalizeFieldKey(normalized.variable);
      if (hasOnlyIdentityDocs && BLOCKED_FROM_ID.has(normKey)) {
        console.log(
          `BLOCKED hallucinated field from ID doc: ${normalized.variable}`,
        );
        continue;
      }
      validFields.push(normalized);
    }

    return {
      extractedFields: validFields,
      signerName: data.signer_name || null,
    };
  } catch (e) {
    console.error("OCR extraction error:", e);
    return { extractedFields: [], signerName: null };
  }
}

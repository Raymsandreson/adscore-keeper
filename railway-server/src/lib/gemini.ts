/**
 * Shared Google Gemini AI helper — ported from supabase/functions/_shared/gemini.ts
 * Uses GOOGLE_AI_API_KEY for direct API calls.
 */

const MODEL_MAP: Record<string, string> = {
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
  "google/gemini-3-flash-preview": "gemini-2.5-flash",
  "google/gemini-3.1-pro-preview": "gemini-2.5-pro",
  "google/gemini-3.1-flash-image-preview": "gemini-2.5-flash",
};

function cleanParametersForGoogle(params: any): any {
  if (!params || typeof params !== "object") return params;
  const cleaned: any = { ...params };

  // Google não aceita type ["string","null"] — pega o primeiro tipo não-nulo.
  if (Array.isArray(cleaned.type)) {
    cleaned.type = cleaned.type.find((t: string) => t !== "null") || "string";
  }
  delete cleaned.nullable;
  delete cleaned.additionalProperties;

  // Gemini recusa enum com valor vazio "" → 400 "enum[...]: cannot be empty".
  // Remove vazios; se o enum ficar sem valores, descarta o enum (mantém só o type).
  if (Array.isArray(cleaned.enum)) {
    const vals = cleaned.enum.filter((v: any) => (typeof v === "string" ? v.trim() !== "" : v != null));
    if (vals.length > 0) cleaned.enum = vals;
    else delete cleaned.enum;
  }

  if (cleaned.properties && typeof cleaned.properties === "object") {
    const newProps: any = {};
    for (const [key, val] of Object.entries(cleaned.properties)) {
      newProps[key] = cleanParametersForGoogle(val);
    }
    cleaned.properties = newProps;
  }
  if (cleaned.items) cleaned.items = cleanParametersForGoogle(cleaned.items);
  return cleaned;
}

function convertContentPart(p: any): any {
  if (p.type === "text") return { text: p.text };
  if (p.type === "image_url") {
    const url = p.image_url?.url || p.image_url;
    if (typeof url === "string" && url.startsWith("data:")) {
      const commaIdx = url.indexOf(",");
      const header = url.substring(0, commaIdx);
      const data = url.substring(commaIdx + 1);
      const mimeType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
      return { inlineData: { mimeType, data } };
    }
    return { text: `[imagem: ${url}]` };
  }
  if (p.type === "input_audio") {
    return {
      inlineData: {
        mimeType: `audio/${p.input_audio.format || "wav"}`,
        data: p.input_audio.data,
      },
    };
  }
  return { text: JSON.stringify(p) };
}

export interface GeminiCallOptions {
  model?: string;
  messages: any[];
  tools?: any[];
  tool_choice?: any;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export async function callGemini(options: GeminiCallOptions): Promise<Response> {
  const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
  if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

  const googleModel = MODEL_MAP[options.model || "google/gemini-2.5-flash"] || "gemini-2.5-flash";

  let systemText = "";
  const otherMessages: any[] = [];
  for (const m of options.messages) {
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      systemText += (systemText ? "\n\n" : "") + text;
    } else {
      otherMessages.push(m);
    }
  }

  const contents = otherMessages.map((m) => {
    const role = m.role === "assistant" ? "model" : "user";
    if (typeof m.content === "string") return { role, parts: [{ text: m.content }] };
    if (Array.isArray(m.content)) return { role, parts: m.content.map(convertContentPart) };
    return { role, parts: [{ text: String(m.content || "") }] };
  });

  const body: any = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

  const genConfig: any = {};
  if (options.max_tokens) genConfig.maxOutputTokens = options.max_tokens;
  if (options.temperature !== undefined) genConfig.temperature = options.temperature;
  // Gemini 2.5 "thinking" consome tokens do maxOutputTokens antes de gerar texto,
  // o que causa truncamento (ex.: resposta cortada no meio da palavra). Para chamadas
  // de texto puro (sem tools), desabilita o thinking pra todo o orçamento ir pro texto.
  // Callers que precisam de reasoning podem passar `thinking_budget` explicitamente.
  const thinkingBudget = (options as any).thinking_budget;
  if (typeof thinkingBudget === "number") {
    genConfig.thinkingConfig = { thinkingBudget };
  } else if (!options.tools?.length) {
    genConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;

  if (options.tools?.length) {
    body.tools = [{
      functionDeclarations: options.tools
        .filter((t: any) => t.type === "function")
        .map((t: any) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: cleanParametersForGoogle(t.function.parameters),
        })),
    }];
    if (options.tool_choice?.function?.name) {
      body.toolConfig = {
        functionCallingConfig: { mode: "ANY", allowedFunctionNames: [options.tool_choice.function.name] },
      };
    }
  }

  const action = options.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:${action}`;
  const keySeparator = action.includes("?") ? "&" : "?";

  return fetch(`${endpoint}${keySeparator}key=${encodeURIComponent(GOOGLE_AI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

export function parseGeminiResponse(data: any): any {
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    const blockReason = candidate?.finishReason;
    if (blockReason === "SAFETY") return { choices: [{ message: { content: "Conteúdo bloqueado por filtros de segurança." } }] };
    return { choices: [{ message: { content: "" } }] };
  }

  const parts = candidate.content.parts;
  const fnCall = parts.find((p: any) => p.functionCall);
  if (fnCall) {
    return {
      choices: [{
        message: {
          tool_calls: [{ function: { name: fnCall.functionCall.name, arguments: JSON.stringify(fnCall.functionCall.args || {}) } }],
        },
      }],
    };
  }

  const text = parts.map((p: any) => p.text || "").join("");
  return { choices: [{ message: { content: text } }] };
}

export async function geminiChat(options: GeminiCallOptions): Promise<any> {
  const response = await callGemini({ ...options, stream: false });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API error:", response.status, errText);
    // Propaga o motivo real do Google (ex.: "enum[0]: cannot be empty") em vez de
    // só o status — sem isso o chamador/usuário fica com um "400" opaco.
    const detail = errText.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new Error(`Gemini API error: ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  const data = await response.json();
  return parseGeminiResponse(data);
}

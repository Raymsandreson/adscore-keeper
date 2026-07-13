/**
 * Shared AI helper for all edge functions.
 * Default path converts OpenAI-compatible format to the Google Generative
 * Language API. Models prefixed with `anthropic/` (or `claude-`) are routed
 * to the Anthropic Messages API instead, so Gemini and Claude run side by side
 * per-agent — switching an agent is just changing its stored `model` string.
 * Uses GOOGLE_AI_API_KEY / ANTHROPIC_API_KEY for direct API calls.
 */

import { callAnthropic, parseAnthropicResponse } from "./anthropic.ts";

/** True when the model string should be routed to Anthropic instead of Google. */
function isAnthropicModel(model?: string): boolean {
  const m = model || "";
  return m.startsWith("anthropic/") || m.startsWith("claude-") || m.startsWith("claude/");
}

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

  // Google doesn't support ["string", "null"] type arrays — pick the non-null type
  if (Array.isArray(cleaned.type)) {
    cleaned.type = cleaned.type.find((t: string) => t !== "null") || "string";
  }
  // Remove 'nullable' as Google uses a different approach
  delete cleaned.nullable;
  // Remove additionalProperties — Google Gemini rejects it
  delete cleaned.additionalProperties;

  // Gemini rejects empty-string "" enum values → 400 "enum[...]: cannot be empty".
  // Drop empties; if the enum ends up empty, remove it entirely (keep just the type).
  if (Array.isArray(cleaned.enum)) {
    const vals = cleaned.enum.filter((v: any) => (typeof v === "string" ? v.trim() !== "" : v != null));
    if (vals.length > 0) cleaned.enum = vals;
    else delete cleaned.enum;
  }

  // Recursively clean nested objects and array items
  if (cleaned.properties && typeof cleaned.properties === "object") {
    const newProps: any = {};
    for (const [key, val] of Object.entries(cleaned.properties)) {
      newProps[key] = cleanParametersForGoogle(val);
    }
    cleaned.properties = newProps;
  }
  if (cleaned.items) {
    cleaned.items = cleanParametersForGoogle(cleaned.items);
  }
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
    // External URL — Google API supports fileData for some URLs but not all
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

/**
 * Call Google Gemini API with OpenAI-compatible input format.
 * Returns the raw fetch Response.
 */
export async function callGemini(options: GeminiCallOptions): Promise<Response> {
  if (isAnthropicModel(options.model)) return callAnthropic(options);

  const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");

  const googleModel = MODEL_MAP[options.model || "google/gemini-2.5-flash"] || "gemini-2.5-flash";

  // Separate system messages
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

  // Convert messages to Google format
  const contents = otherMessages.map((m) => {
    const role = m.role === "assistant" ? "model" : "user";
    if (typeof m.content === "string") {
      return { role, parts: [{ text: m.content }] };
    }
    if (Array.isArray(m.content)) {
      const parts = m.content.map(convertContentPart);
      return { role, parts };
    }
    return { role, parts: [{ text: String(m.content || "") }] };
  });

  // Build request body
  const body: any = { contents };

  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const genConfig: any = {};
  if (options.max_tokens) genConfig.maxOutputTokens = options.max_tokens;
  if (options.temperature !== undefined) genConfig.temperature = options.temperature;
  // Gemini 2.5 "thinking" consome tokens do maxOutputTokens antes de gerar texto,
  // o que causa truncamento (ex.: resposta cortada no meio da palavra). Para chamadas
  // de texto puro (sem tools), desabilita o thinking pra todo o orçamento ir pro texto.
  const thinkingBudget = (options as any).thinking_budget;
  // gemini-2.5-pro só funciona em thinking mode (não aceita budget 0).
  const isProModel = /pro/i.test(googleModel);
  if (typeof thinkingBudget === "number") {
    // Pro não aceita 0; se vier 0, usa o default do modelo (omite o campo).
    if (!(isProModel && thinkingBudget === 0)) {
      genConfig.thinkingConfig = { thinkingBudget };
    }
  } else if (!options.tools?.length && !isProModel) {
    genConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;

  // Convert tools
  if (options.tools?.length) {
    body.tools = [
      {
        functionDeclarations: options.tools
          .filter((t: any) => t.type === "function")
          .map((t: any) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: cleanParametersForGoogle(t.function.parameters),
          })),
      },
    ];
    if (options.tool_choice?.function?.name) {
      body.toolConfig = {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [options.tool_choice.function.name],
        },
      };
    }
  }

  const action = options.stream
    ? "streamGenerateContent?alt=sse"
    : "generateContent";

  const fetchOptions: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (options.signal) fetchOptions.signal = options.signal;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:${action}`;
  const keySeparator = action.includes("?") ? "&" : "?";

  return fetch(
    `${endpoint}${keySeparator}key=${encodeURIComponent(GOOGLE_AI_API_KEY)}`,
    fetchOptions
  );
}

/**
 * Parse a non-streaming Gemini response into OpenAI-compatible format.
 */
export function parseGeminiResponse(data: any): any {
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    // Check for blocked content or errors
    const blockReason = candidate?.finishReason;
    if (blockReason === "SAFETY") {
      return { choices: [{ message: { content: "Conteúdo bloqueado por filtros de segurança." } }] };
    }
    return { choices: [{ message: { content: "" } }] };
  }

  const parts = candidate.content.parts;

  // Check for function call
  const fnCall = parts.find((p: any) => p.functionCall);
  if (fnCall) {
    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: fnCall.functionCall.name,
                  arguments: JSON.stringify(fnCall.functionCall.args || {}),
                },
              },
            ],
          },
        },
      ],
    };
  }

  // Plain text
  const text = parts.map((p: any) => p.text || "").join("");
  return { choices: [{ message: { content: text } }] };
}

/**
 * High-level helper: call Gemini and return parsed OpenAI-compatible result.
 * Throws on HTTP errors.
 */
export async function geminiChat(options: GeminiCallOptions): Promise<any> {
  const isAnthropic = isAnthropicModel(options.model);
  const response = await callGemini({ ...options, stream: false });

  if (!response.ok) {
    const errText = await response.text();
    const provider = isAnthropic ? "Anthropic" : "Gemini";
    console.error(`${provider} API error:`, response.status, errText);
    // Propaga o motivo real do provider (ex.: "enum[0]: cannot be empty") em vez de
    // só o status — sem isso o chamador/usuário fica com um "400" opaco.
    const detail = errText.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new GeminiError(`${provider} API error: ${response.status}${detail ? ` — ${detail}` : ""}`, response.status);
  }

  const data = await response.json();
  return isAnthropic ? parseAnthropicResponse(data) : parseGeminiResponse(data);
}

/** Provider-agnostic alias for geminiChat — routes by the model's prefix. */
export const aiChat = geminiChat;

/**
 * Transform a Google SSE stream into an OpenAI-compatible SSE stream.
 * This allows existing client-side SSE parsers to work unchanged.
 */
export function transformGeminiStream(googleStream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = googleStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(jsonStr);
              // Auto-detect provider shape: Gemini sends `candidates`,
              // Anthropic sends content_block_delta events with text_delta.
              const text =
                parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
                (parsed.type === "content_block_delta" ? (parsed.delta?.text || "") : "") ||
                "";
              if (text) {
                const openAiChunk = {
                  choices: [{ delta: { content: text } }],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`)
                );
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (e) {
        console.error("Stream transform error:", e);
        controller.error(e);
      }
    },
  });
}

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

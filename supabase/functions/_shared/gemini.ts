/**
 * Shared Google Gemini AI helper for all edge functions.
 * Converts OpenAI-compatible format to Google Generative Language API format.
 * Uses GOOGLE_AI_API_KEY for direct API calls (cost savings).
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
  const cleaned = { ...params };
  if (cleaned.properties) {
    const newProps: any = {};
    for (const [key, val] of Object.entries(cleaned.properties)) {
      const prop = { ...(val as any) };
      // Google doesn't support ["string", "null"] type arrays
      if (Array.isArray(prop.type)) {
        prop.type = prop.type.find((t: string) => t !== "null") || "string";
      }
      // Remove 'nullable' as Google uses different approach
      delete prop.nullable;
      // Recursively clean nested objects
      if (prop.properties) {
        const nested = cleanParametersForGoogle(prop);
        Object.assign(prop, nested);
      }
      if (prop.items) {
        prop.items = cleanParametersForGoogle(prop.items);
      }
      newProps[key] = prop;
    }
    cleaned.properties = newProps;
  }
  // Remove additionalProperties — Google Gemini rejects it
  delete cleaned.additionalProperties;
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
  const response = await callGemini({ ...options, stream: false });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API error:", response.status, errText);
    throw new GeminiError(`Gemini API error: ${response.status}`, response.status);
  }

  const data = await response.json();
  return parseGeminiResponse(data);
}

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
              const text =
                parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
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

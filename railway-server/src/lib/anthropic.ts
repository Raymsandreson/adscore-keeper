/**
 * Shared Anthropic (Claude) AI helper — ported from supabase/functions/_shared/anthropic.ts
 * Converts the OpenAI-compatible format used across the codebase to the
 * Anthropic Messages API and parses the response back into OpenAI shape.
 * Uses ANTHROPIC_API_KEY for direct API calls.
 */

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 8192;

const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  "anthropic/claude-haiku-4-5": "claude-haiku-4-5",
  "anthropic/claude-sonnet-4-6": "claude-sonnet-4-6",
  "anthropic/claude-sonnet-5": "claude-sonnet-5",
  "anthropic/claude-opus-4-8": "claude-opus-4-8",
  "anthropic/claude-opus-5": "claude-opus-5",
  "anthropic/claude-fable-5": "claude-fable-5",
};

/**
 * Modelos que REJEITAM parâmetros de sampling (temperature/top_p/top_k) com
 * HTTP 400: família Opus 5/4.8/4.7, Sonnet 5 e Fable/Mythos. Quem chama manda
 * temperature achando que é inofensivo — aqui o parâmetro é filtrado em vez de
 * derrubar a chamada.
 */
const NO_SAMPLING = /^claude-(opus-(5|4-8|4-7)|sonnet-5|fable|mythos)/;

/** Resolve a provider-prefixed model string into a real Anthropic model ID. */
export function resolveAnthropicModel(model?: string): string {
  if (!model) return DEFAULT_MODEL;
  if (ANTHROPIC_MODEL_MAP[model]) return ANTHROPIC_MODEL_MAP[model];
  return model.replace(/^anthropic\//, "").replace(/^claude\//, "") || DEFAULT_MODEL;
}

export interface AnthropicCallOptions {
  model?: string;
  messages: any[];
  tools?: any[];
  tool_choice?: any;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  /** output_config.effort: low|medium|high|xhigh|max. Profundidade do raciocínio — e do custo. */
  effort?: string;
  /** Marca o system prompt com cache_control ephemeral (prompt grande reenviado várias vezes). */
  cache_system?: boolean;
}

function convertContentPart(p: any): any {
  if (p.type === "text") return { type: "text", text: p.text };
  if (p.type === "image_url") {
    const url = p.image_url?.url || p.image_url;
    if (typeof url === "string" && url.startsWith("data:")) {
      const commaIdx = url.indexOf(",");
      const header = url.substring(0, commaIdx);
      const data = url.substring(commaIdx + 1);
      const mediaType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
      return { type: "image", source: { type: "base64", media_type: mediaType, data } };
    }
    return { type: "image", source: { type: "url", url } };
  }
  if (p.type === "input_audio") {
    throw new AnthropicError("Anthropic não aceita áudio; mantenha o agente no provider google/* para STT", 400);
  }
  return { type: "text", text: typeof p === "string" ? p : JSON.stringify(p) };
}

export async function callAnthropic(options: AnthropicCallOptions): Promise<Response> {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) throw new AnthropicError("ANTHROPIC_API_KEY not configured", 500);

  const model = resolveAnthropicModel(options.model);

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

  const messages = otherMessages.map((m) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (typeof m.content === "string") return { role, content: m.content };
    if (Array.isArray(m.content)) return { role, content: m.content.map(convertContentPart) };
    return { role, content: String(m.content || "") };
  });

  const body: any = {
    model,
    max_tokens: options.max_tokens || DEFAULT_MAX_TOKENS,
    messages,
  };
  if (systemText) {
    // cache_system: prompt grande e repetido (ex.: o catálogo de schema do
    // relatório, reenviado a cada passo da mesma pergunta). Leitura do cache
    // custa ~10% do token normal; a primeira gravação custa ~1,25x.
    body.system = options.cache_system
      ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
      : systemText;
  }
  // Sampling foi removido nos modelos novos (400 se mandar) — só vai pra quem aceita.
  if (options.temperature !== undefined && !NO_SAMPLING.test(model)) body.temperature = options.temperature;
  if (options.effort) body.output_config = { effort: options.effort };
  if (options.stream) body.stream = true;

  if (options.tools?.length) {
    body.tools = options.tools
      .filter((t: any) => t.type === "function")
      .map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object", properties: {} },
      }));
    if (options.tool_choice?.function?.name) {
      body.tool_choice = { type: "tool", name: options.tool_choice.function.name };
    } else {
      body.tool_choice = { type: "auto" };
    }
  }

  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

export function parseAnthropicResponse(data: any): any {
  const blocks = data?.content;
  if (!Array.isArray(blocks)) return { choices: [{ message: { content: "" } }] };

  const toolUse = blocks.find((b: any) => b.type === "tool_use");
  if (toolUse) {
    return {
      choices: [{
        message: {
          tool_calls: [{ function: { name: toolUse.name, arguments: JSON.stringify(toolUse.input || {}) } }],
        },
      }],
    };
  }

  const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text || "").join("");
  return { choices: [{ message: { content: text } }] };
}

export async function anthropicChat(options: AnthropicCallOptions): Promise<any> {
  const response = await callAnthropic({ ...options, stream: false });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error:", response.status, errText);
    throw new AnthropicError(`Anthropic API error: ${response.status} — ${errText.slice(0, 300)}`, response.status);
  }
  const data = await response.json();
  return parseAnthropicResponse(data);
}

export class AnthropicError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

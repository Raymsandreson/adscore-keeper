// Cópia fiel do _shared/gemini.ts que já está deployado junto da auto-enrich-lead
// no Externo (extraído do bundle v19). Necessário pro deploy da função completa.
const MODEL_MAP = {
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
  "google/gemini-3-flash-preview": "gemini-2.5-flash",
  "google/gemini-3.1-pro-preview": "gemini-2.5-pro",
  "google/gemini-3.1-flash-image-preview": "gemini-2.5-flash"
};
function cleanParametersForGoogle(params) {
  if (!params || typeof params !== "object") return params;
  const cleaned = {
    ...params
  };
  if (cleaned.properties) {
    const newProps = {};
    for (const [key, val] of Object.entries(cleaned.properties)){
      const prop = {
        ...val
      };
      if (Array.isArray(prop.type)) prop.type = prop.type.find((t)=>t !== "null") || "string";
      delete prop.nullable;
      if (prop.properties) {
        const nested = cleanParametersForGoogle(prop);
        Object.assign(prop, nested);
      }
      if (prop.items) prop.items = cleanParametersForGoogle(prop.items);
      newProps[key] = prop;
    }
    cleaned.properties = newProps;
  }
  delete cleaned.additionalProperties;
  return cleaned;
}
function convertContentPart(p) {
  if (p.type === "text") return {
    text: p.text
  };
  if (p.type === "image_url") {
    const url = p.image_url?.url || p.image_url;
    if (typeof url === "string" && url.startsWith("data:")) {
      const commaIdx = url.indexOf(",");
      const header = url.substring(0, commaIdx);
      const data = url.substring(commaIdx + 1);
      const mimeType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
      return {
        inlineData: {
          mimeType,
          data
        }
      };
    }
    return {
      text: `[imagem: ${url}]`
    };
  }
  if (p.type === "input_audio") return {
    inlineData: {
      mimeType: `audio/${p.input_audio.format || "wav"}`,
      data: p.input_audio.data
    }
  };
  return {
    text: JSON.stringify(p)
  };
}
export async function callGemini(options) {
  const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY not configured");
  const googleModel = MODEL_MAP[options.model || "google/gemini-2.5-flash"] || "gemini-2.5-flash";
  let systemText = "";
  const otherMessages = [];
  for (const m of options.messages){
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      systemText += (systemText ? "\n\n" : "") + text;
    } else otherMessages.push(m);
  }
  const contents = otherMessages.map((m)=>{
    const role = m.role === "assistant" ? "model" : "user";
    if (typeof m.content === "string") return {
      role,
      parts: [
        {
          text: m.content
        }
      ]
    };
    if (Array.isArray(m.content)) return {
      role,
      parts: m.content.map(convertContentPart)
    };
    return {
      role,
      parts: [
        {
          text: String(m.content || "")
        }
      ]
    };
  });
  const body = {
    contents
  };
  if (systemText) body.systemInstruction = {
    parts: [
      {
        text: systemText
      }
    ]
  };
  const genConfig = {};
  if (options.max_tokens) genConfig.maxOutputTokens = options.max_tokens;
  if (options.temperature !== undefined) genConfig.temperature = options.temperature;
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;
  if (options.tools?.length) {
    body.tools = [
      {
        functionDeclarations: options.tools.filter((t)=>t.type === "function").map((t)=>({
            name: t.function.name,
            description: t.function.description,
            parameters: cleanParametersForGoogle(t.function.parameters)
          }))
      }
    ];
    if (options.tool_choice?.function?.name) body.toolConfig = {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [
          options.tool_choice.function.name
        ]
      }
    };
  }
  const action = options.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const fetchOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
  if (options.signal) fetchOptions.signal = options.signal;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:${action}`;
  const keySeparator = action.includes("?") ? "&" : "?";
  return fetch(`${endpoint}${keySeparator}key=${encodeURIComponent(GOOGLE_AI_API_KEY)}`, fetchOptions);
}
export function parseGeminiResponse(data) {
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    if (candidate?.finishReason === "SAFETY") return {
      choices: [
        {
          message: {
            content: "Conteúdo bloqueado."
          }
        }
      ]
    };
    return {
      choices: [
        {
          message: {
            content: ""
          }
        }
      ]
    };
  }
  const parts = candidate.content.parts;
  const fnCall = parts.find((p)=>p.functionCall);
  if (fnCall) return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                name: fnCall.functionCall.name,
                arguments: JSON.stringify(fnCall.functionCall.args || {})
              }
            }
          ]
        }
      }
    ]
  };
  return {
    choices: [
      {
        message: {
          content: parts.map((p)=>p.text || "").join("")
        }
      }
    ]
  };
}
export async function geminiChat(options) {
  const response = await callGemini({
    ...options,
    stream: false
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API error:", response.status, errText);
    throw new GeminiError(`Gemini API error: ${response.status}`, response.status);
  }
  const data = await response.json();
  return parseGeminiResponse(data);
}
export function transformGeminiStream(googleStream) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new ReadableStream({
    async start (controller) {
      const reader = googleStream.getReader();
      try {
        while(true){
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            break;
          }
          buffer += decoder.decode(value, {
            stream: true
          });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines){
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      content: text
                    }
                  }
                ]
              })}\n\n`));
            } catch  {}
          }
        }
      } catch (e) {
        controller.error(e);
      }
    }
  });
}
export class GeminiError extends Error {
  status;
  constructor(message, status){
    super(message);
    this.status = status;
  }
}

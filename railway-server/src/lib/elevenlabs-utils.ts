/**
 * ElevenLabs shared utilities — credit check, retry wrapper
 * Ported from supabase/functions/_shared/elevenlabs-utils.ts
 */

export interface ElevenLabsSubscription {
  character_count: number;
  character_limit: number;
  remaining: number;
  has_credits: boolean;
}

export async function checkElevenLabsCredits(apiKey: string): Promise<ElevenLabsSubscription> {
  const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
    headers: { "xi-api-key": apiKey },
  });

  if (!res.ok) {
    console.error("ElevenLabs subscription check failed:", res.status);
    return { character_count: 0, character_limit: 999999, remaining: 999999, has_credits: true };
  }

  const data = await res.json();
  const used = data.character_count ?? 0;
  const limit = data.character_limit ?? 0;
  const remaining = Math.max(0, limit - used);

  console.log(`ElevenLabs credits: ${used}/${limit} used, ${remaining} remaining`);

  return { character_count: used, character_limit: limit, remaining, has_credits: remaining > 0 };
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
  baseDelay = 1000,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;

    const status = res.status;
    const isRetryable = status === 429 || status >= 500;

    if (!isRetryable || attempt === maxRetries) return res;

    const delay = baseDelay * Math.pow(2, attempt);
    console.warn(`ElevenLabs retry ${attempt + 1}/${maxRetries} after ${status}, waiting ${delay}ms`);
    await new Promise(r => setTimeout(r, delay));
  }

  return await fetch(url, options);
}

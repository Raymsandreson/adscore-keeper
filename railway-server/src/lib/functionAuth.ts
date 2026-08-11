// Autenticação de /functions/* — padrão copiado do celcoin-data-gateway do
// Quitepay (`authorize()`), adaptado ao fato de que aqui o JWT do usuário é
// emitido pelo Cloud (gliigkupoebmlbwyvijp) e o verificador já existia no repo,
// em onboarding-checkpoint-execute.ts.
//
// Três credenciais são aceitas, nesta ordem:
//   1. x-internal-key  = RAILWAY_INTERNAL_KEY  máquina-a-máquina (edges, cron, auto-chamadas)
//   2. x-api-key       = RAILWAY_API_KEY       legado — é o que as edges já mandam hoje
//   3. Authorization   = Bearer <JWT do Cloud> navegador logado; o functionRouter
//                                              do front já injeta a sessão sozinho
//
// MODO OBSERVAÇÃO: enquanto RAILWAY_AUTH_ENFORCE não estiver ligado, uma chamada
// sem credencial é REGISTRADA e SEGUE. É de propósito. Nenhum secret está setado
// hoje (verificado 11/08/2026: curl sem header devolve 200, e o Externo não tem
// secret RAILWAY_*), então ligar a rejeição às cegas derrubaria de uma vez o
// envio de WhatsApp, a fila de ligações e a gestão de participantes de grupo.
// O log diz quem chamaria sem credencial; com um dia de log dá pra ligar o
// enforce sabendo o que quebra. Desligar de novo é uma variável de ambiente.
import crypto from 'node:crypto';
import type { Request } from 'express';

const CLOUD_FUNCTIONS_URL =
  process.env.CLOUD_FUNCTIONS_URL || process.env.SUPABASE_URL || 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = process.env.CLOUD_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

export const AUTH_ENFORCE = /^(1|true|on|yes)$/i.test(process.env.RAILWAY_AUTH_ENFORCE || '');

export interface AuthVerdict {
  ok: boolean;
  via: 'internal_key' | 'api_key' | 'cloud_jwt' | null;
  reason?: string;
  userId?: string;
  tokenSuffix?: string;
}

// Comparação de tamanho fixo: evita que o tempo de resposta entregue um prefixo
// correto da chave. Só vale se os buffers tiverem o mesmo tamanho, daí o guard.
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Verificar JWT custa um roundtrip ao Cloud. Sem cache, toda chamada de função
// paga isso — e há handlers chamados em rajada. 60s é curto o bastante para uma
// sessão revogada não sobreviver de forma relevante, e longo o bastante para
// tirar o Cloud do caminho quente.
const JWT_TTL_MS = 60_000;
const jwtCache = new Map<string, { userId: string; expiresAt: number }>();

function cacheKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Valida o JWT do Cloud em /auth/v1/user. Mesma lógica de onboarding-checkpoint-execute. */
export async function verifyCloudJwt(authHeader: string | undefined): Promise<AuthVerdict> {
  if (!authHeader) return { ok: false, via: null, reason: 'missing_header' };
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, via: null, reason: 'malformed_bearer' };

  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, via: null, reason: 'empty_token' };
  const tokenSuffix = `…${token.slice(-6)}`;
  // A anon key é pública e vive no bundle do front: aceitá-la como identidade
  // seria o mesmo que não ter porta. Mesmo guard do onboarding-checkpoint-execute.
  if (CLOUD_ANON_KEY && token === CLOUD_ANON_KEY) return { ok: false, via: null, reason: 'anon_key_used', tokenSuffix };

  const hit = jwtCache.get(cacheKey(token));
  if (hit && Date.now() < hit.expiresAt) return { ok: true, via: 'cloud_jwt', userId: hit.userId, tokenSuffix };

  try {
    const r = await fetch(`${CLOUD_FUNCTIONS_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: CLOUD_ANON_KEY },
    });
    if (!r.ok) return { ok: false, via: null, reason: `user_endpoint_${r.status}`, tokenSuffix };
    const u: any = await r.json().catch(() => null);
    if (!u?.id) return { ok: false, via: null, reason: 'no_user_id', tokenSuffix };

    jwtCache.set(cacheKey(token), { userId: u.id, expiresAt: Date.now() + JWT_TTL_MS });
    return { ok: true, via: 'cloud_jwt', userId: u.id, tokenSuffix };
  } catch (e) {
    return { ok: false, via: null, reason: 'fetch_exception', tokenSuffix };
  }
}

// Placar do modo observação. O log do Railway é a fonte rica, mas quem precisa
// decidir se liga o enforce nem sempre tem acesso a ele — e sem um número
// visível de fora a decisão vira palpite. Mantido em memória (zera a cada
// deploy) e exposto em /health.
const seen = { total: 0, internal_key: 0, api_key: 0, cloud_jwt: 0, missing: 0 };
const missingByFn = new Map<string, number>();
const MISSING_FN_CAP = 40; // teto: o mapa é alimentado por path de request

export function recordAuth(verdict: AuthVerdict, fn: string): void {
  seen.total += 1;
  if (verdict.ok && verdict.via) {
    seen[verdict.via] += 1;
    return;
  }
  seen.missing += 1;
  const key = fn || '(sem path)';
  if (missingByFn.has(key)) missingByFn.set(key, missingByFn.get(key)! + 1);
  else if (missingByFn.size < MISSING_FN_CAP) missingByFn.set(key, 1);
}

export function authStats() {
  return {
    ...seen,
    // Quem chamaria sem credencial, do mais frequente pro menos: é esta lista
    // que precisa estar vazia (ou só com chamadores que você reconhece e vai
    // credenciar) antes de ligar o RAILWAY_AUTH_ENFORCE.
    missing_por_funcao: Object.fromEntries([...missingByFn.entries()].sort((a, b) => b[1] - a[1])),
  };
}

// Token efêmero deste processo. As chamadas que o servidor faz a si mesmo (os
// crons internos, que batem em http://127.0.0.1:PORT/functions/...) se
// autenticam com ele e portanto não dependem de nenhum secret estar configurado.
// Sorteado a cada boot; nunca sai da máquina.
export const LOOPBACK_TOKEN = crypto.randomUUID();

export async function authorizeFunctionRequest(req: Request): Promise<AuthVerdict> {
  if (safeEqual(String(req.headers['x-internal-key'] || ''), LOOPBACK_TOKEN)) {
    return { ok: true, via: 'internal_key' };
  }

  const internalExpected = process.env.RAILWAY_INTERNAL_KEY || '';
  const internalGiven = String(req.headers['x-internal-key'] || '');
  if (internalExpected && safeEqual(internalGiven, internalExpected)) return { ok: true, via: 'internal_key' };

  const apiExpected = process.env.RAILWAY_API_KEY || '';
  const apiGiven = String(req.headers['x-api-key'] || '');
  if (apiExpected && safeEqual(apiGiven, apiExpected)) return { ok: true, via: 'api_key' };

  // Se nenhuma chave está configurada, um x-api-key vazio não pode valer como
  // credencial — era exatamente esse o buraco: `if (API_KEY)` pulava a guarda toda.
  return verifyCloudJwt(req.headers['authorization'] as string | undefined);
}

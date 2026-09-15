// Cliente único da API Data Stone (enriquecimento cadastral BR).
// Toda chamada à Data Stone passa por aqui — o motivo é que esta API tem três
// armadilhas que só se resolvem num ponto só:
//
//   1. WHITELIST DE IP. Fora da lista, a resposta é 401 — igual ao 401 de chave
//      errada. A mensagem do IP não autorizado carrega o IP de origem, e é o
//      único jeito de descobrir por qual IP o Railway sai. Daí `ipDaMensagem`.
//   2. RATE LIMIT DE 100/dia (compartilhado com o painel) e, ao estourar,
//      BLOQUEIO DE 24 HORAS. Repetir depois de um 429 não é retry, é prolongar
//      o bloqueio: quem chama tem que PARAR. Daí a falha `rate_limit` separada.
//   3. Busca por telefone/nome (`/persons/search/`) NÃO tem carência de 24h —
//      repetir a mesma consulta paga de novo. Quem chama precisa ter cache
//      próprio; este cliente não inventa um.
//
// Nada de dado pessoal sai daqui para log: CPF e telefone são mascarados.
const BASE_URL = 'https://api.datastone.com.br/v1';
const TIMEOUT_MS = 30_000;

export type DatastoneFalha =
  | 'sem_token' // DATASTONE_TOKEN não chegou ao serviço
  | 'chave_ou_ip' // 401 — chave inválida OU IP fora da whitelist
  | 'sem_acesso' // 406 — chave válida, API não liberada pelo admin da conta
  | 'sem_credito' // 402
  | 'rate_limit' // 429 — bloqueio de 24h; PARAR, não repetir
  | 'requisicao_invalida' // 400
  | 'rede' // timeout/DNS/conexão
  | 'http'; // qualquer outro status

export interface DatastoneResposta<T = unknown> {
  ok: boolean;
  status: number; // 0 quando nem chegou a responder
  dados: T | null;
  falha?: DatastoneFalha;
  motivo?: string;
  /** IP que a Data Stone viu, quando ela conta (mensagem de 401 de whitelist). */
  ip?: string | null;
}

export function temToken(): boolean {
  return !!(process.env.DATASTONE_TOKEN || '').trim();
}

/** `123.456.789-01` -> `***.***.***-01`. Nunca logar CPF inteiro. */
export function mascararCpf(cpf?: string | null): string {
  const d = (cpf || '').replace(/\D/g, '');
  if (d.length < 4) return '***';
  return `***.***.***-${d.slice(-2)}`;
}

/** `5586999998888` -> `55869****8888`. */
export function mascararTelefone(tel?: string | null): string {
  const d = (tel || '').replace(/\D/g, '');
  if (d.length < 8) return '***';
  return `${d.slice(0, 5)}****${d.slice(-4)}`;
}

/**
 * Extrai o IP da mensagem de erro da Data Stone. O texto é
 * "O IP 192.168.1.1 não está na lista de IPs permitidos" — é a única via
 * para descobrir o IP de saída do serviço sem depender do painel do Railway.
 */
export function ipDaMensagem(corpo: unknown): string | null {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? '');
  const v4 = texto.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (v4) return v4[0];
  const v6 = texto.match(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i);
  return v6 ? v6[0] : null;
}

function classificar(status: number): { falha: DatastoneFalha; motivo: string } {
  switch (status) {
    case 400:
      return { falha: 'requisicao_invalida', motivo: 'Parâmetros recusados pela Data Stone.' };
    case 401:
      return {
        falha: 'chave_ou_ip',
        motivo: 'Chave inválida OU IP fora da whitelist — os dois dão 401. Ver campo `ip`.',
      };
    case 402:
      return { falha: 'sem_credito', motivo: 'Conta sem créditos para a operação.' };
    case 406:
      return {
        falha: 'sem_acesso',
        motivo: 'Chave válida, mas a API não está liberada para a conta (pedir ao admin).',
      };
    case 429:
      return {
        falha: 'rate_limit',
        motivo: 'Limite excedido — bloqueio de 24h. Parar a fila; repetir só piora.',
      };
    default:
      return { falha: 'http', motivo: `HTTP ${status}` };
  }
}

export interface OpcoesChamada {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Chamada crua à Data Stone. Devolve sempre um objeto — nunca lança por status —
 * porque quem chama precisa distinguir "não veio dado" de "não pode chamar de novo".
 */
export async function chamarDatastone<T = unknown>(
  path: string,
  opts: OpcoesChamada = {},
): Promise<DatastoneResposta<T>> {
  const token = (process.env.DATASTONE_TOKEN || '').trim();
  if (!token) {
    return {
      ok: false,
      status: 0,
      dados: null,
      falha: 'sem_token',
      motivo: 'DATASTONE_TOKEN não está setado neste serviço.',
    };
  }

  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      method: opts.method || 'GET',
      headers: {
        // Formato exigido pelo spec: "Token <chave>", não "Bearer".
        Authorization: `Token ${token}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });

    const bruto = await resp.text();
    let dados: unknown = bruto;
    try {
      dados = bruto ? JSON.parse(bruto) : null;
    } catch {
      /* resposta não-JSON: mantém o texto, que é o que serve pra diagnóstico */
    }

    if (!resp.ok) {
      const { falha, motivo } = classificar(resp.status);
      return { ok: false, status: resp.status, dados: dados as T, falha, motivo, ip: ipDaMensagem(dados) };
    }
    return { ok: true, status: resp.status, dados: dados as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      dados: null,
      falha: 'rede',
      motivo: msg.includes('abort') ? `Timeout de ${opts.timeoutMs ?? TIMEOUT_MS}ms` : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface ApiTestOk {
  status: string;
  company?: { id: number; name: string; is_active: boolean };
  user?: { id: number; email: string; name: string | null };
}

/** `GET /apitest/` — 0 créditos. Valida chave + IP e diz de quem é a chave. */
export function apiTest() {
  return chamarDatastone<ApiTestOk>('/apitest/');
}

export interface SaldoOk {
  balance?: {
    wallet?: { value: number };
    credits?: Array<{ product_id: number; product_code: string; product_name: string; value: number }>;
  };
  is_pos?: boolean;
}

/** `GET /balance` — saldo por produto. Não consome crédito, mas conta no rate limit. */
export function saldo() {
  return chamarDatastone<SaldoOk>('/balance');
}

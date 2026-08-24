// Integração Open Finance / Celcoin Financial Data — substitui a Pluggy na conciliação.
//
// POR QUE ISTO VIVE NUMA EDGE E NÃO NO RAILWAY (medido em 18/08/2026):
// a borda da Celcoin barra tráfego de fora do Brasil. O Railway sai por
// 152.55.177.153 (Santa Clara, US) e toma 403 com corpo HTML de WAF — a
// requisição nem chega na aplicação deles. Esta edge sai por São Paulo
// (54.207.41.86, AWS sa-east-1) e a mesma chamada responde JSON normalmente.
// Como distinguir sem chutar: credencial inválida naquele endpoint responde
// 400 {"error":"invalid_client"}; 403 com HTML é bloqueio anterior à aplicação.
// Some a isso a LGPD: o tráfego carrega CPF/CNPJ, saldo e extrato, e agora é
// buscado, processado e gravado tudo em território nacional.
//
// A arquitetura NÃO veio da doc pública da Celcoin: veio do celcoin-data-gateway
// do Quitepay, que já roda contra a Celcoin em produção (BB, Bradesco PJ e Nubank,
// validações de 28/07 e 07/08/2026). A doc aberta descreve a stack Baas, outra coisa.
//
// SÃO DOIS TOKENS, em hosts diferentes, que não se substituem:
//   admin  POST {onboard}/api/portal/onboard/v2/token
//          Authorization: Basic base64(client_id:client_secret), SEM body. ~1h.
//          Serve só para criar/ler consentimento. Nunca lê dados.
//   rpt    POST {data}/api/open-keys/token
//          form-urlencoded, client_id + client_secret + scope=consent:<id>. ~5min.
//          Serve só para ler dados, e a Celcoin só o emite com consent AUTHORISED.
//
// O consentimento NÃO viaja em header nas chamadas de dados: está embutido no
// escopo do rpt_token. Os GETs levam só Accept e Authorization: Bearer.
//
// mTLS: a versão do Railway carregava suporte a client certificate "caso a
// Celcoin exigisse", e isso era uma das razões alegadas para não viver numa
// edge. A razão morreu — do Railway não se alcança a Celcoin de forma alguma —
// e o gateway do Quitepay prova em produção que esta stack não exige mTLS.
// Suporte removido: reintroduzir código morto por precaução foi o que produziu
// a celcoin-gateway órfã com hosts inventados.
//
// Secrets (Supabase, projeto kmedldlepwiityjsdahz):
//   CELCOIN_CLIENT_ID, CELCOIN_CLIENT_SECRET   obrigatórios
//   CELCOIN_ENV                                'sandbox' (default) | 'production'
//   CELCOIN_HOST_ONBOARD/_SMARTKEYS/_OPENKEYS/_DATA   override por host
//   CELCOIN_REDIRECT_URL                       registro do callback cadastrado na Celcoin
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cloud-jwt, x-request-id',
};

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;
const DATA_RETRIES = 3;

const ext = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

// ---------------------------------------------------------------------------
// Autorização. O functionRouter chama toda edge do Externo com a anon key, que é
// PÚBLICA — sozinha ela não identifica ninguém. Esta função cria consentimento
// em banco com a credencial da firma e lê extrato, então precisa de identidade
// de verdade: mesmo modelo do Railway (functionAuth.ts), o JWT da sessão do
// Cloud validado em /auth/v1/user. O router o envia em x-cloud-jwt porque o
// Authorization já carrega a anon key exigida pelo gateway do Supabase.
// Service role também passa, para chamada servidor-a-servidor.
// ---------------------------------------------------------------------------
const CLOUD_URL = Deno.env.get('CLOUD_FUNCTIONS_URL') || 'https://gliigkupoebmlbwyvijp.supabase.co';
// Anon key do Cloud. NÃO é segredo — vai no bundle do navegador e já está
// hardcoded em src/lib/functionRouter.ts pelo mesmo motivo. Fica com valor
// padrão para não criar um secret a mais cujo esquecimento derrubaria a
// autorização inteira de forma silenciosa.
const CLOUD_ANON_KEY =
  Deno.env.get('CLOUD_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';
const JWT_TTL_MS = 60_000;
const jwtCache = new Map<string, { userId: string; expiresAt: number }>();

/**
 * Lê o claim `role` do JWT já validado pelo gateway. Só decodifica o payload —
 * a assinatura o verify_jwt do gateway já conferiu. Mesmo idiom de
 * zapsign-create-template. Comparar string com SUPABASE_SERVICE_ROLE_KEY seria
 * frágil: depende da env var estar injetada e quebra em rotação de chave.
 */
function isServiceRole(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    );
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

async function autorizar(req: Request): Promise<{ ok: boolean; userId: string | null; via: string }> {
  const presented = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (isServiceRole(presented)) return { ok: true, userId: null, via: 'service_role' };

  const jwt = (req.headers.get('x-cloud-jwt') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return { ok: false, userId: null, via: 'nenhuma' };

  const hit = jwtCache.get(jwt);
  if (hit && Date.now() < hit.expiresAt) return { ok: true, userId: hit.userId, via: 'cloud_jwt' };

  try {
    const r = await fetch(`${CLOUD_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: CLOUD_ANON_KEY },
    });
    if (!r.ok) return { ok: false, userId: null, via: 'cloud_jwt_invalido' };
    const u = await r.json();
    if (!u?.id) return { ok: false, userId: null, via: 'cloud_jwt_sem_id' };
    jwtCache.set(jwt, { userId: u.id, expiresAt: Date.now() + JWT_TTL_MS });
    return { ok: true, userId: u.id, via: 'cloud_jwt' };
  } catch {
    return { ok: false, userId: null, via: 'cloud_jwt_erro' };
  }
}

// ---------------------------------------------------------------------------
// Hosts. Só os de produção são conhecidos; os de sandbox são derivados do padrão
// de nome e foram MEDIDOS como inexistentes (DNS curinga servindo certificado
// "Kubernetes Ingress Controller Fake Certificate"). Ou seja: production.
// ---------------------------------------------------------------------------
function endpoints() {
  const production = ['production', 'prod'].includes((Deno.env.get('CELCOIN_ENV') || 'sandbox').toLowerCase());
  const tier = production ? 'production' : 'sandbox';
  return {
    onboard: Deno.env.get('CELCOIN_HOST_ONBOARD') || `https://onboard-ui.smartkeys.celcoin.${tier}.fsapps.app`,
    smartkeys: Deno.env.get('CELCOIN_HOST_SMARTKEYS') || `https://api-smartkeys.celcoin.${tier}.fsapps.app`,
    openkeys: Deno.env.get('CELCOIN_HOST_OPENKEYS') || `https://api-openkeys.celcoin.${tier}.fsapps.app`,
    data: Deno.env.get('CELCOIN_HOST_DATA') || `https://api.v3.celcoin.${tier}.fsapps.app`,
    tier,
  };
}

interface Result<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

async function request(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; form?: URLSearchParams } = {},
): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) };
  let payload: string | undefined;
  if (opts.form) {
    payload = opts.form.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (opts.body !== undefined && opts.body !== null) {
    payload = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const raw = await res.text();
  let parsed: any = raw;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* mantém texto cru */
  }
  // Corpo nunca vai pro log: são dados Open Finance regulados (CPF/CNPJ, saldos,
  // transações). Só formato e tamanho.
  console.log(`[celcoin] ${method} ${new URL(url).pathname} -> ${res.status} (${raw.length}b)`);
  return { ok: res.ok, status: res.status, body: parsed };
}

// Motivo legível de uma falha upstream. A Celcoin distingue credencial inválida
// (400 invalid_client) de bloqueio de borda (403 + HTML) SÓ no corpo. Sequências
// longas de dígitos são mascaradas — mesma regra do log acima.
function motivo(r: Result): string {
  const raw = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? '');
  if (!raw || raw === '""' || raw === 'null') return 'corpo vazio';
  return raw.replace(/\d{8,}/g, (d) => `***${d.slice(-2)}`).slice(0, 300);
}

// A Celcoin devolve a grafia com Z (AUTHORIZED, AWAITING_AUTHORIZATION); o padrão
// Open Finance Brasil e o resto do nosso código usam S (AUTHORISED). Medido em
// 18/08/2026 com consentimento real. Sem normalizar, o portão do sync recusaria
// para sempre com "está AUTHORIZED, não AUTHORISED" — e pareceria erro da Celcoin.
function normalizarStatus(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/AUTHORIZ/g, 'AUTHORIS');
}
const autorizado = (v: unknown) => normalizarStatus(v) === 'AUTHORISED';

function credentials() {
  const clientId = Deno.env.get('CELCOIN_CLIENT_ID');
  const clientSecret = Deno.env.get('CELCOIN_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Missing CELCOIN_CLIENT_ID or CELCOIN_CLIENT_SECRET');
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

// --- Token admin: Basic, sem body. Só mexe em consentimento. ---
let adminToken: { token: string; expiresAt: number } | null = null;
async function getAdminToken(): Promise<string> {
  if (adminToken && Date.now() < adminToken.expiresAt) return adminToken.token;
  const { clientId, clientSecret } = credentials();
  const r = await request('POST', `${endpoints().onboard}/api/portal/onboard/v2/token`, {
    headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
  });
  if (!r.ok) throw new Error(`Celcoin onboard token falhou (HTTP ${r.status}): ${motivo(r)}`);
  const token = r.body?.access_token || r.body?.token;
  if (!token) throw new Error('onboard token: resposta sem access_token');
  adminToken = { token, expiresAt: Date.now() + Math.max(30, Number(r.body?.expires_in || 3600) - 30) * 1000 };
  return token;
}

// --- rpt_token: escopo preso a um consentimento. Só lê dados. ---
const rptTokens = new Map<string, { token: string; expiresAt: number }>();
async function getRptToken(consentId: string): Promise<string> {
  const cached = rptTokens.get(consentId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const { clientId, clientSecret } = credentials();
  const r = await request('POST', `${endpoints().data}/api/open-keys/token`, {
    form: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: `consent:${consentId}` }),
  });
  if (!r.ok) throw new Error(`Celcoin open-keys token falhou (HTTP ${r.status}) consent=${consentId}: ${motivo(r)}`);
  const token = r.body?.access_token;
  if (!token) throw new Error('open-keys token: resposta sem access_token');
  rptTokens.set(consentId, {
    token,
    expiresAt: Date.now() + Math.max(30, Number(r.body?.expires_in || 300) - 30) * 1000,
  });
  return token;
}

async function fetchBrands(): Promise<any[]> {
  const token = await getAdminToken();
  const r = await request('GET', `${endpoints().openkeys}/open-keys-itp/api/brands/v1/brands?type=DATA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Celcoin brands falhou (HTTP ${r.status}): ${motivo(r)}`);
  const raw = r.body;
  return Array.isArray(raw) ? raw : raw?.content ?? raw?.items ?? raw?.data ?? [];
}

const brandLabel = (b: any): string | null => b?.CustomerFriendlyName ?? b?.name ?? null;
const brandKey = (b: any): string | null => b?.AuthorisationServerId ?? b?.brandId ?? b?.id ?? null;

async function resolveBrandName(brandId: string): Promise<string | null> {
  try {
    const hit = (await fetchBrands()).find((b) => brandKey(b) === brandId);
    return hit ? brandLabel(hit) : null;
  } catch {
    return null; // cosmético: não pode derrubar o consent
  }
}

// Núcleo validado em produção pelo Quitepay. Conciliação não lê operações de
// crédito nem investimentos: cada permissão a mais é outra linha que o titular
// precisa aprovar na tela do banco.
const CORE_PERMISSIONS = [
  'ACCOUNTS_READ',
  'ACCOUNTS_BALANCES_READ',
  'ACCOUNTS_TRANSACTIONS_READ',
  'ACCOUNTS_OVERDRAFT_LIMITS_READ',
  'CREDIT_CARDS_ACCOUNTS_READ',
  'CREDIT_CARDS_ACCOUNTS_BILLS_READ',
  'CREDIT_CARDS_ACCOUNTS_BILLS_TRANSACTIONS_READ',
  'CREDIT_CARDS_ACCOUNTS_LIMITS_READ',
  'CREDIT_CARDS_ACCOUNTS_TRANSACTIONS_READ',
  'CUSTOMERS_PERSONAL_IDENTIFICATIONS_READ',
  'CUSTOMERS_PERSONAL_ADITTIONALINFO_READ',
  'RESOURCES_READ',
];
const MINIMAL_PERMISSIONS = [
  'ACCOUNTS_READ',
  'ACCOUNTS_BALANCES_READ',
  'ACCOUNTS_TRANSACTIONS_READ',
  'CREDIT_CARDS_ACCOUNTS_READ',
  'CREDIT_CARDS_ACCOUNTS_BILLS_READ',
  'CREDIT_CARDS_ACCOUNTS_BILLS_TRANSACTIONS_READ',
  'CREDIT_CARDS_ACCOUNTS_TRANSACTIONS_READ',
  'RESOURCES_READ',
];
const PERMISSION_LADDER = [CORE_PERMISSIONS, MINIMAL_PERMISSIONS];

const GROUP_PERM: Record<string, string> = {
  accounts: 'ACCOUNTS',
  'credit-cards-accounts': 'CREDIT_CARDS',
  resources: 'RESOURCES',
  customers: 'CUSTOMERS',
};

const consentUrl = (consentId?: string) => {
  const base = `${endpoints().smartkeys}/api/smart-keys/data-reception/v1/consents`;
  return consentId ? `${base}/${encodeURIComponent(consentId)}` : base;
};

function isPermissionSetError(r: Result): boolean {
  const errors = r.body?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e: any) => {
    const code = `${e?.code ?? ''} ${e?.title ?? ''}`.toUpperCase();
    return code.includes('COMBINACAO') || code.includes('PERMISS');
  });
}

// A primeira leitura costuma vir 404 enquanto a Celcoin ainda busca no detentor
// (ingestão assíncrona); retentar com rpt_token novo re-dispara a busca. O mesmo
// 404 é PERMANENTE quando o grupo não está no consent ou o path não existe.
async function fetchData(
  consentId: string,
  resourcePath: string,
  query: Record<string, string | number | undefined> = {},
  consentPermissions: string[] | null = null,
): Promise<Result> {
  const group = resourcePath.split('/')[0];
  const permPrefix = GROUP_PERM[group];
  const groupNotConsented =
    consentPermissions !== null && permPrefix !== undefined && !consentPermissions.some((p) => p.startsWith(permPrefix));

  const url = new URL(`${endpoints().data}/api/open-keys/${resourcePath}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  let result: Result | null = null;
  for (let attempt = 0; attempt <= DATA_RETRIES; attempt++) {
    const token = await getRptToken(consentId);
    result = await request('GET', url.toString(), { headers: { Authorization: `Bearer ${token}` } });

    const errors = Array.isArray(result.body?.errors) ? result.body.errors : null;
    const wrongPath = !!errors?.some((e: any) => (e?.code ?? '') === 'NOT_FOUND');
    const retriable = result.status === 404 && !wrongPath && !groupNotConsented;

    if (!retriable || attempt === DATA_RETRIES) break;
    console.warn(`[celcoin] ${resourcePath}: 404 de ingestão, tentativa ${attempt + 1}/${DATA_RETRIES}`);
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return result!;
}

async function fetchPaged(
  consentId: string,
  resourcePath: string,
  query: Record<string, string | number | undefined> = {},
  permissions: string[] | null = null,
): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const r = await fetchData(consentId, resourcePath, { ...query, page, 'page-size': PAGE_SIZE }, permissions);
    if (!r.ok) {
      if (r.status === 404) {
        // Caminho errado devolve o MESMO 404 de "grupo não consentido". Sair
        // calado aqui é o que disfarça bug de path/versão de resposta vazia.
        console.warn(`[celcoin] ${resourcePath}: 404 -> devolvendo vazio (${motivo(r)})`);
        return out;
      }
      throw new Error(`GET ${resourcePath} falhou (HTTP ${r.status}): ${motivo(r)}`);
    }
    const data = r.body?.data;
    if (Array.isArray(data)) out.push(...data);
    else if (data) out.push(data);
    if (!r.body?.links?.next) break;
    page += 1;
  }
  if (page > MAX_PAGES) console.warn(`[celcoin] ${resourcePath}: parou em ${MAX_PAGES} páginas`);
  return out;
}

function maskDoc(doc: string): string {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
  if (d.length === 14) return `**.***.***/${d.slice(8, 12)}-**`;
  return '***';
}

// Open Finance Brasil limita o consent de dados a no máximo 12 meses.
// Três detalhes que a Celcoin recusa se faltarem — os três vieram do gateway do
// Quitepay depois que a 1ª tentativa real tomou 400 DADOS_INVALIDOS em
// 'data.expirationDateTime fails to match the required pattern':
//   1. SEM milissegundos: toISOString() devolve .sssZ e o padrão exigido é
//      RFC3339 sem fração de segundo;
//   2. setUTCMonth, não setMonth — o local desloca conforme o fuso do runtime;
//   3. recuar 1 minuto, para nunca bater exatamente no teto do transmissor.
function expirationFromMonths(months?: number): string {
  const m = Math.min(12, Math.max(1, Math.round(Number(months) || 12)));
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + m);
  d.setUTCMinutes(d.getUTCMinutes() - 1);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// A Celcoin devolve transactionDateTime em UTC. Fatiar a string ISO gravava a
// data e a hora de Londres: MEDIDO contra o extrato do Inter em 18/08/2026, 38
// dos 298 lancamentos (12,8% -- os de 21h em diante) caiam no dia SEGUINTE, e as
// 298 horas vinham 3h adiantadas. Os totais batiam, o dia a dia nao.
// bookingDate e transaction_date ja vem sem hora: converter esses deslocaria
// pra tras (meia-noite UTC = 21h do dia anterior aqui), entao passam intactos.
const FUSO = 'America/Sao_Paulo';
const fmtBrasilia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function emBrasilia(v: unknown): { date: string; time: string | null } | null {
  const raw = String(v ?? '');
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2}))?/);
  if (!m) return null;
  if (!m[2]) return { date: m[1], time: null };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { date: m[1], time: m[2] };
  const parts = Object.fromEntries(fmtBrasilia.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

const toDateOnly = (v: unknown): string | null => emBrasilia(v)?.date ?? null;
const toTimeOnly = (v: unknown): string | null => emBrasilia(v)?.time ?? null;

// Piso da janela de sincronização. A Pluggy parou em 18/03/2026 mas seus ~8 mil
// lançamentos seguem NESTAS mesmas tabelas, e a tela de conciliação não filtra
// por provider. Como a UNIQUE é (provider, pluggy_transaction_id), a mesma
// despesa vinda da Celcoin entraria como linha nova e o financeiro veria tudo em
// dobro. Daí o piso, que combina duas perguntas -- ver syncFloor abaixo.
const hojeBrasilia = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Quantos dias reprocessar por cima do que já temos. Existe porque o dia corrente
// não fecha: uma rodada das 06h grava os lançamentos da madrugada, e retomar do
// dia seguinte perderia TODO o resto do dia, calado. Reprocessar é de graça em
// termos de dado -- a UNIQUE (provider, pluggy_transaction_id) faz o upsert
// sobrescrever a mesma linha -- e custa só algumas leituras a mais na Celcoin.
const DIAS_DE_REPROCESSO = 3;

// Todos os consent_id do mesmo banco e do mesmo usuário, inclusive os já
// descartados. Reautorizar o banco emite um consent_id novo, e o extrato que o
// anterior trouxe continua sendo desta conexão -- sem isso a reautorização
// reimportaria o histórico inteiro, e o transmissor não promete transactionId
// estável entre consentimentos.
async function conexoesIrmas(consentId: string, userId: string, brandId: unknown): Promise<string[]> {
  if (!brandId) return [consentId];
  const { data } = await ext
    .from('celcoin_consents')
    .select('consent_id')
    .eq('user_id', userId)
    .eq('brand_id', brandId);
  const ids = (data || []).map((r: any) => String(r.consent_id)).filter(Boolean);
  return ids.includes(consentId) ? ids : [...ids, consentId];
}

async function syncFloor(
  table: 'bank_transactions' | 'credit_card_transactions',
  userId: string,
  accountId: string,
  irmas: string[],
): Promise<string> {
  // Duas perguntas diferentes, e confundi-las é o que gera duplicata OU buraco:
  //   celcoin + ESTA conta -> até onde esta conta já foi? Volto
  //                 DIAS_DE_REPROCESSO por cima. O escopo é a CONTA, não o
  //                 consentimento e muito menos o banco: MEDIDO em 24/08/2026,
  //                 escopar por marca fez a conta nova da R.P.Adv nascer com o
  //                 piso da P.CAP (mesmo Inter PJ, mesmo usuário) e a primeira
  //                 rodada trouxe 81 linhas de 6 dias dizendo `success: true`,
  //                 com 1.641 lançamentos de 19/03 a 18/08 nunca buscados. O
  //                 cron não volta atrás: o buraco seria permanente.
  //   outro provider -> até onde a Pluggy foi? É piso intransponível na
  //                 primeira rodada: reimportar o que ela já trouxe apareceria
  //                 em dobro na tela, que não filtra por provider. Fica no
  //                 usuário inteiro porque não há como casar item da Pluggy com
  //                 consentimento da Celcoin. Num banco que a Pluggy nunca viu
  //                 isso encurta o histórico -- é o caso de mandar `from`.
  const [minha, qualquer] = await Promise.all([
    ext.from(table).select('transaction_date').eq('user_id', userId).eq('provider', 'celcoin')
      .eq('pluggy_account_id', accountId)
      .order('transaction_date', { ascending: false }).limit(1).maybeSingle(),
    ext.from(table).select('transaction_date').eq('user_id', userId)
      .or('provider.is.null,provider.neq.celcoin')
      .order('transaction_date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const recuar = (iso: string, dias: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };

  const minhaUltima = toDateOnly(minha.data?.transaction_date);
  const outroUltimo = toDateOnly(qualquer.data?.transaction_date);

  if (minhaUltima) {
    const piso = recuar(minhaUltima, -DIAS_DE_REPROCESSO);
    // Nunca antes do dia seguinte ao que outro provider já cobriu.
    const limite = outroUltimo && outroUltimo > minhaUltima ? recuar(outroUltimo, 1) : null;
    return limite && limite > piso ? limite : piso;
  }

  // Conta sem linha nenhuma. Ou é conta nova de verdade, ou é a mesma conta
  // reautorizada num consentimento que trocou o accountId -- o padrão não
  // promete id estável entre consentimentos (no Inter ele é o próprio número da
  // conta com o dígito, mas isso é escolha DELE, não garantia do padrão).
  // Os dois casos pedem coisas opostas e daqui não dá pra distinguir, então
  // escolho puxar o histórico e deixar o rastro: duplicata aparece na tela e se
  // conserta; buraco não aparece e o cron nunca volta pra buscar.
  if (irmas.length) {
    const { data: irma } = await ext
      .from(table).select('transaction_date').eq('user_id', userId).eq('provider', 'celcoin')
      .in('pluggy_item_id', irmas)
      .order('transaction_date', { ascending: false }).limit(1).maybeSingle();
    if (irma?.transaction_date) {
      console.warn(
        `[celcoin] conta ${accountId} sem lançamento próprio em ${table}, mas consentimento irmão ` +
          `já gravou até ${toDateOnly(irma.transaction_date)}. Tratando como conta NOVA e puxando o ` +
          `histórico. Se for a mesma conta reautorizada, confira duplicata por (data, valor, descrição).`,
      );
    }
  }

  if (outroUltimo) return recuar(outroUltimo, 1); // 1a rodada DESTA conta: retomo onde a Pluggy parou
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12); // sem histórico nenhum: 12 meses, teto usual das transmissoras
  return d.toISOString().slice(0, 10);
}

// No Open Finance o sinal vem em creditDebitType, não no valor.
function signedAmount(tx: any): number {
  const raw = Number(tx?.transactionAmount?.amount ?? tx?.amount?.amount ?? tx?.amount ?? 0);
  const type = String(tx?.creditDebitType || tx?.creditDebitIndicator || '').toUpperCase();
  return type.startsWith('DEB') ? -Math.abs(raw) : Math.abs(raw);
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Tira um consentimento de circulação. DOIS desfechos possíveis, e chamar os
// dois de "revogado" seria mentira no banco:
//
//   REVOKED    a Celcoin aceitou o DELETE (ou respondeu 404: já não existe lá).
//   ABANDONED  a Celcoin RECUSOU. Medido em 19/08/2026 nos 6 órfãos de 18/08:
//              DELETE em consentimento AWAITING_AUTHORISATION devolve
//              `422 Unprocessable Entity`, sem código de erro no corpo. Não há
//              o que revogar num consentimento que nunca concedeu nada -- e ele
//              também não caduca: os 6 seguiam AWAITING 21h depois, com
//              expirationDateTime em 2027. Ficam lá, inertes, até essa data.
//              O gateway do Quitepay, na mesma stack, também não os revoga:
//              filtra por AUTHORISED na leitura e ignora o resto.
//
// Em ambos os casos a linha local sai da tela, que é o dano real -- sete
// cartões chamados "Banco Inter PJ" e nenhuma forma de saber qual funciona.
// Não apagamos a linha: o rastro de que o consentimento existe (e ainda existe,
// no caso ABANDONED) é justamente o que não pode sumir.
async function descartar(consentId: string): Promise<{ status: number; desfecho: 'REVOKED' | 'ABANDONED'; body: unknown }> {
  const token = await getAdminToken();
  const r = await request('DELETE', consentUrl(consentId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const desfecho = r.ok || r.status === 404 ? 'REVOKED' : 'ABANDONED';
  await ext
    .from('celcoin_consents')
    .update({ status: desfecho, updated_at: new Date().toISOString() })
    .eq('consent_id', consentId);
  return { status: r.status, desfecho, body: r.body };
}

// Consentimento que ainda não foi autorizado no banco: erro do CHAMADOR (409),
// não falha nossa. Distinguir importa no sync_all, que segue para os outros.
class NaoAutorizado extends Error {}

type ResumoSync = {
  bank_transactions: number;
  credit_card_transactions: number;
  // Null quando o consentimento não expôs conta daquele tipo -- distinguir
  // "nenhuma conta" de "conta sem movimento" é o que faz o alerta funcionar.
  janela: { bank_from: string | null; card_from: string | null; to: string | null };
};

// Extrato de conta + transações de fatura, gravados com provider='celcoin'.
// Mesmas tabelas da Pluggy: a coluna provider é o que deixa as duas conviverem.
async function sincronizar(
  consentId: string,
  userId: string,
  janela?: { from?: string; to?: string },
): Promise<ResumoSync> {
  const { data: consentRow } = await ext
    .from('celcoin_consents')
    .select('permissions, status, brand_id')
    .eq('consent_id', consentId)
    .maybeSingle();

  if (consentRow && !autorizado(consentRow.status)) {
    throw new NaoAutorizado(`Consentimento está ${consentRow.status}, não AUTHORISED — a Celcoin não emite rpt_token nesse estado.`);
  }
  const permissions: string[] | null = Array.isArray(consentRow?.permissions)
    ? (consentRow!.permissions as string[])
    : null;

  // O Inter recusa a janela pela metade: 422 OPFDA010 "DATA INICIAL OU DATA
  // FINAL NÃO INFORMADAS" quando só fromBookingDate viaja. As duas pontas são
  // obrigatórias, então sem `to` no body o teto é hoje em Brasília — data UTC
  // adiantaria um dia depois das 21h e viraria data futura pro detentor.
  const to = janela?.to ? String(janela.to) : hojeBrasilia();
  // Só para detectar reautorização com id de conta trocado -- o piso em si é
  // por conta, calculado dentro de cada laço.
  const irmas = await conexoesIrmas(consentId, userId, consentRow?.brand_id);
  let bankCount = 0;
  let cardCount = 0;
  // O piso agora é por conta, então o resumo reporta o MAIS ANTIGO usado na
  // rodada. É o número que responde "de quando pra cá isto olhou?" -- reportar
  // o de uma conta só esconderia justamente a conta nova que puxa histórico.
  let bankFloor: string | null = null;
  let cardFloor: string | null = null;

  for (const acc of await fetchPaged(consentId, 'accounts/v2/accounts', {}, permissions)) {
    const accountId = acc?.accountId;
    if (!accountId) continue;

    const bankFrom = janela?.from
      ? String(janela.from)
      : await syncFloor('bank_transactions', userId, String(accountId), irmas);
    if (!bankFloor || bankFrom < bankFloor) bankFloor = bankFrom;

    const txs = await fetchPaged(
      consentId,
      `accounts/v2/accounts/${encodeURIComponent(accountId)}/transactions`,
      { fromBookingDate: bankFrom, toBookingDate: to },
      permissions,
    );

    const rows = txs
      .filter((t: any) => t?.transactionId)
      .map((t: any) => ({
        user_id: userId,
        provider: 'celcoin',
        pluggy_account_id: accountId, // coluna herdada = id da conta na origem
        pluggy_transaction_id: t.transactionId,
        pluggy_item_id: consentId, // agrupador da conexão = consentimento
        description: t.transactionName || t.typeAdditionalInfo || null,
        amount: signedAmount(t),
        currency_code: t.transactionAmount?.currency || 'BRL',
        transaction_date: toDateOnly(t.transactionDateTime) || toDateOnly(t.bookingDate),
        transaction_time: toTimeOnly(t.transactionDateTime),
        transaction_type: t.type || null,
        // Open Finance não devolve categoria: categorizar passa a ser nosso.
        category: null,
        payment_data: {
          completedAuthorisedPaymentType: t.completedAuthorisedPaymentType ?? null,
          creditDebitType: t.creditDebitType ?? null,
          partiePersonType: t.partiePersonType ?? null,
          codeISPB: t.codeISPB ?? null,
        },
        merchant_name: t.partieName || null,
        merchant_cnpj: t.partieCnpjCpf || null,
      }))
      .filter((r) => r.transaction_date && r.transaction_date >= bankFrom);

    if (rows.length) {
      const { error } = await ext
        .from('bank_transactions')
        .upsert(rows, { onConflict: 'provider,pluggy_transaction_id' });
      if (error) throw new Error(`upsert bank_transactions: ${error.message}`);
      bankCount += rows.length;
    }
  }

  // Cartão é hierárquico: conta -> fatura -> transações.
  for (const card of await fetchPaged(consentId, 'credit-cards-accounts/v2/accounts', {}, permissions)) {
    const cardId = card?.creditCardAccountId;
    if (!cardId) continue;

    const cardFrom = janela?.from
      ? String(janela.from)
      : await syncFloor('credit_card_transactions', userId, String(cardId), irmas);
    if (!cardFloor || cardFrom < cardFloor) cardFloor = cardFrom;

    const billsPath = `credit-cards-accounts/v2/accounts/${encodeURIComponent(cardId)}/bills`;

    // Data de VENCIMENTO da fatura, não da compra: uma fatura de abril carrega
    // compras de março. O recorte por data de compra é o filtro lá embaixo;
    // este só evita puxar fatura à toa.
    let bills = await fetchPaged(consentId, billsPath, { fromDueDate: cardFrom, toDueDate: to }, permissions);

    // Lista vazia COM janela é ambígua, e a ambiguidade é cara: ou o cartão não
    // tem fatura nenhuma, ou este par de parâmetros não é o que o transmissor
    // espera e ele responde vazio em vez de ignorar. MEDIDO em 19/08/2026 no
    // Inter: 0 faturas -- e ali a lista vazia é verdade, porque a Pluggy também
    // nunca viu cartão nas duas conexões do Inter em 14 meses (5.524 lançamentos
    // de cartão, todos do Santander). Só que descobrir a outra hipótese no banco
    // que TEM cartão sairia caro, então repito sem janela antes de desistir: o
    // filtro por data de compra continua valendo lá embaixo, o resultado é o
    // mesmo, custa algumas leituras.
    if (!bills.length) {
      const semJanela = await fetchPaged(consentId, billsPath, {}, permissions);
      if (semJanela.length) {
        console.warn(
          `[celcoin] cartão ${String(cardId).slice(0, 6)}…: 0 faturas com janela ${cardFrom}..${to}, ` +
            `${semJanela.length} sem janela — fromDueDate/toDueDate não vale neste transmissor`,
        );
        bills = semJanela;
      } else {
        console.warn(`[celcoin] cartão ${String(cardId).slice(0, 6)}…: 0 faturas, com e sem janela`);
      }
    }

    for (const bill of bills) {
      const billId = bill?.billId ?? bill?.id ?? bill?.billIdentification;
      if (!billId) {
        console.warn(`[celcoin] fatura sem id; campos recebidos: ${Object.keys(bill || {}).join(',')}`);
        continue;
      }

      const txPath =
        `credit-cards-accounts/v2/accounts/${encodeURIComponent(cardId)}/bills/${encodeURIComponent(String(billId))}/transactions`;

      // A janela desta chamada NÃO está medida: o Inter exige as duas pontas em
      // /accounts/../transactions (422 OPFDA010) e nada garante que o par se
      // chame igual aqui. Mando o nome do padrão OFB e, se for recusado, repito
      // sem janela -- o recorte por data de compra é o filtro logo abaixo, então
      // sem janela o resultado continua correto, só custa mais leitura.
      let txs: any[];
      try {
        txs = await fetchPaged(consentId, txPath, { fromTransactionDate: cardFrom, toTransactionDate: to }, permissions);
      } catch (e) {
        console.warn(
          `[celcoin] fatura ${String(billId).slice(0, 6)}…: janela recusada (${e instanceof Error ? e.message : e}); repetindo sem janela`,
        );
        txs = await fetchPaged(consentId, txPath, {}, permissions);
      }

      const rows = txs
        .filter((t: any) => t?.transactionId)
        .map((t: any) => ({
          user_id: userId,
          provider: 'celcoin',
          pluggy_account_id: cardId,
          pluggy_transaction_id: t.transactionId,
          pluggy_item_id: consentId,
          description: t.transactionName || null,
          amount: Math.abs(Number(t.billetedAmount?.amount ?? t.amount?.amount ?? t.brazilianAmount?.amount ?? 0)),
          currency_code: t.amount?.currency || 'BRL',
          transaction_date: toDateOnly(t.transactionDateTime) || toDateOnly(t.billPostDate),
          transaction_time: toTimeOnly(t.transactionDateTime),
          category: null,
          payment_data: {
            billId,
            transactionType: t.transactionType ?? null,
            paymentType: t.paymentType ?? null,
            feeType: t.feeType ?? null,
            payeeMCC: t.payeeMCC ?? null, // única matéria-prima p/ categorizar cartão
          },
          merchant_name: t.transactionName || null,
          installment_number: t.instalmentNumber ?? null,
          total_installments: t.totalInstalments ?? null,
        }))
        .filter((r) => r.transaction_date && r.transaction_date >= cardFrom);

      if (rows.length) {
        const { error } = await ext
          .from('credit_card_transactions')
          .upsert(rows, { onConflict: 'provider,pluggy_transaction_id' });
        if (error) throw new Error(`upsert credit_card_transactions: ${error.message}`);
        cardCount += rows.length;
      }
    }
  }

  await ext
    .from('celcoin_consents')
    .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('consent_id', consentId);

  console.log(
    `[celcoin] sync consent=${consentId}: ${bankCount} bancárias (desde ${bankFloor ?? 'sem conta'}), ` +
      `${cardCount} de cartão (desde ${cardFloor ?? 'sem cartão'})`,
  );
  return {
    bank_transactions: bankCount,
    credit_card_transactions: cardCount,
    // Explícito porque a janela é calculada, não informada: sem isto um sync
    // que traz 0 linhas é indistinguível de conta sem movimento.
    janela: { bank_from: bankFloor, card_from: cardFloor, to: to ?? null },
  };
}

/**
 * Traduz o uuid do Cloud (o que a sessão do front carrega) para o uuid do
 * Externo (o que as tabelas financeiras gravam em `user_id`). NÃO é o mesmo
 * número: dos 52 usuários em `auth_uuid_mapping`, **26 têm uuid diferente nos
 * dois bancos**, e o dono de 100% dos lançamentos é um deles — `79c5c9d1…` no
 * Cloud contra `21924f81…` no Externo. Comparar o uuid do Cloud direto com
 * `user_id` devolveria **vazio, não erro**, que é a forma mais cara de errar.
 *
 * Sem linha no mapping devolve o próprio uuid do Cloud: 26 dos 52 são idênticos
 * mesmo, então o palpite acerta metade das vezes e nunca é pior que falhar. Quem
 * chama recebe `mapeado` para saber qual dos dois casos aconteceu.
 */
async function uuidNoExterno(cloudUuid: string): Promise<{ uuid: string; mapeado: boolean }> {
  const { data } = await ext
    .from('auth_uuid_mapping').select('ext_uuid').eq('cloud_uuid', cloudUuid).maybeSingle();
  const achado = (data as any)?.ext_uuid;
  return achado ? { uuid: String(achado), mapeado: true } : { uuid: cloudUuid, mapeado: false };
}

// Teto de linhas por chamada. O PostgREST corta em 1000 por resposta e não avisa
// -- a versão que lia o Cloud batia nesse teto calada. Aqui pagino até o teto e
// digo se truncou, porque lista financeira cortada em silêncio é conciliação
// errada, não lista incompleta.
const PAGINA_LEITURA = 1000;
const TETO_LEITURA = 20_000;

/**
 * Lê transações aplicando **a mesma regra das policies do Externo**, que o
 * service role ignora:
 *   bank: user_id = eu OR can_view_pluggy_account(eu, pluggy_account_id)
 *   card: user_id = eu OR can_view_card(eu, card_last_digits)
 * As duas funções são `EXISTS` numa tabela de permissão e nada mais (conferido
 * em 24/08/2026 com pg_get_functiondef), então reproduzi-las aqui é fiel. Não
 * há bypass de admin nas policies de leitura -- não inventei um.
 */
async function lerTransacoes(
  tabela: 'bank_transactions' | 'credit_card_transactions',
  meuUuid: string,
  de: string | null,
  ate: string | null,
): Promise<{ linhas: any[]; truncado: boolean; permitidos: number }> {
  const perm = tabela === 'bank_transactions'
    ? { tabela: 'user_account_permissions', coluna: 'pluggy_account_id' }
    : { tabela: 'user_card_permissions', coluna: 'card_last_digits' };

  const { data: linhasPerm, error: erroPerm } = await ext
    .from(perm.tabela).select(perm.coluna).eq('user_id', meuUuid);
  if (erroPerm) throw new Error(`${perm.tabela}: ${erroPerm.message}`);

  // Sanitiza antes de entrar no `in.(...)`: o filtro do PostgREST é uma string,
  // e vírgula ou parêntese num valor mudaria o sentido da expressão.
  const permitidos = [...new Set(
    (linhasPerm || [])
      .map((r: any) => String(r[perm.coluna] ?? '').replace(/[^A-Za-z0-9_-]/g, ''))
      .filter(Boolean),
  )];

  const filtro = permitidos.length
    ? `user_id.eq.${meuUuid},${perm.coluna}.in.(${permitidos.join(',')})`
    : `user_id.eq.${meuUuid}`;

  const linhas: any[] = [];
  for (let inicio = 0; inicio < TETO_LEITURA; inicio += PAGINA_LEITURA) {
    let q = ext.from(tabela).select('*')
      // Ordem estável: `transaction_date` sozinho não é único, e paginar por
      // chave não-única pula e repete linha entre páginas.
      .order('transaction_date', { ascending: false })
      .order('id', { ascending: false })
      .range(inicio, inicio + PAGINA_LEITURA - 1)
      .or(filtro);
    if (de) q = q.gte('transaction_date', de);
    if (ate) q = q.lte('transaction_date', ate);

    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data || []));
    if (!data || data.length < PAGINA_LEITURA) {
      return { linhas, truncado: false, permitidos: permitidos.length };
    }
  }
  console.warn(`[celcoin] ${tabela}: leitura truncada no teto de ${TETO_LEITURA} linhas`);
  return { linhas, truncado: true, permitidos: permitidos.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* corpo vazio vira ação desconhecida logo abaixo */
  }
  const action = String(body.action || '').trim();

  // `health` e `egress_diag` são diagnóstico e não tocam em dado de ninguém:
  // ficam abertos de propósito, para conseguir medir sem sessão.
  const ABERTAS = new Set(['health', 'egress_diag']);
  // Guardado fora do `if` porque `list_transactions` precisa saber QUEM chamou:
  // a identidade vem do JWT, nunca do corpo.
  let quem: { ok: boolean; userId: string | null; via: string } = { ok: true, userId: null, via: 'aberta' };
  if (!ABERTAS.has(action)) {
    quem = await autorizar(req);
    if (!quem.ok) return json({ success: false, error: 'não autorizado', via: quem.via }, 401);
  }

  try {
    switch (action) {
      case 'health': {
        const eps = endpoints();
        return json({
          success: true,
          env: eps.tier,
          hosts: { onboard: eps.onboard, smartkeys: eps.smartkeys, openkeys: eps.openkeys, data: eps.data },
          sandbox_hosts_sao_inferidos: eps.tier === 'sandbox',
          has_client_id: !!Deno.env.get('CELCOIN_CLIENT_ID'),
          has_client_secret: !!Deno.env.get('CELCOIN_CLIENT_SECRET'),
          redirect_url: Deno.env.get('CELCOIN_REDIRECT_URL') || null,
          // Formato da credencial, para conferir contra o portal sem expor valor.
          // Comprimento e presença de espaço não são segredo, e são o que separa
          // "colei errado" de "o secret foi rotacionado".
          formato_credencial: (() => {
            const id = Deno.env.get('CELCOIN_CLIENT_ID') || '';
            const sec = Deno.env.get('CELCOIN_CLIENT_SECRET') || '';
            return {
              client_id_tamanho: id.length,
              client_id_tem_espaco: id !== id.trim(),
              client_id_inicio: id.slice(0, 4),
              client_secret_tamanho: sec.length,
              client_secret_tem_espaco: sec !== sec.trim(),
              iguais: !!id && id === sec,
            };
          })(),
          roda_em: 'supabase-edge/kmedldlepwiityjsdahz',
        });
      }

      // Sonda de borda: IP de saída + chamada de token com credencial inválida
      // LITERAL. 400 invalid_client = chega na aplicação; HTML = barrado antes.
      case 'egress_diag': {
        const ipr = await request('GET', 'https://api.ipify.org?format=json');
        const pr = await request('POST', `${endpoints().onboard}/api/portal/onboard/v2/token`, {
          headers: { Authorization: `Basic ${btoa('probe:probe')}` },
        });
        const raw = typeof pr.body === 'string' ? pr.body : JSON.stringify(pr.body ?? '');
        return json({
          success: true,
          egress_ip: (ipr.body as any)?.ip ?? null,
          probe_status: pr.status,
          probe_e_html: /^\s*<(!doctype|html)/i.test(raw),
          chega_na_aplicacao: pr.status === 400 && raw.includes('invalid_client'),
        });
      }

      case 'list_brands': {
        const brands = (await fetchBrands())
          .map((b) => ({ brand_id: brandKey(b), name: brandLabel(b) }))
          .filter((b) => b.brand_id && b.name)
          .sort((a, b) => a.name!.localeCompare(b.name!, 'pt-BR'));
        return json({ success: true, brands });
      }

      case 'create_consent': {
        const userId = String(body.user_id || '').trim();
        const cpf = String(body.cpf || '').replace(/\D/g, '');
        const cnpj = String(body.cnpj || '').replace(/\D/g, '');
        const brandId = String(body.brand_id || '').trim();

        if (!userId || !brandId || !cpf) {
          return json(
            { success: false, error: 'user_id, brand_id e cpf (do representante legal) são obrigatórios' },
            400,
          );
        }
        if (cpf.length !== 11) return json({ success: false, error: 'cpf inválido' }, 400);

        const isPJ = cnpj.length === 14;
        console.log(`[celcoin] create_consent brand=${brandId} cpf=${maskDoc(cpf)}${isPJ ? ` cnpj=${maskDoc(cnpj)}` : ''}`);

        // Cada tentativa de link gera um consentimento novo na Celcoin, e o
        // `request_uri` do PAR dura poucos minutos -- foi assim que 18/08/2026
        // acumulou SEIS órfãos do mesmo banco em cinco horas. O link antigo
        // deixa de valer no instante em que este é gerado, então derrubar os
        // AWAITING anteriores DESTE banco e DESTE usuário é o comportamento
        // correto, não uma limpeza oportunista. Nunca toca em AUTHORISED.
        // Best-effort: falhar aqui não pode impedir a conexão nova.
        if (body.revogar_anteriores !== false) {
          try {
            const { data: antigos } = await ext
              .from('celcoin_consents')
              .select('consent_id, status')
              .eq('user_id', userId)
              .eq('brand_id', brandId);
            for (const a of antigos || []) {
              const st = normalizarStatus(a.status);
              if (st === 'AUTHORISED' || st === 'REVOKED' || st === 'ABANDONED' || !a.consent_id) continue;
              const rr = await descartar(String(a.consent_id));
              console.log(`[celcoin] create_consent: anterior ${String(a.consent_id).slice(0, 8)}… -> ${rr.desfecho} (HTTP ${rr.status})`);
            }
          } catch (e) {
            console.warn('[celcoin] falha ao revogar consentimentos anteriores:', e instanceof Error ? e.message : e);
          }
        }

        const token = await getAdminToken();
        const expirationDateTime = expirationFromMonths(body.expiration_months);
        let result: Result | null = null;
        let used: string[] = [];

        for (const rung of PERMISSION_LADDER) {
          // Consent PJ usa CUSTOMERS_BUSINESS_*; mandar os PERSONAL_* junto com
          // businessEntity toma 422 PERMISSOES_PJ_INCORRETAS (visto no Bradesco PJ).
          used = isPJ
            ? [...new Set(rung.map((p) => p.replace('CUSTOMERS_PERSONAL_', 'CUSTOMERS_BUSINESS_')))]
            : rung;

          // NÃO vai redirectUrl: o endereço de volta é cadastrado na Celcoin,
          // amarrado à credencial. O gateway do Quitepay, validado em 3 bancos,
          // não manda esse campo. CELCOIN_REDIRECT_URL é só registro do que foi
          // cadastrado lá.
          const payload: Record<string, unknown> = {
            brandId,
            data: {
              loggedUser: { document: { identification: cpf, rel: 'CPF' } },
              permissions: used,
              expirationDateTime,
              ...(isPJ ? { businessEntity: { document: { identification: cnpj, rel: 'CNPJ' } } } : {}),
            },
          };

          result = await request('POST', consentUrl(), {
            headers: { Authorization: `Bearer ${token}` },
            body: payload,
          });

          if (result.ok || !isPermissionSetError(result)) break;
          console.warn('[celcoin] transmissora recusou o conjunto de permissões, descendo um degrau');
        }

        if (!result || !result.ok) {
          return json({ success: false, status: result?.status, error: result?.body?.errors ?? result?.body }, 502);
        }

        const r = result.body || {};
        const consentId = r.consentId ?? r.id ?? r.data?.consentId ?? null;
        const authorizationUrl = r.authorizationUrl ?? r.redirectUrl ?? r.data?.authorizationUrl ?? null;

        const { error: dbErr } = await ext.from('celcoin_consents').upsert(
          {
            user_id: userId,
            consent_id: consentId,
            brand_id: brandId,
            brand_name: await resolveBrandName(brandId),
            status: normalizarStatus(r.status ?? r.data?.status ?? 'AWAITING_AUTHORISATION'),
            permissions: used,
            expires_at: expirationDateTime,
            celcoin_env: endpoints().tier,
          },
          { onConflict: 'consent_id' },
        );
        if (dbErr) console.error('[celcoin] falha ao gravar consentimento:', dbErr.message);

        return json({ success: true, consent_id: consentId, authorization_url: authorizationUrl, permissions: used });
      }

      case 'consent_status': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) return json({ success: false, error: 'consent_id é obrigatório' }, 400);

        const token = await getAdminToken();
        const r = await request('GET', consentUrl(consentId), { headers: { Authorization: `Bearer ${token}` } });
        // Grava já normalizado, para o banco não guardar as duas grafias.
        const status = r.body?.status ?? r.body?.data?.status ?? null;
        const statusNorm = status ? normalizarStatus(status) : null;

        if (statusNorm) {
          await ext
            .from('celcoin_consents')
            .update({
              status: statusNorm,
              authorized_at: autorizado(statusNorm) ? new Date().toISOString() : null,
              updated_at: new Date().toISOString(),
            })
            .eq('consent_id', consentId);
        }
        return json({ success: r.ok, consent_status: statusNorm, detail: r.body });
      }

      case 'list_resources': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) return json({ success: false, error: 'consent_id é obrigatório' }, 400);
        return json({ success: true, resources: await fetchPaged(consentId, 'resources/v3/resources') });
      }

      case 'list_accounts': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) return json({ success: false, error: 'consent_id é obrigatório' }, 400);
        return json({
          success: true,
          accounts: await fetchPaged(consentId, 'accounts/v2/accounts'),
          credit_cards: await fetchPaged(consentId, 'credit-cards-accounts/v2/accounts'),
        });
      }

      case 'sync_transactions': {
        const consentId = String(body.consent_id || '').trim();
        const userId = String(body.user_id || '').trim();
        if (!consentId || !userId) {
          return json({ success: false, error: 'consent_id e user_id são obrigatórios' }, 400);
        }
        try {
          return json({ success: true, ...(await sincronizar(consentId, userId, { from: body.from, to: body.to })) });
        } catch (e) {
          if (e instanceof NaoAutorizado) return json({ success: false, error: e.message }, 409);
          throw e;
        }
      }

      // Percorre TODOS os consentimentos autorizados. É o que o cron chama: um
      // agendamento não tem como saber quais consentimentos existem, e mandar
      // consent_id fixo no cron quebraria calado no dia em que ele fosse
      // renovado. Uma conexão que falha NÃO derruba as outras -- foi assim que
      // a Pluggy morreu calada por 5 meses, e um lote que aborta no primeiro
      // erro repete a história.
      case 'sync_all': {
        const consentesRes = await ext
          .from('celcoin_consents')
          .select('consent_id, user_id, status, brand_name')
          .order('created_at', { ascending: false });
        if (consentesRes.error) throw new Error(consentesRes.error.message);

        const alvos = (consentesRes.data || []).filter((c) => autorizado(c.status) && c.consent_id && c.user_id);
        const resultados: any[] = [];
        let bank = 0;
        let card = 0;

        for (const c of alvos) {
          try {
            const r = await sincronizar(String(c.consent_id), String(c.user_id), { from: body.from, to: body.to });
            bank += r.bank_transactions;
            card += r.credit_card_transactions;
            resultados.push({ consent_id: c.consent_id, brand_name: c.brand_name, ok: true, ...r });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[celcoin] sync_all: consent=${c.consent_id} falhou: ${msg}`);
            resultados.push({ consent_id: c.consent_id, brand_name: c.brand_name, ok: false, erro: msg.slice(0, 300) });
          }
        }

        const falhas = resultados.filter((r) => !r.ok).length;
        console.log(
          `[celcoin] sync_all: ${alvos.length} consentimento(s), ${falhas} falha(s), ${bank} bancárias, ${card} de cartão`,
        );
        // success reflete o LOTE. Se alguma conexão falhou, quem monitora tem que
        // ver isso sem abrir o corpo da resposta.
        return json({ success: falhas === 0, consentimentos: alvos.length, falhas, bank_transactions: bank, credit_card_transactions: card, resultados });
      }

      // Revogar é IRREVERSÍVEL na Celcoin. A trava do AUTHORISED existe porque a
      // tela mostra os consentimentos todos com o mesmo nome de banco, e o
      // clique errado mataria a conexão que sustenta a conciliação.
      case 'revoke_consent': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) return json({ success: false, error: 'consent_id é obrigatório' }, 400);

        const { data: row } = await ext
          .from('celcoin_consents')
          .select('status, brand_name')
          .eq('consent_id', consentId)
          .maybeSingle();

        if (row && autorizado(row.status) && body.force !== true) {
          return json(
            {
              success: false,
              error: 'Este consentimento está AUTHORISED e sustenta a sincronização. Revogar exige force:true.',
            },
            409,
          );
        }

        const r = await descartar(consentId);
        console.log(`[celcoin] revoke_consent ${consentId.slice(0, 8)}… -> ${r.desfecho} (HTTP ${r.status})`);
        // Sempre 200: o descarte local aconteceu nos dois desfechos. Quem chama
        // precisa do `desfecho` para dizer a verdade na tela, não de um erro.
        return json({ success: true, desfecho: r.desfecho, status: r.status });
      }

      case 'list_connections': {
        const userId = String(body.user_id || '').trim();
        let q = ext.from('celcoin_consents').select('*').order('created_at', { ascending: false });
        if (userId) q = q.eq('user_id', userId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);

        // Data do último lançamento POR CONEXÃO. É o único medidor que percebe
        // a conexão que responde 200 e não traz nada -- `last_sync_at` sobe no
        // fim de todo sync sem erro, inclusive trazendo zero linha, então com o
        // cron rodando 3x/dia ele nunca envelhece. Foi assim que a Pluggy ficou
        // 5 meses parada com as 3 conexões dizendo `status: UPDATED`.
        //
        // Calculado aqui e não no front porque `bank_transactions` e
        // `credit_card_transactions` são das poucas tabelas do Externo com RLS
        // de verdade (`user_id = auth.uid()`), e a sessão que o front mantém lá
        // é anônima: ler de lá devolveria vazio, não erro -- que é a forma mais
        // cara de errar. Só as conexões que já sincronizaram entram na conta;
        // as descartadas e as que nunca autorizaram não têm o que medir.
        const consents = data || [];
        const medir = consents.filter((c: any) => c.last_sync_at);
        const ultimos = new Map<string, string>();
        await Promise.all(
          medir.map(async (c: any) => {
            const [banco, cartao] = await Promise.all(
              (['bank_transactions', 'credit_card_transactions'] as const).map((t) =>
                ext
                  .from(t)
                  .select('transaction_date')
                  .eq('provider', 'celcoin')
                  .eq('pluggy_item_id', c.consent_id)
                  .order('transaction_date', { ascending: false })
                  .limit(1)
                  .maybeSingle(),
              ),
            );
            // Datas em YYYY-MM-DD comparam direito como string.
            const datas = [banco?.data?.transaction_date, cartao?.data?.transaction_date].filter(Boolean) as string[];
            if (datas.length) ultimos.set(c.consent_id, datas.sort().at(-1)!);
          }),
        );

        return json({
          success: true,
          consents: consents.map((c: any) => ({
            ...c,
            last_transaction_date: ultimos.get(c.consent_id) ?? null,
          })),
        });
      }

      // Quem pode ver o quê, para a tela decidir se mostra a aba. A regra é
      // DERIVADA do dado (dono das linhas ou permissão concedida), nunca uma
      // lista de nomes no código: pessoa hardcoded em fonte não sai quando sai
      // da firma, e ninguém lembra de procurar por ela.
      case 'my_finance_access': {
        if (!quem.userId) return json({ success: false, error: 'sem identidade de usuário' }, 401);
        const meu = await uuidNoExterno(quem.userId);

        const contar = async (tabela: string, coluna: string) => {
          const { count } = await ext
            .from(tabela).select(coluna, { count: 'exact', head: true }).eq('user_id', meu.uuid);
          return count || 0;
        };
        const [donoBanco, donoCartao, permContas, permCartoes] = await Promise.all([
          contar('bank_transactions', 'id'),
          contar('credit_card_transactions', 'id'),
          contar('user_account_permissions', 'pluggy_account_id'),
          contar('user_card_permissions', 'card_last_digits'),
        ]);

        return json({
          success: true,
          bank: donoBanco > 0 || permContas > 0,
          card: donoCartao > 0 || permCartoes > 0,
          detalhe: { dono_banco: donoBanco, dono_cartao: donoCartao, contas: permContas, cartoes: permCartoes },
          identidade: { cloud: quem.userId, externo: meu.uuid, mapeado: meu.mapeado },
        });
      }

      // Extrato para a tela de conciliação. Existe porque as tabelas financeiras
      // moram no Externo e as telas liam a cópia homônima do Cloud, que nunca
      // recebeu uma linha da Celcoin -- 2.026 lançamentos corretos que não
      // apareciam em lugar nenhum. Ler do Externo direto do front não resolve: a
      // sessão que ele mantém lá é `signInAnonymously()`, e a policy é
      // `user_id = auth.uid()`, então a leitura volta VAZIA, não com erro.
      case 'list_transactions': {
        const tipo = String(body.kind || 'bank').trim();
        if (tipo !== 'bank' && tipo !== 'card') {
          return json({ success: false, error: "kind deve ser 'bank' ou 'card'" }, 400);
        }
        const tabela = tipo === 'bank' ? 'bank_transactions' : 'credit_card_transactions';
        const de = body.from ? String(body.from).slice(0, 10) : null;
        const ate = body.to ? String(body.to).slice(0, 10) : null;

        // A identidade vem do JWT e SÓ do JWT. Aceitar `user_id` do corpo aqui
        // deixaria qualquer sessão válida ler o extrato de qualquer colega --
        // é a diferença entre autenticar e autorizar.
        let meu: { uuid: string; mapeado: boolean };
        if (quem.userId) {
          meu = await uuidNoExterno(quem.userId);
        } else if (quem.via === 'service_role') {
          // Chamada servidor-a-servidor manda o uuid DO EXTERNO já resolvido.
          const informado = String(body.user_id || '').trim();
          if (!informado) {
            return json({ success: false, error: 'service_role precisa mandar user_id (uuid do Externo)' }, 400);
          }
          meu = { uuid: informado, mapeado: true };
        } else {
          return json({ success: false, error: 'sem identidade de usuário' }, 401);
        }

        const r = await lerTransacoes(tabela as any, meu.uuid, de, ate);
        return json({
          success: true,
          transactions: r.linhas,
          // Devolvido para que "não apareceu nada" seja diagnosticável do lado
          // de fora: sem isto, uuid não mapeado e conta sem movimento são a
          // mesma tela vazia.
          identidade: { cloud: quem.userId, externo: meu.uuid, mapeado: meu.mapeado },
          contas_permitidas: r.permitidos,
          truncado: r.truncado,
        });
      }

      default:
        return json(
          {
            success: false,
            error: `Ação desconhecida: '${action}'`,
            available: [
              'health',
              'egress_diag',
              'list_brands',
              'list_transactions',
              'my_finance_access',
              'create_consent',
              'consent_status',
              'list_resources',
              'list_accounts',
              'sync_transactions',
              'sync_all',
              'revoke_consent',
              'list_connections',
            ],
          },
          400,
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[celcoin] ${action} falhou:`, message);
    return json({ success: false, error: message }, 500);
  }
});

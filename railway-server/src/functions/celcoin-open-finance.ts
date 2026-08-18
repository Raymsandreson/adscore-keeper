// Integração Open Finance / Celcoin Financial Data — substitui a Pluggy na conciliação.
//
// A arquitetura aqui NÃO veio da doc pública da Celcoin: veio do
// celcoin-data-gateway do Quitepay, que já roda contra a Celcoin em produção
// (validações datadas de 28/07 e 07/08/2026 contra BB, Bradesco PJ e Nubank).
// A doc aberta descreve a stack Baas (/baas/v1/open/dat/...), que é outra coisa.
// O que vale é a stack smartkeys/openkeys abaixo.
//
// SÃO DOIS TOKENS, em hosts diferentes, que não se substituem:
//   admin  POST {onboard}/api/portal/onboard/v2/token
//          Authorization: Basic base64(client_id:client_secret), SEM body. ~1h.
//          Serve só para criar/ler/revogar consentimento. Nunca lê dados.
//   rpt    POST {data}/api/open-keys/token
//          form-urlencoded, client_id + client_secret + scope=consent:<id>. ~5min.
//          Serve só para ler dados. A Celcoin só o emite depois que o consent
//          está AUTHORISED no banco detentor. Nunca cria consent.
//
// O consentimento NÃO viaja em header nas chamadas de dados: ele está embutido
// no escopo do rpt_token. Os GETs levam só Accept e Authorization: Bearer.
//
// mTLS: a doc genérica da Celcoin diz que é obrigatório em produção, mas o
// gateway do Quitepay roda numa edge Deno (que não faz client certificate) e
// está validado em produção nesta mesma stack — ou seja, aqui a Celcoin absorve
// o mTLS com o ecossistema. O suporte a cert continua abaixo, opcional, para o
// caso de exigirem; é uma das razões de isto viver no Railway e não numa edge.
//
// Env (Railway):
//   CELCOIN_CLIENT_ID, CELCOIN_CLIENT_SECRET   obrigatórios
//   CELCOIN_ENV                                'sandbox' (default) | 'production'
//   CELCOIN_HOST_ONBOARD / _SMARTKEYS / _OPENKEYS / _DATA   override por host (ver aviso de sandbox)
//   CELCOIN_CERT_PEM, CELCOIN_KEY_PEM          mTLS opcional
//   CELCOIN_CA_PEM, CELCOIN_KEY_PASSPHRASE     opcionais
//   CELCOIN_REDIRECT_URL                       callback pós-autorização no app
import type { RequestHandler } from 'express';
import https from 'node:https';
import { supabase as ext } from '../lib/supabase';

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;
const DATA_RETRIES = 3; // ingestão assíncrona — ver comentário em fetchData()

// ATENÇÃO: só os hosts de produção são conhecidos. Os de sandbox são derivados
// do padrão de nome (production -> sandbox) e NUNCA foram testados — é a mesma
// ressalva que o gateway do Quitepay carrega. Confirmar com a Celcoin junto com
// a credencial de sandbox, e corrigir por CELCOIN_HOST_* se divergir.
function endpoints() {
  const production = ['production', 'prod'].includes((process.env.CELCOIN_ENV || 'sandbox').toLowerCase());
  const tier = production ? 'production' : 'sandbox';
  return {
    onboard: process.env.CELCOIN_HOST_ONBOARD || `https://onboard-ui.smartkeys.celcoin.${tier}.fsapps.app`,
    smartkeys: process.env.CELCOIN_HOST_SMARTKEYS || `https://api-smartkeys.celcoin.${tier}.fsapps.app`,
    openkeys: process.env.CELCOIN_HOST_OPENKEYS || `https://api-openkeys.celcoin.${tier}.fsapps.app`,
    data: process.env.CELCOIN_HOST_DATA || `https://api.v3.celcoin.${tier}.fsapps.app`,
    tier,
  };
}

// Lista de bancos participantes. Fica no host openkeys (compartilhado com ITP) e
// usa o token admin. A criação de consent não devolve brandName, então o nome
// amigável sai daqui — falha silenciosa, é cosmético e não pode derrubar o consent.
async function fetchBrands(): Promise<any[]> {
  const token = await getAdminToken();
  const r = await request('GET', `${endpoints().openkeys}/open-keys-itp/api/brands/v1/brands?type=DATA`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Celcoin brands falhou (HTTP ${r.status}): ${motivo(r)}`);
  const raw = r.body;
  return Array.isArray(raw) ? raw : raw?.content ?? raw?.items ?? raw?.data ?? [];
}

function brandLabel(b: any): string | null {
  return b?.CustomerFriendlyName ?? b?.name ?? null;
}
function brandKey(b: any): string | null {
  return b?.AuthorisationServerId ?? b?.brandId ?? b?.id ?? null;
}

async function resolveBrandName(brandId: string): Promise<string | null> {
  try {
    const hit = (await fetchBrands()).find((b) => brandKey(b) === brandId);
    return hit ? brandLabel(hit) : null;
  } catch {
    return null;
  }
}

// Núcleo validado em produção pelo Quitepay. Conciliação não lê operações de
// crédito nem investimentos: cada permissão a mais é outra linha na tela do
// banco para o titular aprovar.
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
// Degrau de baixo: só o que a conciliação precisa de fato. Se a transmissora
// recusar o conjunto de cima, desce para cá em vez de devolver erro.
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

// Grupo de recurso -> prefixo da permissão. Serve para separar 404 transitório
// (ingestão em andamento) de 404 permanente (grupo fora do consentimento).
const GROUP_PERM: Record<string, string> = {
  accounts: 'ACCOUNTS',
  'credit-cards-accounts': 'CREDIT_CARDS',
  resources: 'RESOURCES',
  customers: 'CUSTOMERS',
};

function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

let agentCache: https.Agent | null = null;
function getAgent(): https.Agent {
  if (agentCache) return agentCache;
  const cert = process.env.CELCOIN_CERT_PEM;
  const key = process.env.CELCOIN_KEY_PEM;
  const ca = process.env.CELCOIN_CA_PEM;
  agentCache = new https.Agent({
    keepAlive: true,
    cert: cert ? normalizePem(cert) : undefined,
    key: key ? normalizePem(key) : undefined,
    ca: ca ? normalizePem(ca) : undefined,
    passphrase: process.env.CELCOIN_KEY_PASSPHRASE || undefined,
  });
  return agentCache;
}

interface Result<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

function request(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; form?: URLSearchParams } = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) };

    let payload: string | undefined;
    if (opts.form) {
      payload = opts.form.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (opts.body !== undefined && opts.body !== null) {
      payload = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        agent: getAgent(),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: any = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            /* mantém texto cru */
          }
          const status = res.statusCode || 0;
          // Corpo nunca vai pro log: são dados Open Finance regulados (CPF/CNPJ,
          // saldos, transações). Só formato e tamanho.
          console.log(`[celcoin] ${method} ${u.pathname} -> ${status} (${raw.length}b)`);
          resolve({ ok: status >= 200 && status < 300, status, body: parsed });
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`Celcoin timeout após ${REQUEST_TIMEOUT_MS}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Motivo legível de uma falha upstream. A Celcoin distingue "credencial inválida"
// (400 invalid_client) de "credencial reconhecida mas barrada" (403) SÓ no corpo:
// sem ele toda falha vira o mesmo "HTTP 4xx" e não dá para agir. Sequências longas
// de dígitos são mascaradas porque o corpo de erro dos endpoints de dados pode
// ecoar documento — mesma regra do log lá em cima.
function motivo(r: Result): string {
  const raw = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? '');
  if (!raw || raw === '""' || raw === 'null') return 'corpo vazio';
  return raw.replace(/\d{8,}/g, (d) => `***${d.slice(-2)}`).slice(0, 300);
}

function credentials() {
  const clientId = process.env.CELCOIN_CLIENT_ID;
  const clientSecret = process.env.CELCOIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing CELCOIN_CLIENT_ID or CELCOIN_CLIENT_SECRET');
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

// --- Token admin: Basic, sem body. Só mexe em consentimento. ---
let adminToken: { token: string; expiresAt: number } | null = null;
async function getAdminToken(): Promise<string> {
  if (adminToken && Date.now() < adminToken.expiresAt) return adminToken.token;
  const { clientId, clientSecret } = credentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const r = await request('POST', `${endpoints().onboard}/api/portal/onboard/v2/token`, {
    headers: { Authorization: `Basic ${basic}` },
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

function consentUrl(consentId?: string): string {
  const base = `${endpoints().smartkeys}/api/smart-keys/data-reception/v1/consents`;
  return consentId ? `${base}/${encodeURIComponent(consentId)}` : base;
}

// A transmissora recusa conjuntos de permissão com códigos variados
// (COMBINACAO_PERMISSOES_INCORRETA, PERMISSAO/PERMISSION_*). Ambos degradam:
// descer um degrau resolve. Erro de outra natureza (brand inválido, auth) não.
function isPermissionSetError(r: Result): boolean {
  const errors = r.body?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e: any) => {
    const code = `${e?.code ?? ''} ${e?.title ?? ''}`.toUpperCase();
    return code.includes('COMBINACAO') || code.includes('PERMISS');
  });
}

// A primeira leitura de um recurso costuma vir 404 (corpo vazio ou
// LINK_NAO_ENCONTRADO) enquanto a Celcoin ainda busca no detentor. Retentar com
// rpt_token novo re-dispara a busca. Sem isso o extrato volta vazio e parece
// conta sem movimento. O mesmo 404 é PERMANENTE quando o grupo não está no
// consentimento ou quando o path não existe (code NOT_FOUND) — daí a distinção.
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
      if (r.status === 404) return out; // recurso ausente/não consentido: não é erro fatal do sync
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

function expirationFromMonths(months?: number): string {
  const m = Math.min(Math.max(Number(months) || 12, 1), 12); // teto regulatório: 1 ano
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toISOString();
}

function toDateOnly(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function toTimeOnly(v: unknown): string | null {
  const m = String(v ?? '').match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

// Piso da janela de sincronização.
//
// A Pluggy parou em 18/03/2026, mas os ~8 mil lançamentos dela continuam nestas
// mesmas tabelas, e a tela de conciliação NÃO filtra por provider
// (BankTransactionsView lê o período inteiro). Como a UNIQUE é
// (provider, pluggy_transaction_id), a mesma despesa vinda da Celcoin entra como
// linha nova em vez de atualizar a da Pluggy — o financeiro veria tudo em dobro
// no intervalo coberto pelos dois. Daí a janela começar no dia seguinte ao
// último lançamento já gravado, que também torna as sincronizações seguintes
// incrementais em vez de repuxar um ano toda vez.
async function syncFloor(table: 'bank_transactions' | 'credit_card_transactions', userId: string): Promise<string> {
  const { data } = await ext
    .from(table)
    .select('transaction_date')
    .eq('user_id', userId)
    .order('transaction_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const last = toDateOnly(data?.transaction_date);
  const d = new Date();
  if (last) {
    d.setTime(Date.parse(`${last}T00:00:00Z`));
    d.setUTCDate(d.getUTCDate() + 1);
  } else {
    d.setUTCMonth(d.getUTCMonth() - 12); // sem histórico: 12 meses, teto usual das transmissoras
  }
  return d.toISOString().slice(0, 10);
}

// No Open Finance o sinal vem em creditDebitType, não no valor.
function signedAmount(tx: any): number {
  const raw = Number(tx?.transactionAmount?.amount ?? tx?.amount?.amount ?? tx?.amount ?? 0);
  const type = String(tx?.creditDebitType || tx?.creditDebitIndicator || '').toUpperCase();
  return type.startsWith('DEB') ? -Math.abs(raw) : Math.abs(raw);
}

export const handler: RequestHandler = async (req, res) => {
  const body = req.body || {};
  const action = String(body.action || '').trim();

  try {
    switch (action) {
      case 'health': {
        const eps = endpoints();
        res.json({
          success: true,
          env: eps.tier,
          hosts: { onboard: eps.onboard, smartkeys: eps.smartkeys, openkeys: eps.openkeys, data: eps.data },
          sandbox_hosts_sao_inferidos: eps.tier === 'sandbox',
          has_client_id: !!process.env.CELCOIN_CLIENT_ID,
          has_client_secret: !!process.env.CELCOIN_CLIENT_SECRET,
          has_mtls_cert: !!process.env.CELCOIN_CERT_PEM && !!process.env.CELCOIN_KEY_PEM,
          redirect_url: process.env.CELCOIN_REDIRECT_URL || null,
        });
        return;
      }

      // Bancos participantes, para o titular escolher onde autorizar.
      case 'list_brands': {
        const brands = (await fetchBrands())
          .map((b) => ({ brand_id: brandKey(b), name: brandLabel(b) }))
          .filter((b) => b.brand_id && b.name)
          .sort((a, b) => a.name!.localeCompare(b.name!, 'pt-BR'));
        res.json({ success: true, brands });
        return;
      }

      // Cria o consentimento e devolve a URL do banco para o titular autorizar.
      // Sobe a escada de permissões: se a transmissora recusar o conjunto, desce um degrau.
      case 'create_consent': {
        const userId = String(body.user_id || '').trim();
        const cpf = String(body.cpf || '').replace(/\D/g, '');
        const cnpj = String(body.cnpj || '').replace(/\D/g, '');
        const brandId = String(body.brand_id || '').trim();

        if (!userId || !brandId || !cpf) {
          res.status(400).json({
            success: false,
            // O loggedUser do Open Finance é SEMPRE pessoa física, mesmo em conta PJ:
            // quem autoriza é o representante legal. O CNPJ entra como businessEntity.
            error: 'user_id, brand_id e cpf (do representante legal) são obrigatórios',
          });
          return;
        }
        if (cpf.length !== 11) {
          res.status(400).json({ success: false, error: 'cpf inválido' });
          return;
        }

        const isPJ = cnpj.length === 14;
        console.log(`[celcoin] create_consent brand=${brandId} cpf=${maskDoc(cpf)}${isPJ ? ` cnpj=${maskDoc(cnpj)}` : ''}`);

        const token = await getAdminToken();
        const expirationDateTime = expirationFromMonths(body.expiration_months);
        let result: Result | null = null;
        let used: string[] = [];

        for (const rung of PERMISSION_LADDER) {
          // Consent PJ usa os agrupamentos de cadastro CUSTOMERS_BUSINESS_*.
          // Mandar os PERSONAL_* junto com businessEntity toma 422
          // PERMISSOES_PJ_INCORRETAS (visto no Bradesco PJ em produção).
          used = isPJ
            ? [...new Set(rung.map((p) => p.replace('CUSTOMERS_PERSONAL_', 'CUSTOMERS_BUSINESS_')))]
            : rung;

          // NÃO vai redirectUrl aqui. O endereço de volta é cadastrado na Celcoin,
          // amarrado à credencial — o gateway do Quitepay, validado em produção em
          // 3 bancos, não manda esse campo e recebe o cliente de volta em rota
          // própria com ?ticket=<jwt>&state=<consentId>. Mandar um campo que a API
          // não espera arrisca 422 na primeira chamada real. CELCOIN_REDIRECT_URL
          // continua existindo só como registro do que foi cadastrado lá.
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
          res.status(502).json({ success: false, status: result?.status, error: result?.body?.errors ?? result?.body });
          return;
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
            status: r.status ?? r.data?.status ?? 'AWAITING_AUTHORISATION',
            permissions: used,
            expires_at: expirationDateTime,
            celcoin_env: endpoints().tier,
          },
          { onConflict: 'consent_id' },
        );
        if (dbErr) console.error('[celcoin] falha ao gravar consentimento:', dbErr.message);

        res.json({ success: true, consent_id: consentId, authorization_url: authorizationUrl, permissions: used });
        return;
      }

      case 'consent_status': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) {
          res.status(400).json({ success: false, error: 'consent_id é obrigatório' });
          return;
        }
        const token = await getAdminToken();
        const r = await request('GET', consentUrl(consentId), { headers: { Authorization: `Bearer ${token}` } });
        const status = r.body?.status ?? r.body?.data?.status ?? null;

        if (status) {
          await ext
            .from('celcoin_consents')
            .update({
              status,
              authorized_at: status === 'AUTHORISED' ? new Date().toISOString() : null,
              updated_at: new Date().toISOString(),
            })
            .eq('consent_id', consentId);
        }
        res.json({ success: r.ok, consent_status: status, detail: r.body });
        return;
      }

      case 'list_resources': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) {
          res.status(400).json({ success: false, error: 'consent_id é obrigatório' });
          return;
        }
        res.json({ success: true, resources: await fetchPaged(consentId, 'resources') });
        return;
      }

      case 'list_accounts': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) {
          res.status(400).json({ success: false, error: 'consent_id é obrigatório' });
          return;
        }
        res.json({
          success: true,
          accounts: await fetchPaged(consentId, 'accounts'),
          credit_cards: await fetchPaged(consentId, 'credit-cards-accounts/accounts'),
        });
        return;
      }

      // Extrato de conta + transações de fatura, gravados com provider='celcoin'.
      // Mesmas tabelas da Pluggy: a coluna provider é o que deixa as duas conviverem.
      case 'sync_transactions': {
        const consentId = String(body.consent_id || '').trim();
        const userId = String(body.user_id || '').trim();
        if (!consentId || !userId) {
          res.status(400).json({ success: false, error: 'consent_id e user_id são obrigatórios' });
          return;
        }

        const { data: consentRow } = await ext
          .from('celcoin_consents')
          .select('permissions, status')
          .eq('consent_id', consentId)
          .maybeSingle();

        if (consentRow && consentRow.status !== 'AUTHORISED') {
          res.status(409).json({
            success: false,
            error: `Consentimento está ${consentRow.status}, não AUTHORISED — a Celcoin não emite rpt_token nesse estado.`,
          });
          return;
        }
        const permissions: string[] | null = Array.isArray(consentRow?.permissions)
          ? (consentRow!.permissions as string[])
          : null;

        const to = body.to ? String(body.to) : undefined;
        // Sem `from` explícito, cada tabela retoma de onde parou (ver syncFloor).
        const bankFrom = body.from ? String(body.from) : await syncFloor('bank_transactions', userId);
        const cardFrom = body.from ? String(body.from) : await syncFloor('credit_card_transactions', userId);
        let bankCount = 0;
        let cardCount = 0;

        for (const acc of await fetchPaged(consentId, 'accounts', {}, permissions)) {
          const accountId = acc?.accountId;
          if (!accountId) continue;

          const txs = await fetchPaged(
            consentId,
            `accounts/${encodeURIComponent(accountId)}/transactions`,
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
              // O Open Finance não devolve categoria: a categorização passa a ser
              // nossa (MCC/IA). Ver src/utils/categoryTranslations.ts.
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
        for (const card of await fetchPaged(consentId, 'credit-cards-accounts/accounts', {}, permissions)) {
          const cardId = card?.creditCardAccountId;
          if (!cardId) continue;

          const bills = await fetchPaged(
            consentId,
            `credit-cards-accounts/accounts/${encodeURIComponent(cardId)}/bills`,
            // Aqui a data é do VENCIMENTO da fatura, não da compra: uma fatura de
            // abril carrega compras de março. O recorte por data de compra é o
            // filtro lá embaixo, não este — este só evita puxar fatura à toa.
            { fromDueDate: cardFrom, toDueDate: to },
            permissions,
          );

          for (const bill of bills) {
            const billId = bill?.billId;
            if (!billId) continue;

            const txs = await fetchPaged(
              consentId,
              `credit-cards-accounts/accounts/${encodeURIComponent(cardId)}/bills/${encodeURIComponent(billId)}/transactions`,
              {},
              permissions,
            );

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
          `[celcoin] sync consent=${consentId}: ${bankCount} bancárias (desde ${bankFrom}), ${cardCount} de cartão (desde ${cardFrom})`,
        );
        res.json({
          success: true,
          bank_transactions: bankCount,
          credit_card_transactions: cardCount,
          // Explícito na resposta porque a janela é calculada, não informada: sem
          // isto, um sync que traz 0 linhas é indistinguível de conta sem movimento.
          janela: { bank_from: bankFrom, card_from: cardFrom, to: to ?? null },
        });
        return;
      }

      case 'list_connections': {
        const userId = String(body.user_id || '').trim();
        let q = ext.from('celcoin_consents').select('*').order('created_at', { ascending: false });
        if (userId) q = q.eq('user_id', userId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        res.json({ success: true, consents: data || [] });
        return;
      }

      default:
        res.status(400).json({
          success: false,
          error: `Ação desconhecida: '${action}'`,
          available: [
            'health',
            'list_brands',
            'create_consent',
            'consent_status',
            'list_resources',
            'list_accounts',
            'sync_transactions',
            'list_connections',
          ],
        });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[celcoin] ${action} falhou:`, message);
    res.status(500).json({ success: false, error: message });
  }
};

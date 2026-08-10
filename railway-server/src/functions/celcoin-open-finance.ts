// Integração Open Finance / Celcoin Financial Data — substitui a Pluggy na conciliação.
//
// POR QUE AQUI E NÃO NUMA EDGE FUNCTION: a Celcoin exige certificado mTLS em produção
// ("em sandbox a ausência do certificado mTLS não bloqueia as requisições"). O fetch do
// Supabase Edge Runtime (Deno) não faz client certificate; o módulo https do Node faz.
// Por isso todo request sai daqui via https.request com um Agent que carrega cert+key.
// A edge `celcoin-gateway` que existe no Externo desde 29/04/2026 é código morto — ver
// supabase/functions/celcoin-gateway/README.md.
//
// FLUXO (doc: developers.celcoin.com.br, índice em /llms.txt):
//   1. POST /baas/v1/open/dat/consents           -> devolve consent id + authorizationUrl
//   2. titular é redirecionado à authorizationUrl, autentica no banco e aprova
//   3. volta na nossa redirectUrl com o interactionId; consentimento vira AUTHORISED
//   4. GET  /baas/v1/open/dat/resources          -> obrigatório em todo consentimento
//   5. GET  /baas/v1/open/dat/accounts|credit-cards-accounts/... -> os dados
//
// TRÊS PONTOS NÃO PUBLICADOS na doc aberta, isolados em env var para ajuste rápido quando
// a credencial de sandbox chegar (NÃO chutar: confirmar com o suporte da Celcoin):
//   - CELCOIN_AUTH_PATH      : caminho do token OAuth (a doc só diz "POST para a URL base")
//   - CELCOIN_CONSENT_HEADER : como o consentimento viaja nas chamadas de dados
//   - se o consumo usa o token de client_credentials ou um token trocado por consentimento
//
// Env (Railway):
//   CELCOIN_CLIENT_ID, CELCOIN_CLIENT_SECRET   obrigatórios
//   CELCOIN_ENV                                'sandbox' (default) | 'production'
//   CELCOIN_BASE_URL                           override da base (opcional)
//   CELCOIN_AUTH_PATH                          default '/token'
//   CELCOIN_CERT_PEM, CELCOIN_KEY_PEM          mTLS — obrigatórios em produção
//   CELCOIN_CA_PEM, CELCOIN_KEY_PASSPHRASE     opcionais
//   CELCOIN_CONSENT_HEADER                     default 'consentId'
//   CELCOIN_REDIRECT_URL                       callback pós-autorização no app
import type { RequestHandler } from 'express';
import https from 'node:https';
import { supabase as ext } from '../lib/supabase';

const DAT = '/baas/v1/open/dat';
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000; // máximo aceito pela API
const MAX_PAGES = 100; // trava anti-loop, igual à que a integração Pluggy usa

// Permissões mínimas para conciliação: extrato de conta + fatura de cartão.
const DEFAULT_PERMISSIONS = [
  'ACCOUNTS_READ',
  'ACCOUNTS_BALANCES_READ',
  'ACCOUNTS_TRANSACTIONS_READ',
  'CREDIT_CARDS_ACCOUNTS_READ',
  'CREDIT_CARDS_ACCOUNTS_BILLS_READ',
  'CREDIT_CARDS_ACCOUNTS_BILLS_TRANSACTIONS_READ',
];

function baseUrl(): string {
  const override = process.env.CELCOIN_BASE_URL;
  if (override) return override.replace(/\/+$/, '');
  const env = (process.env.CELCOIN_ENV || 'sandbox').toLowerCase();
  return env === 'production' || env === 'prod'
    ? 'https://api.openfinance.celcoin.com.br'
    : 'https://tpp-sandbox.openfinance.celcoin.dev';
}

// Env var não guarda quebra de linha real: o PEM chega com \n literal.
function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

// Um Agent só para o processo todo — criar por request derruba o keep-alive e
// reprocessa o certificado a cada chamada.
let agentCache: https.Agent | null = null;
function getAgent(): https.Agent {
  if (agentCache) return agentCache;
  const cert = process.env.CELCOIN_CERT_PEM;
  const key = process.env.CELCOIN_KEY_PEM;
  const ca = process.env.CELCOIN_CA_PEM;
  const passphrase = process.env.CELCOIN_KEY_PASSPHRASE;
  agentCache = new https.Agent({
    keepAlive: true,
    cert: cert ? normalizePem(cert) : undefined,
    key: key ? normalizePem(key) : undefined,
    ca: ca ? normalizePem(ca) : undefined,
    passphrase: passphrase || undefined,
  });
  return agentCache;
}

interface CelcoinResponse<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

function request(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; form?: URLSearchParams } = {},
): Promise<CelcoinResponse> {
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
            /* resposta não-JSON: devolve texto cru */
          }
          const status = res.statusCode || 0;
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

// Token de client_credentials, cacheado até 60s antes de expirar.
let tokenCache: { token: string; expiresAt: number } | null = null;
async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const clientId = process.env.CELCOIN_CLIENT_ID;
  const clientSecret = process.env.CELCOIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing CELCOIN_CLIENT_ID or CELCOIN_CLIENT_SECRET');
  }

  const authPath = process.env.CELCOIN_AUTH_PATH || '/token';
  const res = await request('POST', `${baseUrl()}${authPath}`, {
    form: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });

  if (!res.ok) {
    // Nunca ecoar o corpo inteiro: pode devolver o client_secret enviado.
    throw new Error(`Celcoin auth falhou (HTTP ${res.status}) em ${authPath}. Confirme CELCOIN_AUTH_PATH com o suporte.`);
  }
  const token = res.body?.access_token;
  if (!token) throw new Error('Resposta de token sem access_token');

  const ttl = Number(res.body?.expires_in || 300);
  tokenCache = { token, expiresAt: Date.now() + Math.max(30, ttl - 60) * 1000 };
  return token;
}

// Chamada autenticada à API de dados. `consentId` viaja no header cujo nome é configurável.
async function api(
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown; consentId?: string } = {},
): Promise<CelcoinResponse> {
  const token = await getToken();
  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (opts.consentId) headers[process.env.CELCOIN_CONSENT_HEADER || 'consentId'] = opts.consentId;

  return request(method, url.toString(), { headers, body: opts.body });
}

// Percorre a paginação (page / page-size / pagination-key) e devolve tudo junto.
async function apiPaged(path: string, consentId: string, query: Record<string, string | number | undefined> = {}) {
  const out: any[] = [];
  let page = 1;
  let paginationKey: string | undefined;

  while (page <= MAX_PAGES) {
    const res = await api('GET', path, {
      consentId,
      query: { ...query, page, 'page-size': PAGE_SIZE, 'pagination-key': paginationKey },
    });
    if (!res.ok) throw new Error(`GET ${path} falhou (HTTP ${res.status})`);

    const data = res.body?.data;
    if (Array.isArray(data)) out.push(...data);
    else if (data) out.push(data);

    const next = res.body?.links?.next;
    if (!next) break;
    paginationKey = res.body?.meta?.paginationKey || undefined;
    page += 1;
  }

  if (page > MAX_PAGES) console.warn(`[celcoin] ${path}: parou em ${MAX_PAGES} páginas (trava anti-loop)`);
  return out;
}

// CPF/CNPJ nunca vai cru para log.
function maskDoc(doc: string): string {
  const clean = String(doc || '').replace(/\D/g, '');
  if (clean.length < 4) return '***';
  return `***${clean.slice(-4)}`;
}

function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toTimeOnly(value: unknown): string | null {
  if (!value) return null;
  const m = String(value).match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

// No Open Finance o sinal vem em creditDebitType (CREDITO/DEBITO), não no valor.
function signedAmount(tx: any): number {
  const raw = Number(tx?.transactionAmount?.amount ?? tx?.amount?.amount ?? tx?.amount ?? 0);
  const type = String(tx?.creditDebitType || tx?.creditDebitIndicator || '').toUpperCase();
  const magnitude = Math.abs(raw);
  return type.startsWith('DEB') ? -magnitude : magnitude;
}

export const handler: RequestHandler = async (req, res) => {
  const body = req.body || {};
  const action = String(body.action || '').trim();

  try {
    switch (action) {
      // Diagnóstico de configuração — diz o que existe, nunca o valor.
      case 'health': {
        res.json({
          success: true,
          env: (process.env.CELCOIN_ENV || 'sandbox').toLowerCase(),
          base_url: baseUrl(),
          auth_path: process.env.CELCOIN_AUTH_PATH || '/token',
          has_client_id: !!process.env.CELCOIN_CLIENT_ID,
          has_client_secret: !!process.env.CELCOIN_CLIENT_SECRET,
          has_mtls_cert: !!process.env.CELCOIN_CERT_PEM && !!process.env.CELCOIN_KEY_PEM,
          consent_header: process.env.CELCOIN_CONSENT_HEADER || 'consentId',
          redirect_url: process.env.CELCOIN_REDIRECT_URL || null,
        });
        return;
      }

      // Marcas/instituições disponíveis, para o usuário escolher o banco.
      case 'list_brands': {
        const r = await api('GET', '/open-keys/itp/api/v2/participants/brands');
        res.json({ success: r.ok, status: r.status, brands: r.body?.data ?? r.body });
        return;
      }

      // Passo 1: cria a intenção de compartilhamento. Devolve a URL para onde o
      // titular precisa ser mandado (site do banco — é a exceção de terceiros da
      // regra de não-redirecionar; o callback tem que devolver a pessoa ao ponto de partida).
      case 'create_consent': {
        const userId = String(body.user_id || '').trim();
        const document = String(body.document || '').replace(/\D/g, '');
        const brandId = String(body.brand_id || '').trim();
        if (!userId || !document || !brandId) {
          res.status(400).json({ success: false, error: 'user_id, document e brand_id são obrigatórios' });
          return;
        }

        const permissions: string[] = Array.isArray(body.permissions) && body.permissions.length
          ? body.permissions
          : DEFAULT_PERMISSIONS;
        const redirectUrl = body.redirect_url || process.env.CELCOIN_REDIRECT_URL;
        if (!redirectUrl) {
          res.status(400).json({ success: false, error: 'redirect_url ausente (defina CELCOIN_REDIRECT_URL)' });
          return;
        }

        console.log(`[celcoin] create_consent brand=${brandId} doc=${maskDoc(document)}`);

        const payload: Record<string, unknown> = {
          brandId,
          redirectUrl,
          data: {
            loggedUser: { document: { identification: document, rel: document.length > 11 ? 'CNPJ' : 'CPF' } },
            permissions,
          },
        };
        // A API recusa (422) data de expiração no passado e não aceita mais de 1 ano.
        if (body.expiration_date_time) {
          (payload.data as any).expirationDateTime = body.expiration_date_time;
        }

        const r = await api('POST', `${DAT}/consents`, { body: payload });
        if (!r.ok) {
          res.status(502).json({ success: false, status: r.status, error: r.body?.errors ?? r.body });
          return;
        }

        const consentId = r.body?.data?.consentId || r.body?.consentId || r.body?.data?.id || r.body?.id;
        const authorizationUrl = r.body?.data?.authorizationUrl || r.body?.authorizationUrl;

        const { error: dbErr } = await ext.from('celcoin_consents').upsert(
          {
            user_id: userId,
            consent_id: consentId,
            brand_id: brandId,
            status: r.body?.data?.status || 'AWAITING_AUTHORISATION',
            permissions,
            expires_at: r.body?.data?.expirationDateTime || null,
            celcoin_env: (process.env.CELCOIN_ENV || 'sandbox').toLowerCase(),
          },
          { onConflict: 'consent_id' },
        );
        if (dbErr) console.error('[celcoin] falha ao gravar consentimento:', dbErr.message);

        res.json({ success: true, consent_id: consentId, authorization_url: authorizationUrl });
        return;
      }

      // Passo 3: relê o estado no provedor e carimba localmente. AUTHORISED libera o consumo;
      // REJECTED significa expirado, vencido ou revogado — e a conciliação para até renovar.
      case 'consent_status': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) {
          res.status(400).json({ success: false, error: 'consent_id é obrigatório' });
          return;
        }

        const r = await api('GET', `${DAT}/consents/${encodeURIComponent(consentId)}`, { consentId });
        const status = r.body?.data?.status || r.body?.status || null;

        if (status) {
          await ext
            .from('celcoin_consents')
            .update({
              status,
              expires_at: r.body?.data?.expirationDateTime || null,
              authorized_at: status === 'AUTHORISED' ? new Date().toISOString() : null,
              updated_at: new Date().toISOString(),
            })
            .eq('consent_id', consentId);
        }

        res.json({ success: r.ok, status: r.status, consent_status: status, detail: r.body?.data ?? r.body });
        return;
      }

      // Obrigatório em todo consentimento antes de consumir dados.
      case 'list_resources': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) {
          res.status(400).json({ success: false, error: 'consent_id é obrigatório' });
          return;
        }
        const resources = await apiPaged(`${DAT}/resources`, consentId);
        res.json({ success: true, resources });
        return;
      }

      case 'list_accounts': {
        const consentId = String(body.consent_id || '').trim();
        if (!consentId) {
          res.status(400).json({ success: false, error: 'consent_id é obrigatório' });
          return;
        }
        const accounts = await apiPaged(`${DAT}/accounts`, consentId);
        const cards = await apiPaged(`${DAT}/credit-cards-accounts/accounts`, consentId);
        res.json({ success: true, accounts, credit_cards: cards });
        return;
      }

      // Puxa extrato de conta + transações de fatura de cartão e grava com provider='celcoin'.
      // As tabelas são as mesmas da Pluggy: a coluna provider é o que deixa as duas conviverem.
      case 'sync_transactions': {
        const consentId = String(body.consent_id || '').trim();
        const userId = String(body.user_id || '').trim();
        if (!consentId || !userId) {
          res.status(400).json({ success: false, error: 'consent_id e user_id são obrigatórios' });
          return;
        }

        const from = body.from ? String(body.from) : undefined;
        const to = body.to ? String(body.to) : undefined;
        let bankCount = 0;
        let cardCount = 0;

        // --- Contas: extrato ---
        const accounts = await apiPaged(`${DAT}/accounts`, consentId);
        for (const acc of accounts) {
          const accountId = acc?.accountId;
          if (!accountId) continue;

          const txs = await apiPaged(`${DAT}/accounts/${encodeURIComponent(accountId)}/transactions`, consentId, {
            fromBookingDate: from,
            toBookingDate: to,
          });

          const rows = txs
            .filter((t: any) => t?.transactionId)
            .map((t: any) => ({
              user_id: userId,
              provider: 'celcoin',
              pluggy_account_id: accountId, // coluna herdada da Pluggy = id da conta no provedor
              pluggy_transaction_id: t.transactionId,
              pluggy_item_id: consentId, // agrupador da conexão = consentimento
              description: t.transactionName || t.typeAdditionalInfo || null,
              amount: signedAmount(t),
              currency_code: t.transactionAmount?.currency || 'BRL',
              transaction_date: toDateOnly(t.transactionDateTime) || toDateOnly(t.bookingDate),
              transaction_time: toTimeOnly(t.transactionDateTime),
              transaction_type: t.type || null,
              // O Open Finance NÃO devolve categoria — fica nulo e a categorização
              // passa a ser responsabilidade nossa (MCC/IA). Ver categoryTranslations.ts.
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
            .filter((r) => r.transaction_date);

          if (rows.length) {
            const { error } = await ext
              .from('bank_transactions')
              .upsert(rows, { onConflict: 'provider,pluggy_transaction_id' });
            if (error) throw new Error(`upsert bank_transactions: ${error.message}`);
            bankCount += rows.length;
          }
        }

        // --- Cartões: conta -> fatura -> transações (a Pluggy entregava direto na conta) ---
        const cards = await apiPaged(`${DAT}/credit-cards-accounts/accounts`, consentId);
        for (const card of cards) {
          const cardId = card?.creditCardAccountId;
          if (!cardId) continue;

          const bills = await apiPaged(
            `${DAT}/credit-cards-accounts/accounts/${encodeURIComponent(cardId)}/bills`,
            consentId,
            { fromDueDate: from, toDueDate: to },
          );

          for (const bill of bills) {
            const billId = bill?.billId;
            if (!billId) continue;

            const txs = await apiPaged(
              `${DAT}/credit-cards-accounts/accounts/${encodeURIComponent(cardId)}/bills/${encodeURIComponent(billId)}/transactions`,
              consentId,
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
                  // MCC é o que sobra para categorizar automaticamente no cartão.
                  payeeMCC: t.payeeMCC ?? null,
                },
                merchant_name: t.transactionName || null,
                installment_number: t.instalmentNumber ?? null,
                total_installments: t.totalInstalments ?? null,
              }))
              .filter((r) => r.transaction_date);

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

        console.log(`[celcoin] sync consent=${consentId}: ${bankCount} bancárias, ${cardCount} de cartão`);
        res.json({ success: true, bank_transactions: bankCount, credit_card_transactions: cardCount });
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

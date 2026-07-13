// Sincroniza a tabela `hearings` (Supabase Externo) com a planilha de audiências
// do escritório. Self-contained: roda no projeto externo kmedldlepwiityjsdahz,
// sem imports de _shared (deploy via Management API exige arquivo único).
//
// v1 — modo diagnóstico (dry_run, padrão): testa credenciais Google disponíveis,
// resolve a aba pelo gid e devolve cabeçalho + amostra de linhas. NÃO escreve
// no banco. O modo apply só será habilitado depois do mapeamento de colunas
// ser validado contra a planilha real.
//
// Segurança: planilha e aba são FIXAS no código — o chamador não controla
// nenhum dado que vá para o banco, só flags de modo. Nunca logar conteúdo
// das linhas (contém números de processo).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const SPREADSHEET_ID = "1ZOCeDda-qhGAGcKQxp8B3wyOlhXYhBKE0_MZN0ffjik";
const TARGET_GID = 1517179812;
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const SHEETS_API = "https://sheets.googleapis.com/v4";

// ---------------------------------------------------------------------------
// Acesso Google Sheets — dois caminhos possíveis, na ordem:
// 1. GOOGLE_SERVICE_ACCOUNT_KEY (service account, API oficial)
// 2. LOVABLE_API_KEY + GOOGLE_SHEETS_API_KEY (gateway do conector Lovable)
// ---------------------------------------------------------------------------

async function getGoogleAccessToken(serviceAccountKey: any): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccountKey.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encode = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${encode(header)}.${encode(claim)}`;

  const pemContents = serviceAccountKey.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );
  const signedToken = `${unsignedToken}.${
    btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
  }`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signedToken}`,
  });
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error("Service account: falha ao obter access token do Google");
  }
  return tokenData.access_token;
}

type SheetsFetcher = (path: string) => Promise<Response>;

/** Resolve o melhor caminho de acesso disponível e devolve um fetcher + diagnóstico. */
async function resolveSheetsAccess(): Promise<{
  fetcher: SheetsFetcher | null;
  used: string | null;
  credentials: Record<string, boolean>;
  error?: string;
}> {
  const serviceKeyStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const gsKey = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  const credentials = {
    google_service_account_key: !!serviceKeyStr,
    lovable_api_key: !!lovableKey,
    google_sheets_api_key: !!gsKey,
  };

  if (serviceKeyStr) {
    try {
      const accessToken = await getGoogleAccessToken(JSON.parse(serviceKeyStr));
      const fetcher: SheetsFetcher = (path) =>
        fetch(`${SHEETS_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      return { fetcher, used: "service_account", credentials };
    } catch (e) {
      // cai para o gateway; registra o motivo no diagnóstico
      credentials.google_service_account_key = false;
      console.error("service account indisponível:", (e as Error).message);
    }
  }

  if (lovableKey && gsKey) {
    const fetcher: SheetsFetcher = (path) =>
      fetch(`${GATEWAY}${path.replace(/^\/spreadsheets/, "/spreadsheets")}`, {
        headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gsKey },
      });
    return { fetcher, used: "lovable_gateway", credentials };
  }

  return {
    fetcher: null,
    used: null,
    credentials,
    error: "Nenhuma credencial Google disponível neste projeto (GOOGLE_SERVICE_ACCOUNT_KEY ou LOVABLE_API_KEY+GOOGLE_SHEETS_API_KEY)",
  };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    let payload: any = {};
    try { payload = await req.json(); } catch { /* body vazio = dry_run */ }
    const apply = payload?.apply === true;
    const maxSample = Math.min(Number(payload?.max_sample) || 6, 30);

    const access = await resolveSheetsAccess();
    if (!access.fetcher) {
      return json({ ok: false, credentials: access.credentials, error: access.error }, 200);
    }

    // 1. Metadados: resolve o título da aba pelo gid
    const metaRes = await access.fetcher(
      `/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    );
    if (!metaRes.ok) {
      const t = (await metaRes.text()).slice(0, 300);
      return json({
        ok: false,
        used: access.used,
        credentials: access.credentials,
        step: "metadata",
        status: metaRes.status,
        error: t,
      }, 200);
    }
    const meta = await metaRes.json();
    const sheets = (meta.sheets || []).map((s: any) => s.properties).filter(Boolean);
    const target = sheets.find((p: any) => p.sheetId === TARGET_GID);
    const tabTitles = sheets.map((p: any) => ({ title: p.title, gid: p.sheetId }));
    if (!target) {
      return json({
        ok: false,
        used: access.used,
        credentials: access.credentials,
        step: "resolve_tab",
        error: `Aba com gid ${TARGET_GID} não encontrada`,
        tabs: tabTitles,
      }, 200);
    }

    // 2. Lê os valores da aba
    const range = encodeURIComponent(`${target.title}!A1:Z1000`);
    const valuesRes = await access.fetcher(
      `/spreadsheets/${SPREADSHEET_ID}/values/${range}`,
    );
    if (!valuesRes.ok) {
      const t = (await valuesRes.text()).slice(0, 300);
      return json({
        ok: false,
        used: access.used,
        credentials: access.credentials,
        step: "values",
        status: valuesRes.status,
        error: t,
      }, 200);
    }
    const valuesData = await valuesRes.json();
    const rows: string[][] = valuesData.values || [];

    if (apply) {
      // Escrita só será liberada depois do mapeamento de colunas ser validado
      // com o dry_run contra a planilha real. `createClient` fica importado
      // para a v2 (upsert em hearings via service role).
      void createClient;
      return json({
        ok: false,
        error: "apply ainda não habilitado — mapeamento de colunas pendente de validação (rode dry_run)",
      }, 400);
    }

    return json({
      ok: true,
      dry_run: true,
      used: access.used,
      credentials: access.credentials,
      tab: { title: target.title, gid: target.sheetId },
      tabs: tabTitles,
      row_count: rows.length,
      headers: rows[0] || [],
      sample: rows.slice(1, 1 + maxSample),
    });
  } catch (error) {
    console.error("sync-hearings-from-sheet error:", (error as Error).message);
    return json({ ok: false, error: (error as Error).message }, 500);
  }
});

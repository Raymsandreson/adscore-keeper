const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getBaseUrl(env: string) {
  const normalized = (env || "sandbox").toLowerCase();
  if (normalized === "production" || normalized === "prod") {
    return "https://openfinance.celcoin.com.br";
  }
  return "https://sandbox.openfinance.celcoin.com.br";
}

function requireInternalKey(req: Request) {
  const internalKey = Deno.env.get("CELCOIN_INTERNAL_KEY");
  if (!internalKey) {
    return { ok: false, response: json({ error: "Missing CELCOIN_INTERNAL_KEY secret" }, 500) };
  }
  const provided = req.headers.get("x-internal-key");
  if (!provided || provided !== internalKey) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true as const };
}

async function getCelcoinToken() {
  const clientId = Deno.env.get("CELCOIN_CLIENT_ID");
  const clientSecret = Deno.env.get("CELCOIN_CLIENT_SECRET");
  const celcoinEnv = Deno.env.get("CELCOIN_ENV") || "sandbox";
  const fundingId = Deno.env.get("CELCOIN_FUNDING_ID");
  const productId = Deno.env.get("CELCOIN_PRODUCT_ID");
  const authUrl = Deno.env.get("CELCOIN_AUTH_URL") || `${getBaseUrl(celcoinEnv)}/oauth/token`;

  if (!clientId || !clientSecret) {
    throw new Error("Missing CELCOIN_CLIENT_ID or CELCOIN_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (fundingId) headers["x-funding-id"] = fundingId;
  if (productId) headers["x-product-id"] = productId;

  const tokenRes = await fetch(authUrl, {
    method: "POST",
    headers,
    body,
  });

  const raw = await tokenRes.text();
  let parsed: any = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // keep text
  }

  if (!tokenRes.ok) {
    throw new Error(`Token request failed (${tokenRes.status}): ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }

  const accessToken = parsed?.access_token;
  if (!accessToken) {
    throw new Error("Token response missing access_token");
  }

  return { accessToken, fundingId, productId, celcoinEnv };
}

function isAllowedPath(path: string) {
  const raw = Deno.env.get("CELCOIN_ALLOWED_PATHS") || "";
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.some((prefix) => path.startsWith(prefix));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname.endsWith("/health")) {
      const auth = requireInternalKey(req);
      if (!auth.ok) return auth.response;
      return json({ ok: true, function: "celcoin-gateway" });
    }

    if (req.method === "POST" && url.pathname.endsWith("/call")) {
      const auth = requireInternalKey(req);
      if (!auth.ok) return auth.response;

      const payload = await req.json();
      const method = String(payload?.method || "GET").toUpperCase();
      const path = String(payload?.path || "");
      const query = payload?.query || null;
      const body = payload?.body ?? null;

      if (!path || !path.startsWith("/")) {
        return json({ error: "Invalid path. Use '/vX/...'." }, 400);
      }

      if (!isAllowedPath(path)) {
        return json({ error: "Path not allowed by CELCOIN_ALLOWED_PATHS" }, 403);
      }

      const { accessToken, fundingId, productId, celcoinEnv } = await getCelcoinToken();
      const target = new URL(`${getBaseUrl(celcoinEnv)}${path}`);

      if (query && typeof query === "object") {
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
        }
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      };
      if (fundingId) headers["x-funding-id"] = fundingId;
      if (productId) headers["x-product-id"] = productId;
      if (body !== null) headers["Content-Type"] = "application/json";

      const upstream = await fetch(target.toString(), {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
      });

      const raw = await upstream.text();
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // keep raw
      }

      return json({
        ok: upstream.ok,
        status: upstream.status,
        celcoin_env: celcoinEnv,
        celcoin_path: path,
        response: parsed,
      }, upstream.ok ? 200 : 502);
    }

    return json({ error: "Route not found" }, 404);
  } catch (err) {
    return json({ error: "Unexpected error", details: String(err) }, 500);
  }
});

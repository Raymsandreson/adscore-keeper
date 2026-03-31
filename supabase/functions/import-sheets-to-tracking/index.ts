import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  const encode = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${encode(header)}.${encode(claim)}`;

  const pemContents = serviceAccountKey.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedToken = `${unsignedToken}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signedToken}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error("Failed to get Google access token");
  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      RESOLVED_SUPABASE_URL,
      RESOLVED_ANON_KEY,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Não autenticado");

    const { spreadsheet_url, sheet_name } = await req.json();
    if (!spreadsheet_url) throw new Error("URL da planilha é obrigatória");

    // Extract spreadsheet ID
    const match = spreadsheet_url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error("URL inválida do Google Sheets");
    const spreadsheetId = match[1];
    const tabName = sheet_name || "Sheet1";

    // Get Google access token
    const serviceKeyStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (!serviceKeyStr) throw new Error("Chave da conta de serviço não configurada");
    const serviceKey = JSON.parse(serviceKeyStr);
    const accessToken = await getGoogleAccessToken(serviceKey);

    // Read sheet data
    const range = encodeURIComponent(`${tabName}!A:Y`);
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    const sheetsRes = await fetch(sheetsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!sheetsRes.ok) {
      const err = await sheetsRes.text();
      throw new Error(`Erro ao ler planilha: ${err}`);
    }

    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];
    if (rows.length < 2) {
      return new Response(JSON.stringify({ rows: [], message: "Planilha vazia ou sem dados" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map header to column index
    const headers = rows[0].map((h: string) => h?.trim().toUpperCase());
    const colMap: Record<string, number> = {};
    headers.forEach((h: string, i: number) => { colMap[h] = i; });

    const getVal = (row: string[], key: string) => {
      const idx = colMap[key];
      return idx !== undefined ? (row[idx]?.trim() || null) : null;
    };

    // Parse rows into structured data
    const parsedRows = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      
      const cliente = getVal(row, "CLIENTE");
      if (!cliente) continue; // skip empty rows

      parsedRows.push({
        cliente,
        caso: getVal(row, "CASO"),
        cpf: getVal(row, "CPF"),
        senha_gov: getVal(row, "SENHA GOV"),
        data_criacao: getVal(row, "DATA DE CRIAÇÃO DO GRUPO") || getVal(row, "DATA DE CRIAÇÃO"),
        tipo: getVal(row, "TIPO"),
        acolhedor: getVal(row, "ACOLHEDOR"),
        numero_processo: getVal(row, "Nº PROCESSO") || getVal(row, "N° PROCESSO") || getVal(row, "Nº PROCESSO"),
        pendencia: getVal(row, "PENDENCIA") || getVal(row, "PENDÊNCIA"),
        data_gerar_guia: getVal(row, "DATA PARA GERAR GUIA"),
        data_nascimento_bebe: getVal(row, "DATA DE NASCIMENTO DO BEBÊ") || getVal(row, "DATA DE NASCIMENTO DO BEBE"),
        protocolado: getVal(row, "PROTOCOLADO"),
        data_protocolo_cancelamento: getVal(row, "DATA DO PROTOCOLO / CANCELAMENTO") || getVal(row, "DATA DO PROTOCOLO/CANCELAMENTO"),
        tempo_dias: (() => {
          const v = getVal(row, "TEMPO (DIAS)") || getVal(row, "TEMPO");
          return v ? parseInt(v, 10) || null : null;
        })(),
        status_processo: getVal(row, "STATUS DO PROCESSO"),
        data_decisao_final: getVal(row, "DATA DA DECISÃO FINAL"),
        motivo_indeferimento: getVal(row, "MOTIVO DO INDEFERIMENTO"),
        observacao: getVal(row, "OBSERVAÇÃO") || getVal(row, "OBSERVACAO"),
        cliente_no_grupo: getVal(row, "CLIENTE ESTÁ NO GRUPO") || getVal(row, "CLIENTE ESTA NO GRUPO"),
        atividade_criada: getVal(row, "ATIV CRIADA NO SISTEMA?"),
        pago_acolhedor: getVal(row, "JÁ FOI PAGO P/ ACOLHEDOR?") || getVal(row, "JA FOI PAGO P/ ACOLHEDOR?"),
        data_pagamento: getVal(row, "DATA DO PAGAMENTO"),
        import_source: "google_sheets",
      });
    }

    // Get existing tracking data for conflict detection
    const { data: existing } = await supabase
      .from("case_process_tracking")
      .select("id, cliente, caso, cpf");

    // Mark conflicts
    const results = parsedRows.map((row) => {
      const match = (existing || []).find(
        (e: any) =>
          (e.cpf && row.cpf && e.cpf === row.cpf) ||
          (e.cliente && row.cliente && e.cliente.toLowerCase() === row.cliente.toLowerCase())
      );
      return {
        ...row,
        existing_id: match?.id || null,
        has_conflict: !!match,
      };
    });

    return new Response(JSON.stringify({ rows: results, total: results.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

// Google Sheets API helper
async function getGoogleAccessToken(serviceAccountKey: any): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccountKey.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encode = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${encode(header)}.${encode(claim)}`;

  // Import private key and sign
  const pemContents = serviceAccountKey.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedToken = `${unsignedToken}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signedToken}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Google OAuth error: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      RESOLVED_SUPABASE_URL,
      RESOLVED_ANON_KEY,
    );

    // Validate user via Cloud auth (ES256 tokens can't be verified locally in Deno)
    const cloudUrl = Deno.env.get('SUPABASE_URL')!;
    const cloudAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const cloudClient = createClient(cloudUrl, cloudAnon, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userError } = await cloudClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { spreadsheet_id, sheet_name, nucleus_filter } = await req.json();
    if (!spreadsheet_id) {
      return new Response(JSON.stringify({ error: "spreadsheet_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const targetSheet = sheet_name || "Sheet1";

    // Load service account key
    const serviceAccountKeyRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (!serviceAccountKeyRaw) {
      return new Response(JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const serviceAccountKey = JSON.parse(serviceAccountKeyRaw);

    // Fetch cases with related data
    let query = supabase
      .from("legal_cases")
      .select(`
        id, case_number, title, description, status, benefit_type, acolhedor, notes, created_at,
        lead_id,
        leads(lead_name, lead_phone, created_at),
        specialized_nuclei(name, prefix)
      `)
      .order("created_at", { ascending: true });

    if (nucleus_filter) {
      query = query.eq("nucleus_id", nucleus_filter);
    }

    const { data: cases, error: casesError } = await query;
    if (casesError) throw casesError;

    // For each case, fetch contacts linked to the lead (for CPF, etc.)
    const rows: any[][] = [];

    // Header row
    rows.push([
      "CLIENTE", "CASO", "CPF", "SENHA GOV", "DATA DE CRIAÇÃO DO GRUPO",
      "TIPO", "ACOLHEDOR", "Nº Processo", "PENDENCIA",
      "DATA PARA GERAR GUIA", "DATA DE NASCIMENTO DO BEBÊ",
      "PROTOCOLADO", "DATA DO PROTOCOLO / CANCELAMENTO", "TEMPO (DIAS)",
      "STATUS DO PROCESSO", "DATA DA DECISÃO FINAL",
      "MOTIVO DO INDEFERIMENTO", "OBSERVAÇÃO",
      "CLIENTE ESTÁ NO GRUPO", "ATIV CRIADA NO SISTEMA?",
      "JÁ FOI PAGO P/ ACOLHEDOR?", "DATA DO PAGAMENTO"
    ]);

    for (const c of (cases || [])) {
      const lead = (c as any).leads;
      const nucleus = (c as any).specialized_nuclei;

      // Fetch contact CPF if lead exists
      let cpf = "";
      let senhaGov = "";
      if (c.lead_id) {
        // Get contacts linked to this lead
        const { data: contactLinks } = await supabase
          .from("contact_leads")
          .select("contacts(full_name, phone)")
          .eq("lead_id", c.lead_id)
          .limit(5);

        // Try to find CPF in custom fields
        const { data: customFields } = await supabase
          .from("lead_custom_field_values")
          .select("value, lead_custom_fields(field_name)")
          .eq("lead_id", c.lead_id);

        if (customFields) {
          for (const cf of customFields) {
            const fieldName = (cf as any).lead_custom_fields?.field_name?.toLowerCase() || "";
            if (fieldName.includes("cpf")) cpf = (cf as any).value || "";
            if (fieldName.includes("senha") && fieldName.includes("gov")) senhaGov = (cf as any).value || "";
          }
        }
      }

      // Get group creation date from whatsapp_groups or lead's whatsapp_group_id
      let groupCreationDate = "";
      if (c.lead_id) {
        const { data: leadData } = await supabase
          .from("leads")
          .select("whatsapp_group_id, created_at")
          .eq("id", c.lead_id)
          .single();

        if (leadData?.whatsapp_group_id) {
          // Use lead creation as proxy for group creation date
          groupCreationDate = leadData.created_at ? new Date(leadData.created_at).toLocaleDateString("pt-BR") : "";
        }
      }

      // Check for open activities
      let hasOpenActivity = false;
      if (c.lead_id) {
        const { data: activities } = await supabase
          .from("lead_activities")
          .select("id")
          .eq("lead_id", c.lead_id)
          .in("status", ["pendente", "em_andamento"])
          .limit(1);
        hasOpenActivity = (activities || []).length > 0;
      }

      // Check if client is in group
      let clientInGroup = "";
      if (c.lead_id) {
        const { data: leadCheck } = await supabase
          .from("leads")
          .select("whatsapp_group_id")
          .eq("id", c.lead_id)
          .single();
        clientInGroup = leadCheck?.whatsapp_group_id ? "SIM" : "";
      }

      rows.push([
        lead?.lead_name || c.title || "",                   // CLIENTE
        c.case_number || "",                                // CASO
        cpf,                                                // CPF
        senhaGov,                                           // SENHA GOV
        groupCreationDate,                                  // DATA DE CRIAÇÃO DO GRUPO
        c.benefit_type || "",                               // TIPO
        c.acolhedor || "",                                  // ACOLHEDOR
        "",                                                 // Nº Processo (blank)
        "",                                                 // PENDENCIA (blank)
        "",                                                 // DATA PARA GERAR GUIA (blank)
        "",                                                 // DATA DE NASCIMENTO DO BEBÊ (blank)
        "",                                                 // PROTOCOLADO (blank)
        "",                                                 // DATA DO PROTOCOLO / CANCELAMENTO (blank)
        "",                                                 // TEMPO (DIAS) (blank)
        "",                                                 // STATUS DO PROCESSO (blank)
        "",                                                 // DATA DA DECISÃO FINAL (blank)
        "",                                                 // MOTIVO DO INDEFERIMENTO (blank)
        c.notes || "",                                      // OBSERVAÇÃO
        clientInGroup,                                      // CLIENTE ESTÁ NO GRUPO
        hasOpenActivity ? "SIM" : "",                       // ATIV CRIADA NO SISTEMA?
        "",                                                 // JÁ FOI PAGO P/ ACOLHEDOR? (blank)
        "",                                                 // DATA DO PAGAMENTO (blank)
      ]);
    }

    // Get Google access token
    const accessToken = await getGoogleAccessToken(serviceAccountKey);

    // Clear existing data and write new
    const sheetsApiBase = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}`;

    // Clear the sheet first
    await fetch(`${sheetsApiBase}/values/${encodeURIComponent(targetSheet)}:clear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Write data
    const writeResponse = await fetch(
      `${sheetsApiBase}/values/${encodeURIComponent(targetSheet + "!A1")}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows }),
      }
    );

    const writeResult = await writeResponse.json();
    if (!writeResponse.ok) {
      throw new Error(`Google Sheets API error: ${JSON.stringify(writeResult)}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        rows_exported: rows.length - 1,
        message: `${rows.length - 1} casos exportados para a planilha`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Export error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

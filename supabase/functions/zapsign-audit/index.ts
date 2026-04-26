// Audita o que existe no ZapSign vs o que temos em zapsign_documents.
// Apenas leitura — não grava nada.
// Uso: GET /functions/v1/zapsign-audit?max_pages=20

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ZAPSIGN_BASE = "https://api.zapsign.com.br/api/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const token = Deno.env.get("ZAPSIGN_API_TOKEN");
    if (!token) throw new Error("ZAPSIGN_API_TOKEN ausente");

    const url = new URL(req.url);
    const maxPages = Math.min(Number(url.searchParams.get("max_pages") || "30"), 200);
    const nameFilter = (url.searchParams.get("name_contains") || "").toLowerCase();
    const onlySigned = url.searchParams.get("only_signed") === "true";
    const pageSize = 50; // zapsign default

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pagina /docs/ até esgotar ou bater max_pages
    const allRemoteDocs: Array<{
      token: string;
      name: string;
      status: string;
      created_at: string;
      last_update_at: string;
      template_id?: string | null;
      folder_path?: string | null;
    }> = [];

    let page = 1;
    let totalCountFromApi = 0;
    let hasNext = true;

    while (hasNext && page <= maxPages) {
      const resp = await fetch(`${ZAPSIGN_BASE}/docs/?page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`ZapSign API page=${page} HTTP ${resp.status}: ${txt.slice(0, 300)}`);
      }
      const data = await resp.json();
      // formato comum: { count, next, previous, results: [...] }
      totalCountFromApi = data.count ?? totalCountFromApi;
      const results = Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];
      for (const d of results) {
        const name = d.name || "";
        if (nameFilter && !name.toLowerCase().includes(nameFilter)) continue;
        if (onlySigned && d.status !== "signed") continue;
        allRemoteDocs.push({
          token: d.token,
          name,
          status: d.status,
          created_at: d.created_at,
          last_update_at: d.last_update_at,
          template_id: d.template?.token || d.template_id || null,
          folder_path: d.folder_path,
        });
      }
      hasNext = !!data.next && results.length > 0;
      page++;
    }

    // Compara com nossa tabela
    const { data: localDocs, error: localErr } = await supabase
      .from("zapsign_documents")
      .select("doc_token, status, document_name, template_id");
    if (localErr) throw localErr;

    const localByToken = new Map((localDocs || []).map((d) => [d.doc_token, d]));
    const remoteByToken = new Map(allRemoteDocs.map((d) => [d.token, d]));

    const missingFromLocal = allRemoteDocs.filter((d) => !localByToken.has(d.token));
    const missingFromRemote = (localDocs || []).filter((d) => !remoteByToken.has(d.doc_token));

    // Status mismatch
    const statusMismatch = allRemoteDocs
      .filter((d) => {
        const l = localByToken.get(d.token);
        return l && l.status !== d.status;
      })
      .map((d) => ({
        token: d.token,
        name: d.name,
        remote_status: d.status,
        local_status: localByToken.get(d.token)?.status,
      }));

    // Breakdown por status remoto
    const remoteStatusBreakdown: Record<string, number> = {};
    for (const d of allRemoteDocs) {
      remoteStatusBreakdown[d.status] = (remoteStatusBreakdown[d.status] || 0) + 1;
    }

    // Breakdown por template (remoto, só os signed)
    const remoteSignedByTemplate: Record<string, number> = {};
    for (const d of allRemoteDocs) {
      if (d.status === "signed") {
        const k = d.template_id || "(no_template)";
        remoteSignedByTemplate[k] = (remoteSignedByTemplate[k] || 0) + 1;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanned: {
          pages_fetched: page - 1,
          docs_pulled: allRemoteDocs.length,
          api_total_count: totalCountFromApi,
          truncated: hasNext, // true se ainda havia páginas e batemos max_pages
        },
        comparison: {
          local_total: localDocs?.length || 0,
          remote_total_pulled: allRemoteDocs.length,
          missing_from_local: missingFromLocal.length,
          missing_from_remote: missingFromRemote.length,
          status_mismatch_count: statusMismatch.length,
        },
        remote_status_breakdown: remoteStatusBreakdown,
        remote_signed_by_template: remoteSignedByTemplate,
        samples: {
          missing_from_local: missingFromLocal.slice(0, 10),
          missing_from_remote: missingFromRemote.slice(0, 10),
          status_mismatch: statusMismatch.slice(0, 10),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

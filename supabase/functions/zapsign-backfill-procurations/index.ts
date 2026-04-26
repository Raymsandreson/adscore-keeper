// Backfill de procurações ZapSign (>= 2026-01-01).
// - Filtra por nome contendo "procura" e excluindo "revoga"
// - Importa para zapsign_documents (UPSERT)
// - Match por telefone (últimos 8 dígitos) com leads
// - Marca lead_status='closed', enriquece dados, anexa PDF em process_documents
// - Mapeia funil: maternidade -> Auxílio-Maternidade; bpc/loas/autista -> Fluxo BPC; resto -> mantém
//
// Uso: GET /functions/v1/zapsign-backfill-procurations?dry_run=true&max_pages=50
//      GET /functions/v1/zapsign-backfill-procurations?dry_run=false&max_pages=100

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ZAPSIGN_BASE = "https://api.zapsign.com.br/api/v1";
const CUTOFF_DATE = new Date("2026-01-01T00:00:00Z");

const FUNNEL_MATERNIDADE = "48d6581d-b138-45f9-bb63-84d90ba86ec2";
const FUNNEL_BPC = "8377ee1b-97a2-4777-9b51-3af9e630b3c6";

type ZapDocSummary = {
  token: string;
  name: string;
  status: string;
  created_at: string;
  folder_path?: string;
};

type ZapDocDetail = {
  token: string;
  name: string;
  status: string;
  created_at: string;
  last_update_at: string;
  original_file?: string;
  signed_file?: string;
  template?: { token?: string; name?: string };
  signers?: Array<{
    token: string;
    name?: string;
    email?: string;
    phone_country?: string;
    phone_number?: string;
    status?: string;
    signed_at?: string;
    cpf?: string;
    cnpj?: string;
  }>;
  answers?: Array<{ variable: string; value: string }>;
};

function classifyFunnel(name: string): string | null {
  const n = name.toLowerCase();
  if (/(maternidade|matern)/.test(n)) return FUNNEL_MATERNIDADE;
  if (/(bpc|loas|autista)/.test(n)) return FUNNEL_BPC;
  return null; // mantém funil atual
}

function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.slice(-8); // últimos 8 dígitos pra match
}

function pickAnswer(answers: Array<{ variable: string; value: string }> | undefined, patterns: RegExp[]): string | null {
  if (!answers) return null;
  for (const p of patterns) {
    const found = answers.find((a) => p.test(a.variable));
    if (found?.value) return found.value.trim();
  }
  return null;
}

function parseAddress(answers: Array<{ variable: string; value: string }> | undefined) {
  const cep = pickAnswer(answers, [/\bcep\b/i]);
  const street = pickAnswer(answers, [/(rua|endere[çc]o|logradouro)/i]);
  const number = pickAnswer(answers, [/(n[uú]mero|^n[°º]?$)/i]);
  const neighborhood = pickAnswer(answers, [/(bairro)/i]);
  const city = pickAnswer(answers, [/(cidade|munic[ií]pio)/i]);
  const state = pickAnswer(answers, [/(estado|\buf\b)/i]);
  return { cep, street, number, neighborhood, city, state };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const token = Deno.env.get("ZAPSIGN_API_TOKEN");
    if (!token) throw new Error("ZAPSIGN_API_TOKEN ausente");

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") !== "false";
    const maxPages = Math.min(Number(url.searchParams.get("max_pages") || "50"), 200);
    const startOffset = Math.max(0, Number(url.searchParams.get("start") || "0"));
    const processLimit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || "20")));
    const scanOnly = url.searchParams.get("scan_only") === "true";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Pagina ZapSign coletando procurações assinadas após CUTOFF
    const candidates: ZapDocSummary[] = [];
    let page = 1;
    let hasNext = true;
    let totalScanned = 0;
    let skippedOldDate = 0;
    while (hasNext && page <= maxPages) {
      const resp = await fetch(`${ZAPSIGN_BASE}/docs/?page=${page}&sort_order=desc`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`ZapSign /docs page=${page} HTTP ${resp.status}: ${txt.slice(0, 200)}`);
      }
      const data = await resp.json();
      const results: ZapDocSummary[] = Array.isArray(data.results) ? data.results : [];
      for (const d of results) {
        totalScanned++;
        const name = d.name || "";
        const lower = name.toLowerCase();
        if (d.status !== "signed") continue;
        if (!lower.includes("procura")) continue;
        if (lower.includes("revoga")) continue;
        const created = new Date(d.created_at);
        if (isNaN(created.getTime())) continue;
        if (created < CUTOFF_DATE) {
          skippedOldDate++;
          continue;
        }
        candidates.push(d);
      }
      hasNext = !!data.next && results.length > 0;
      page++;
    }

    if (scanOnly) {
      return new Response(
        JSON.stringify({
          success: true,
          phase: "scan_only",
          cutoff_date: CUTOFF_DATE.toISOString(),
          pages_scanned: page - 1,
          total_scanned: totalScanned,
          skipped_old_date: skippedOldDate,
          total_candidates: candidates.length,
          first_5: candidates.slice(0, 5).map((c) => ({ token: c.token, name: c.name, created_at: c.created_at })),
          last_5: candidates.slice(-5).map((c) => ({ token: c.token, name: c.name, created_at: c.created_at })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Slice de processamento
    const slice = candidates.slice(startOffset, startOffset + processLimit);

    // 3. Pra cada candidato no slice, buscar detalhe + processar
    const stats = {
      total_candidates: candidates.length,
      already_in_db: 0,
      newly_imported: 0,
      matched_to_lead: 0,
      orphan_no_lead: 0,
      moved_to_maternidade: 0,
      moved_to_bpc: 0,
      kept_funnel: 0,
      enriched_count: 0,
      pdf_attached: 0,
      errors: 0,
    };
    const errors: Array<{ token: string; name: string; error: string }> = [];
    const previewSamples: Array<Record<string, unknown>> = [];

    for (const cand of slice) {
      try {
        // Detalhe
        const detResp = await fetch(`${ZAPSIGN_BASE}/docs/${cand.token}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!detResp.ok) throw new Error(`detalhe HTTP ${detResp.status}`);
        const det: ZapDocDetail = await detResp.json();

        const signer = det.signers?.find((s) => s.status === "signed") || det.signers?.[0];
        const signerPhone = signer ? `${signer.phone_country || ""}${signer.phone_number || ""}` : null;
        const phoneKey = normalizePhone(signerPhone);
        const cpf = signer?.cpf?.replace(/\D/g, "") || pickAnswer(det.answers, [/\bcpf\b/i]);
        const fullName = pickAnswer(det.answers, [/(nome.*completo|^nome$)/i]) || signer?.name;
        const email = signer?.email || pickAnswer(det.answers, [/e[\-\s]?mail/i]);
        const rg = pickAnswer(det.answers, [/\brg\b/i]);
        const birthRaw = pickAnswer(det.answers, [/(nascimento|data.*nasc)/i]);
        const addr = parseAddress(det.answers);

        // Verificar se já existe na nossa tabela
        const { data: existing } = await supabase
          .from("zapsign_documents")
          .select("id, lead_id")
          .eq("doc_token", cand.token)
          .maybeSingle();
        if (existing) stats.already_in_db++;

        // Match por telefone (últimos 8 dígitos)
        let matchedLeadId: string | null = existing?.lead_id || null;
        let matchedLead: Record<string, unknown> | null = null;
        if (!matchedLeadId && phoneKey) {
          const { data: leads } = await supabase
            .from("leads")
            .select("id, board_id, lead_status, cpf, rg, cep, street, street_number, complement, neighborhood, birth_date, lead_email, lead_phone")
            .filter("lead_phone", "ilike", `%${phoneKey}%`)
            .limit(2);
          if (leads && leads.length === 1) {
            matchedLeadId = leads[0].id as string;
            matchedLead = leads[0] as Record<string, unknown>;
          }
        }

        if (matchedLeadId) stats.matched_to_lead++;
        else stats.orphan_no_lead++;

        // Decisão de funil
        const targetFunnel = classifyFunnel(cand.name);
        if (matchedLeadId) {
          if (targetFunnel === FUNNEL_MATERNIDADE) stats.moved_to_maternidade++;
          else if (targetFunnel === FUNNEL_BPC) stats.moved_to_bpc++;
          else stats.kept_funnel++;
        }

        if (dryRun) {
          if (previewSamples.length < 8) {
            previewSamples.push({
              doc: { token: cand.token, name: cand.name, created_at: cand.created_at },
              signer_phone: signerPhone,
              phone_key: phoneKey,
              cpf,
              full_name: fullName,
              email,
              addr,
              matched_lead_id: matchedLeadId,
              target_funnel: targetFunnel,
              would_import: !existing,
            });
          }
          continue;
        }

        // === EXECUÇÃO REAL ===

        // UPSERT em zapsign_documents
        const docPayload = {
          doc_token: cand.token,
          template_id: det.template?.token || null,
          template_name: det.template?.name || null,
          document_name: cand.name,
          status: det.status,
          original_file_url: det.original_file || null,
          signed_file_url: det.signed_file || null,
          lead_id: matchedLeadId,
          signer_name: signer?.name || null,
          signer_token: signer?.token || null,
          signer_email: email || null,
          signer_phone: signerPhone,
          signer_status: signer?.status || null,
          signed_at: signer?.signed_at || null,
          template_data: det.answers ? JSON.parse(JSON.stringify(det.answers)) : null,
          whatsapp_phone: signerPhone,
        };
        const { error: upErr } = await supabase
          .from("zapsign_documents")
          .upsert(docPayload, { onConflict: "doc_token" });
        if (upErr) throw new Error(`upsert zapsign_documents: ${upErr.message}`);
        if (!existing) stats.newly_imported++;

        if (matchedLeadId) {
          // Enriquece campos vazios
          const lead = (matchedLead || {}) as Record<string, unknown>;
          const enrich: Record<string, unknown> = {};
          if (cpf && !lead.cpf) enrich.cpf = cpf;
          if (rg && !lead.rg) enrich.rg = rg;
          if (email && !lead.lead_email) enrich.lead_email = email;
          if (addr.cep && !lead.cep) enrich.cep = addr.cep;
          if (addr.street && !lead.street) enrich.street = addr.street;
          if (addr.number && !lead.street_number) enrich.street_number = addr.number;
          if (addr.neighborhood && !lead.neighborhood) enrich.neighborhood = addr.neighborhood;
          if (birthRaw && !lead.birth_date) {
            // tenta dd/mm/yyyy
            const m = birthRaw.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
            if (m) enrich.birth_date = `${m[3]}-${m[2]}-${m[1]}`;
          }

          // Marcar como fechado e (opcional) mover funil
          enrich.lead_status = "closed";
          if (targetFunnel) enrich.board_id = targetFunnel;

          const { error: leadErr } = await supabase
            .from("leads")
            .update(enrich)
            .eq("id", matchedLeadId);
          if (leadErr) throw new Error(`update lead: ${leadErr.message}`);
          if (Object.keys(enrich).length > 2) stats.enriched_count++;

          // Anexar PDF assinado em process_documents (se ainda não houver)
          if (det.signed_file) {
            const { data: existingDoc } = await supabase
              .from("process_documents")
              .select("id")
              .eq("zapsign_document_id", cand.token)
              .maybeSingle();
            if (!existingDoc) {
              await supabase.from("process_documents").insert({
                lead_id: matchedLeadId,
                document_type: "procuracao",
                title: cand.name,
                source: "zapsign",
                zapsign_document_id: cand.token,
                file_url: det.signed_file,
                original_url: det.signed_file,
                file_name: cand.name.endsWith(".pdf") ? cand.name : `${cand.name}.pdf`,
                document_date: signer?.signed_at?.split("T")[0] || cand.created_at.split("T")[0],
                metadata: { template_name: det.template?.name, signer_name: signer?.name },
              });
              stats.pdf_attached++;
            }
          }
        }
      } catch (e) {
        stats.errors++;
        errors.push({ token: cand.token, name: cand.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        cutoff_date: CUTOFF_DATE.toISOString(),
        pages_scanned: page - 1,
        total_scanned: totalScanned,
        skipped_old_date: skippedOldDate,
        stats,
        preview_samples: dryRun ? previewSamples : undefined,
        errors: errors.slice(0, 20),
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

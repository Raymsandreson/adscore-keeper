// Backfill de procurações ZapSign (>= 2026-01-01) com OCR Gemini.
// - Filtra por nome contendo "procura", excluindo "revoga"
// - OCR no signed_file via Gemini Vision (CPF/RG/endereço)
// - Match no banco EXTERNO por CPF ou últimos 8 dígitos do telefone
// - Enriquece lead, marca closed, move funil (maternidade/BPC)
// - Cria lead novo no externo se não houver match
// - Anexa PDF em process_documents (externo)
//
// Modos:
//  ?inspect_token=XXXX           -> devolve detalhe bruto ZapSign
//  ?probe_phone=5575...          -> testa match no externo
//  ?ocr_token=XXXX               -> roda OCR num doc só (não grava)
//  ?scan_only=true               -> só lista candidatos
//  ?dry_run=true&token=XXXX      -> processa 1 doc específico sem gravar
//  ?dry_run=false&token=XXXX     -> processa 1 doc específico GRAVANDO
//  ?dry_run=false&start=0&limit=20 -> lote completo

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ZAPSIGN_BASE = "https://api.zapsign.com.br/api/v1";
const CUTOFF_DATE = new Date("2026-01-01T00:00:00Z");

const FUNNEL_MATERNIDADE = "48d6581d-b138-45f9-bb63-84d90ba86ec2";
const FUNNEL_BPC = "8377ee1b-97a2-4777-9b51-3af9e630b3c6";

// ViaCEP: enriquece bairro quando OCR não capturou.
// Público, sem auth, ~50ms. Timeout 3s, falha silenciosa (não bloqueia o backfill).
async function viacepNeighborhood(cep: string | undefined | null): Promise<string | null> {
  if (!cep) return null;
  const clean = String(cep).replace(/\D/g, "");
  if (clean.length !== 8) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`https://viacep.com.br/ws/${clean}/json/`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.erro) return null;
    const bairro = (j?.bairro || "").toString().trim();
    return bairro || null;
  } catch (_e) {
    return null;
  }
}

type ZapDocSummary = {
  token: string;
  name: string;
  status: string;
  created_at: string;
};

type ZapDocDetail = {
  token: string;
  name: string;
  status: string;
  created_at: string;
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
  }>;
  answers?: Array<{ variable: string; value: string }>;
};

type OcrResult = {
  cpf?: string | null;
  rg?: string | null;
  birth_date?: string | null;
  cep?: string | null;
  street?: string | null;
  street_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  full_name?: string | null;
};

function classifyFunnel(name: string): string | null {
  const n = name.toLowerCase();
  if (/(maternidade|matern)/.test(n)) return FUNNEL_MATERNIDADE;
  if (/(bpc|loas|autista)/.test(n)) return FUNNEL_BPC;
  return null;
}

function digits(s?: string | null): string {
  return (s || "").replace(/\D/g, "");
}

function last8Phone(phone?: string | null): string | null {
  const d = digits(phone);
  if (d.length < 8) return null;
  return d.slice(-8);
}

async function runOcr(pdfUrl: string, geminiKey: string): Promise<OcrResult | null> {
  // Baixa PDF e converte pra base64
  const r = await fetch(pdfUrl);
  if (!r.ok) throw new Error(`download PDF HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // base64 em chunks pra evitar stack overflow
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  const b64 = btoa(bin);

  const prompt = `Você está analisando uma procuração jurídica brasileira assinada. Extraia EXATAMENTE os campos do OUTORGANTE (cliente/pessoa que está dando a procuração — NÃO o advogado).

Retorne APENAS JSON válido (sem markdown, sem explicação) com este formato:
{
  "full_name": "nome completo",
  "cpf": "apenas dígitos",
  "rg": "número do RG",
  "birth_date": "YYYY-MM-DD",
  "cep": "apenas dígitos",
  "street": "nome da rua/avenida",
  "street_number": "número",
  "complement": "apto, bloco, etc",
  "neighborhood": "bairro",
  "city": "cidade",
  "state": "UF (2 letras)"
}

Use null para campos que não encontrar. Não invente nada.`;

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${geminiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${b64}` } },
          ],
        },
      ],
    }),
  });

  if (!aiResp.ok) {
    const t = await aiResp.text();
    throw new Error(`Gemini HTTP ${aiResp.status}: ${t.slice(0, 300)}`);
  }
  const aiData = await aiResp.json();
  const content: string = aiData.choices?.[0]?.message?.content || "";
  // Tenta extrair JSON limpo
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as OcrResult;
    if (parsed.cpf) parsed.cpf = digits(parsed.cpf);
    if (parsed.cep) parsed.cep = digits(parsed.cep);
    return parsed;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const zapToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    if (!zapToken) throw new Error("ZAPSIGN_API_TOKEN ausente");
    const geminiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!geminiKey) throw new Error("LOVABLE_API_KEY ausente");

    const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!extUrl || !extKey) throw new Error("EXTERNAL_SUPABASE_URL/KEY ausentes");
    const ext = createClient(extUrl, extKey);

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") !== "false";
    const maxPages = Math.min(Number(url.searchParams.get("max_pages") || "50"), 200);
    const startOffset = Math.max(0, Number(url.searchParams.get("start") || "0"));
    const processLimit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || "5")));
    const scanOnly = url.searchParams.get("scan_only") === "true";
    const inspectToken = url.searchParams.get("inspect_token");
    const probePhone = url.searchParams.get("probe_phone");
    const ocrToken = url.searchParams.get("ocr_token");
    const singleToken = url.searchParams.get("token");

    // === Modo inspect ===
    if (inspectToken) {
      const r = await fetch(`${ZAPSIGN_BASE}/docs/${inspectToken}/`, {
        headers: { Authorization: `Bearer ${zapToken}` },
      });
      const raw = await r.json();
      return new Response(JSON.stringify({ http_status: r.status, raw }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === Modo probe_phone (testa match no externo) ===
    if (probePhone) {
      const last8 = last8Phone(probePhone);
      const { data, error } = await ext
        .from("leads")
        .select("id, lead_name, lead_phone, board_id, lead_status, cpf")
        .ilike("lead_phone", `%${last8}%`)
        .limit(5);
      return new Response(
        JSON.stringify({ probe_phone: probePhone, last8, error: error?.message, results: data || [] }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Modo OCR-only ===
    if (ocrToken) {
      const r = await fetch(`${ZAPSIGN_BASE}/docs/${ocrToken}/`, {
        headers: { Authorization: `Bearer ${zapToken}` },
      });
      if (!r.ok) throw new Error(`zapsign HTTP ${r.status}`);
      const det: ZapDocDetail = await r.json();
      if (!det.signed_file) throw new Error("documento sem signed_file");
      const ocr = await runOcr(det.signed_file, geminiKey);
      const signer = det.signers?.find((s) => s.status === "signed") || det.signers?.[0];
      return new Response(
        JSON.stringify({
          token: ocrToken,
          name: det.name,
          signer: { name: signer?.name, phone: `${signer?.phone_country || ""}${signer?.phone_number || ""}`, cpf: signer?.cpf },
          signed_file: det.signed_file,
          ocr,
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Coletar candidatos ===
    let candidates: ZapDocSummary[] = [];
    let page = 1;
    let hasNext = true;
    let totalScanned = 0;
    let skippedOldDate = 0;

    if (singleToken) {
      // Modo doc único: pula a varredura
      const r = await fetch(`${ZAPSIGN_BASE}/docs/${singleToken}/`, {
        headers: { Authorization: `Bearer ${zapToken}` },
      });
      if (!r.ok) throw new Error(`zapsign HTTP ${r.status}`);
      const d = await r.json();
      candidates = [{ token: d.token, name: d.name, status: d.status, created_at: d.created_at }];
    } else {
      while (hasNext && page <= maxPages) {
        const resp = await fetch(`${ZAPSIGN_BASE}/docs/?page=${page}&sort_order=desc`, {
          headers: { Authorization: `Bearer ${zapToken}` },
        });
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`ZapSign /docs page=${page} HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        }
        const data = await resp.json();
        const results: ZapDocSummary[] = Array.isArray(data.results) ? data.results : [];
        for (const d of results) {
          totalScanned++;
          const lower = (d.name || "").toLowerCase();
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
    }

    if (scanOnly) {
      return new Response(
        JSON.stringify({
          phase: "scan_only",
          pages_scanned: page - 1,
          total_scanned: totalScanned,
          skipped_old_date: skippedOldDate,
          total_candidates: candidates.length,
          first_5: candidates.slice(0, 5).map((c) => ({ token: c.token, name: c.name, created_at: c.created_at })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const slice = singleToken ? candidates : candidates.slice(startOffset, startOffset + processLimit);

    const stats = {
      total_candidates: candidates.length,
      processed: 0,
      ocr_ok: 0,
      ocr_fail: 0,
      matched_by_cpf: 0,
      matched_by_phone: 0,
      no_match_created: 0,
      no_match_skipped: 0,
      lead_enriched: 0,
      pdf_attached: 0,
      moved_to_maternidade: 0,
      moved_to_bpc: 0,
      errors: 0,
    };
    const errors: Array<{ token: string; name: string; error: string }> = [];
    const samples: Array<Record<string, unknown>> = [];

    for (const cand of slice) {
      try {
        stats.processed++;
        // Detalhe ZapSign
        const detResp = await fetch(`${ZAPSIGN_BASE}/docs/${cand.token}/`, {
          headers: { Authorization: `Bearer ${zapToken}` },
        });
        if (!detResp.ok) throw new Error(`zapsign HTTP ${detResp.status}`);
        const det: ZapDocDetail = await detResp.json();
        const signer = det.signers?.find((s) => s.status === "signed") || det.signers?.[0];
        const signerPhone = signer ? `${signer.phone_country || ""}${signer.phone_number || ""}` : null;
        const phoneKey = last8Phone(signerPhone);

        // OCR no PDF assinado
        let ocr: OcrResult | null = null;
        if (det.signed_file) {
          try {
            ocr = await runOcr(det.signed_file, geminiKey);
            if (ocr) stats.ocr_ok++;
            else stats.ocr_fail++;
          } catch (e) {
            stats.ocr_fail++;
            console.warn(`OCR falhou ${cand.token}:`, e instanceof Error ? e.message : e);
          }
        }

        const cpfFinal = digits(signer?.cpf) || ocr?.cpf || null;
        const fullName = signer?.name || ocr?.full_name || null;
        const email = signer?.email || null;

        // === MATCH no externo ===
        let matched: Record<string, unknown> | null = null;
        let matchedBy: "cpf" | "phone" | null = null;

        if (cpfFinal && cpfFinal.length === 11) {
          const { data } = await ext
            .from("leads")
            .select("*")
            .eq("cpf", cpfFinal)
            .limit(1);
          if (data && data.length > 0) {
            matched = data[0];
            matchedBy = "cpf";
            stats.matched_by_cpf++;
          }
        }
        if (!matched && phoneKey) {
          const { data } = await ext
            .from("leads")
            .select("*")
            .ilike("lead_phone", `%${phoneKey}%`)
            .limit(2);
          if (data && data.length === 1) {
            matched = data[0];
            matchedBy = "phone";
            stats.matched_by_phone++;
          }
        }

        const targetFunnel = classifyFunnel(cand.name);

        if (dryRun) {
          if (samples.length < 8) {
            samples.push({
              doc: { token: cand.token, name: cand.name },
              signer: { name: signer?.name, phone: signerPhone, phone_key: phoneKey, cpf: signer?.cpf },
              ocr,
              cpf_final: cpfFinal,
              matched_by: matchedBy,
              matched_lead_id: matched?.id || null,
              matched_lead_name: matched?.lead_name || null,
              target_funnel: targetFunnel,
              would_create_lead: !matched,
            });
          }
          continue;
        }

        // === EXECUÇÃO REAL ===
        let leadId: string | null = (matched?.id as string) || null;

        if (!leadId) {
          // Cria lead novo no externo
          const newLead: Record<string, unknown> = {
            lead_name: fullName || `Cliente ZapSign ${cand.token.slice(0, 8)}`,
            lead_phone: signerPhone,
            lead_email: email,
            cpf: cpfFinal,
            rg: ocr?.rg,
            cep: ocr?.cep,
            street: ocr?.street,
            street_number: ocr?.street_number,
            complement: ocr?.complement,
            neighborhood: ocr?.neighborhood,
            city: ocr?.city,
            state: ocr?.state,
            birth_date: ocr?.birth_date,
            ocr_enriched_at: new Date().toISOString(),
            ocr_source: "zapsign_backfill",
            lead_status: "closed",
            board_id: targetFunnel || null,
            status: "Procuração assinada (backfill)",
          };
          // Remove nulls/undefined pra não poluir
          for (const k of Object.keys(newLead)) {
            if (newLead[k] === null || newLead[k] === undefined) delete newLead[k];
          }
          const { data: created, error: createErr } = await ext
            .from("leads")
            .insert(newLead)
            .select("id")
            .single();
          if (createErr) throw new Error(`criar lead: ${createErr.message}`);
          leadId = created.id;
          stats.no_match_created++;
        } else {
          // Enriquece lead existente
          const enrich: Record<string, unknown> = { lead_status: "closed" };
          if (cpfFinal && !matched!.cpf) enrich.cpf = cpfFinal;
          if (ocr?.rg && !matched!.rg) enrich.rg = ocr.rg;
          if (ocr?.cep && !matched!.cep) enrich.cep = ocr.cep;
          if (ocr?.street && !matched!.street) enrich.street = ocr.street;
          if (ocr?.street_number && !matched!.street_number) enrich.street_number = ocr.street_number;
          if (ocr?.complement && !matched!.complement) enrich.complement = ocr.complement;
          if (ocr?.neighborhood && !matched!.neighborhood) enrich.neighborhood = ocr.neighborhood;
          if (ocr?.city && !matched!.city) enrich.city = ocr.city;
          if (ocr?.state && !matched!.state) enrich.state = ocr.state;
          if (ocr?.birth_date && !matched!.birth_date) enrich.birth_date = ocr.birth_date;
          if (email && !matched!.lead_email) enrich.lead_email = email;
          if (targetFunnel) enrich.board_id = targetFunnel;
          enrich.ocr_enriched_at = new Date().toISOString();
          enrich.ocr_source = "zapsign_backfill";

          const { error: updErr } = await ext.from("leads").update(enrich).eq("id", leadId);
          if (updErr) throw new Error(`update lead: ${updErr.message}`);
          stats.lead_enriched++;
        }

        if (targetFunnel === FUNNEL_MATERNIDADE) stats.moved_to_maternidade++;
        else if (targetFunnel === FUNNEL_BPC) stats.moved_to_bpc++;

        // Anexa PDF em process_documents (externo)
        if (det.signed_file && leadId) {
          const { data: existingDoc } = await ext
            .from("process_documents")
            .select("id")
            .eq("zapsign_document_id", cand.token)
            .maybeSingle();
          if (!existingDoc) {
            await ext.from("process_documents").insert({
              lead_id: leadId,
              document_type: "procuracao",
              title: cand.name,
              source: "zapsign",
              zapsign_document_id: cand.token,
              file_url: det.signed_file,
              original_url: det.signed_file,
              file_name: cand.name.endsWith(".pdf") ? cand.name : `${cand.name}.pdf`,
              document_date: signer?.signed_at?.split("T")[0] || cand.created_at.split("T")[0],
              metadata: { template_name: det.template?.name, signer_name: signer?.name, backfill: true },
            });
            stats.pdf_attached++;
          }
        }
      } catch (e) {
        stats.errors++;
        errors.push({ token: cand.token, name: cand.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const nextStart = startOffset + slice.length;
    const hasMore = !singleToken && nextStart < candidates.length;
    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        total_candidates: candidates.length,
        processed_in_this_call: slice.length,
        next_start: hasMore ? nextStart : null,
        has_more: hasMore,
        stats,
        samples: dryRun ? samples : undefined,
        errors: errors.slice(0, 20),
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

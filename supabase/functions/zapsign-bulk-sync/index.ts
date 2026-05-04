// zapsign-bulk-sync
// Pagina /api/v1/docs/?include_signers=true, e por documento:
//  1) Detalha (GET /docs/{token}/) -> answers + signed_file
//  2) Match contato por telefone (cria se não existir)
//  3) Extrai answers -> contacts + leads.lead_field*  (CPF/RG/CEP/endereço/bairro/email)
//  4) Upsert em zapsign_documents (com signed_file_url)
//  5) Cruza phone com whatsapp_groups_cache.participants -> popula whatsapp_group_id
//
// Body:
//  { dry_run?: boolean, mode?: 'incremental'|'restart'|'window',
//    max_pages?: number (default 5), date_from?: 'YYYY-MM-DD', date_to?: 'YYYY-MM-DD',
//    status?: 'signed'|'pending'|'refused' }
// Retorna 200 sempre (success: true|false).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const ZAPSIGN_API = "https://api.zapsign.com.br/api/v1";
const PAGE_SIZE_HINT = 25;

function digits(s?: string | null): string {
  return String(s || "").replace(/\D/g, "");
}
function matchKey(phone?: string | null): string | null {
  const d = digits(phone);
  return d ? d.slice(-10) : null;
}
function normVar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

// Mapeia answers ZapSign -> coluna de contacts/lead
function mapAnswerToFields(variable: string, value: string) {
  const v = normVar(variable);
  const out: { contact?: Record<string, string>; lead?: Record<string, string> } = {};
  const onlyDigits = digits(value);
  if (/^(CPF|NUMERO_DO_CPF|N_CPF|N_DO_CPF)$/.test(v)) {
    out.contact = { cpf: onlyDigits };
    out.lead = { lead_field12: onlyDigits, cpf: onlyDigits };
  } else if (/^(RG|N_DO_RG|NUMERO_DO_RG)$/.test(v)) {
    out.contact = { rg: value };
    out.lead = { lead_field13: value, rg: value };
  } else if (/(ENDERECO|RUA|LOGRADOURO)/.test(v) && !/(NUMERO|N$)/.test(v)) {
    out.contact = { street: value };
    out.lead = { lead_field14: value, street: value };
  } else if (/(BAIRRO)/.test(v)) {
    out.contact = { neighborhood: value };
    out.lead = { lead_field15: value, neighborhood: value };
  } else if (/(CEP)/.test(v)) {
    out.contact = { cep: onlyDigits };
    out.lead = { lead_field16: value, cep: onlyDigits };
  } else if (/(EMAIL|E_MAIL)/.test(v)) {
    out.contact = { email: value };
    out.lead = { lead_email: value };
  } else if (/(NOME|NOME_COMPLETO)$/.test(v)) {
    out.contact = { full_name: value };
  } else if (/(CIDADE|MUNICIPIO)/.test(v)) {
    out.contact = { city: value };
    out.lead = { city: value };
  } else if (/(ESTADO|UF)$/.test(v)) {
    out.contact = { state: value };
    out.lead = { state: value };
  }
  return out;
}

async function zapsignGet(path: string, token: string): Promise<any> {
  const r = await fetch(`${ZAPSIGN_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`ZapSign ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body.dry_run === true;
    const mode: string = body.mode || "incremental"; // incremental | restart | window
    const maxPages: number = Math.max(1, Math.min(20, Number(body.max_pages) || 5));
    const dateFrom: string | undefined = body.date_from;
    const dateTo: string | undefined = body.date_to;
    const statusFilter: string | undefined = body.status;

    const ZAPSIGN_TOKEN = (Deno.env.get("ZAPSIGN_API_TOKEN") || "").trim();
    const EXT_URL = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "").trim();
    const EXT_KEY = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    if (!ZAPSIGN_TOKEN || !EXT_URL || !EXT_KEY) {
      return new Response(JSON.stringify({ success: false, error: "Missing env: ZAPSIGN_API_TOKEN / EXTERNAL_SUPABASE_*" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sb = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

    // checkpoint
    const { data: stateRow } = await sb.from("zapsign_sync_state").select("*").eq("id", true).maybeSingle();
    let startPage = mode === "restart" ? 1 : Math.max(1, stateRow?.last_page || 1);
    if (mode === "window") startPage = 1;

    // run record
    let runId: string | null = null;
    if (!dryRun) {
      const { data: run } = await sb.from("zapsign_sync_runs").insert({
        mode, from_page: startPage, dry_run: dryRun, triggered_by: "ui", status: "running",
      }).select("id").single();
      runId = run?.id || null;
    }

    const counts: Record<string, number> = {
      pages: 0, docs: 0, contacts_created: 0, contacts_updated: 0,
      leads_enriched: 0, docs_upserted: 0, groups_linked: 0,
      skipped_no_phone: 0, errors: 0,
    };
    const errors: any[] = [];
    const summary: any[] = [];

    let page = startPage;
    let lastDocToken: string | null = stateRow?.last_doc_token || null;

    pages: for (let i = 0; i < maxPages; i++) {
      const qs = new URLSearchParams({ page: String(page), include_signers: "true", sort_order: "desc" });
      if (dateFrom) qs.set("created_from", dateFrom);
      if (dateTo) qs.set("created_to", dateTo);
      if (statusFilter) qs.set("status", statusFilter);
      let listData: any;
      try {
        listData = await zapsignGet(`/docs/?${qs.toString()}`, ZAPSIGN_TOKEN);
      } catch (e: any) {
        errors.push({ stage: "list", page, error: e.message });
        break;
      }
      const results = Array.isArray(listData) ? listData : (listData.results || []);
      counts.pages++;
      if (results.length === 0) break;

      for (const doc of results) {
        const docToken = doc.token;
        if (!docToken) continue;
        counts.docs++;
        const row: any = { doc_token: docToken, doc_name: doc.name, status: doc.status, signed_file: doc.signed_file };

        try {
          // detail (only if has signers w/ phone or signed)
          let detail = doc;
          let signers = doc.signers || [];
          if (!signers.length || !signers[0]?.phone_number || !doc.signed_file) {
            try { detail = await zapsignGet(`/docs/${docToken}/`, ZAPSIGN_TOKEN); signers = detail.signers || []; }
            catch (e: any) { errors.push({ doc: docToken, stage: "detail", error: e.message }); }
          }
          const answers: Array<{ variable: string; value: string }> = detail.answers || [];
          const signer = signers[0] || {};
          const signerPhone = `${signer.phone_country || ""}${signer.phone_number || ""}`;
          const signerName = signer.name || doc.name || "";
          row.signer_name = signerName;
          row.signer_phone = signerPhone || null;

          const key = matchKey(signerPhone);
          let contactId: string | null = null;
          let leadId: string | null = null;

          if (!key) {
            counts.skipped_no_phone++;
            row.outcome = "no_phone";
          } else {
            // ---- contacts match
            const phoneNorm = digits(signerPhone);
            // find existing
            const { data: existing } = await sb.from("contacts")
              .select("id, lead_id, full_name, cpf, rg, street, neighborhood, cep, email, whatsapp_group_id, deleted_at")
              .or(`phone.ilike.%${key}`)
              .limit(5);
            const match = (existing || []).find((c: any) => matchKey(c.phone || "") === key) || (existing || [])[0];

            if (match) contactId = match.id;
            leadId = match?.lead_id || null;

            // ---- merge enriched fields
            const contactPatch: Record<string, any> = {};
            const leadPatch: Record<string, any> = {};
            for (const ans of answers) {
              if (!ans?.value) continue;
              const m = mapAnswerToFields(ans.variable, String(ans.value));
              if (m.contact) for (const [k, v] of Object.entries(m.contact)) {
                if (!match || !(match as any)[k]) contactPatch[k] = v;
              }
              if (m.lead) Object.assign(leadPatch, m.lead);
            }

            // signer email/cpf as fallback
            if (signer.email && !match?.email) contactPatch.email = signer.email;
            if (signer.cpf) {
              const cpfD = digits(signer.cpf);
              if (cpfD && !match?.cpf) contactPatch.cpf = cpfD;
              if (cpfD) leadPatch.lead_field12 = leadPatch.lead_field12 || cpfD;
            }

            if (!dryRun) {
              if (!match) {
                const { data: newC, error: ce } = await sb.from("contacts").insert({
                  full_name: signerName,
                  phone: phoneNorm,
                  ...contactPatch,
                  action_source: "zapsign_bulk_sync",
                }).select("id").single();
                if (ce) { errors.push({ doc: docToken, stage: "contact_insert", error: ce.message }); }
                else { contactId = newC.id; counts.contacts_created++; }
              } else if (Object.keys(contactPatch).length > 0) {
                const { error: ue } = await sb.from("contacts").update(contactPatch).eq("id", match.id);
                if (ue) errors.push({ doc: docToken, stage: "contact_update", error: ue.message });
                else counts.contacts_updated++;
              }
            } else {
              if (!match) counts.contacts_created++;
              else if (Object.keys(contactPatch).length > 0) counts.contacts_updated++;
            }

            // ---- enrich lead (only if linked)
            if (leadId && Object.keys(leadPatch).length > 0 && !dryRun) {
              const { data: lead } = await sb.from("leads")
                .select("cpf, rg, cep, street, neighborhood, lead_field12, lead_field13, lead_field14, lead_field15, lead_field16, lead_email, city, state")
                .eq("id", leadId).maybeSingle();
              const finalPatch: Record<string, any> = {};
              for (const [k, v] of Object.entries(leadPatch)) {
                if (!lead || !(lead as any)[k]) finalPatch[k] = v;
              }
              if (Object.keys(finalPatch).length) {
                finalPatch.ocr_enriched_at = new Date().toISOString();
                finalPatch.ocr_source = "zapsign_bulk_sync";
                const { error: le } = await sb.from("leads").update(finalPatch).eq("id", leadId);
                if (le) errors.push({ doc: docToken, stage: "lead_update", error: le.message });
                else counts.leads_enriched++;
              }
            }

            // ---- whatsapp group lookup (last 10 digits inside participants jsonb)
            if (!match?.whatsapp_group_id) {
              const { data: groups } = await sb.from("whatsapp_groups_cache")
                .select("group_jid, instance_name, participants")
                .not("participants", "is", null).limit(2000);
              let foundJid: string | null = null;
              for (const g of (groups || [])) {
                const arr = Array.isArray(g.participants) ? g.participants : [];
                for (const p of arr) {
                  const pid = typeof p === "string" ? p : (p?.id || p?.jid || p?.phone || "");
                  if (matchKey(String(pid)) === key) { foundJid = g.group_jid; break; }
                }
                if (foundJid) break;
              }
              if (foundJid) {
                if (!dryRun && contactId) {
                  await sb.from("contacts").update({ whatsapp_group_id: foundJid }).eq("id", contactId);
                  if (leadId) await sb.from("leads").update({ whatsapp_group_id: foundJid }).eq("id", leadId);
                }
                counts.groups_linked++;
                row.group_jid = foundJid;
              }
            } else {
              row.group_jid = match.whatsapp_group_id;
            }
          }

          // ---- upsert zapsign_documents
          if (!dryRun) {
            const docRow: any = {
              doc_token: docToken,
              document_name: doc.name,
              status: doc.status,
              original_file_url: doc.original_file || null,
              signed_file_url: doc.signed_file || null,
              sign_url: signer?.sign_url || null,
              signer_name: signerName,
              signer_token: signer?.token || null,
              signer_email: signer?.email || null,
              signer_phone: signerPhone || null,
              signer_status: signer?.status || null,
              signed_at: doc.status === "signed" ? (signer?.signed_at || new Date().toISOString()) : null,
              template_data: { answers },
              contact_id: contactId,
              lead_id: leadId,
              instance_name: null,
              sent_via_whatsapp: false,
              whatsapp_phone: digits(signerPhone) || null,
            };
            const { error: de } = await sb.from("zapsign_documents").upsert(docRow, { onConflict: "doc_token" });
            if (de) errors.push({ doc: docToken, stage: "doc_upsert", error: de.message });
            else counts.docs_upserted++;
          } else {
            counts.docs_upserted++;
          }

          row.contact_id = contactId;
          row.lead_id = leadId;
          row.outcome = row.outcome || (contactId ? "linked" : "skipped");
          summary.push(row);
          lastDocToken = docToken;
        } catch (docErr: any) {
          counts.errors++;
          errors.push({ doc: docToken, stage: "doc_loop", error: docErr.message });
          summary.push({ ...row, outcome: "error", error: docErr.message });
        }
      }

      page++;
    }

    // update checkpoint
    if (!dryRun) {
      await sb.from("zapsign_sync_state").update({
        last_page: mode === "window" ? (stateRow?.last_page || 1) : page,
        last_doc_token: lastDocToken,
        last_run_at: new Date().toISOString(),
        total_processed: (stateRow?.total_processed || 0) + counts.docs,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (runId) {
        await sb.from("zapsign_sync_runs").update({
          finished_at: new Date().toISOString(),
          to_page: page - 1,
          pages_scanned: counts.pages,
          docs_scanned: counts.docs,
          counts, errors: errors.slice(0, 200),
          status: "done",
        }).eq("id", runId);
      }
    }

    return new Response(JSON.stringify({
      success: true, dry_run: dryRun, mode,
      from_page: startPage, to_page: page - 1,
      counts, errors: errors.slice(0, 50), summary: summary.slice(0, 200),
      checkpoint: { last_page: mode === "window" ? stateRow?.last_page : page, last_doc_token: lastDocToken },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

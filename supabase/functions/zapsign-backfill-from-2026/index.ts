// zapsign-backfill-from-2026
// ============================================================
// Lista TODOS os documentos ZapSign criados a partir de 01/01/2026
// (signed + pending), e para cada um:
//   1) Resolve board via kanban_boards.zapsign_template_id (External).
//      Se template não tiver mapeamento -> pula e adiciona ao relatório.
//   2) Dedup por doc_token em zapsign_documents (Cloud).
//      Se já existe com lead_id -> pula (mas tenta vincular grupo se faltar).
//   3) Cria/atualiza lead no External usando dados do signer (telefone, nome).
//   4) Upsert em zapsign_documents (Cloud) com lead_id, status, etc.
//   5) Chama find-contact-groups na instância "Raym" pra vincular grupo
//      (auto_linked=true em lead_whatsapp_groups). Se NÃO achar nenhum,
//      dispara create-whatsapp-group (1:1 com o contato).
//
// Body (POST): { dry_run?: boolean, limit?: number }
//   dry_run = true: só lista o que faria, não altera nada
//   limit: máximo de docs a processar (default 500)
//
// Sempre retorna HTTP 200 com { success, summary, errors, missing_templates }
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";
const TARGET_INSTANCE = "Raym"; // case-insensitive lookup
const FROM_DATE = "2026-01-01";
const PAGE_SIZE = 50;

interface KeywordRule {
  keyword: string;
  board_id: string;
}

interface SummaryRow {
  doc_token: string;
  doc_name: string | null;
  signer_name: string | null;
  signer_phone: string | null;
  status: string;
  outcome:
    | "skipped_no_phone"
    | "skipped_no_board"
    | "skipped_already_processed"
    | "lead_created"
    | "lead_updated"
    | "lead_linked_existing"
    | "error";
  matched_keyword?: string | null;
  board_id?: string | null;
  lead_id?: string | null;
  groups_linked?: number;
  group_create_dispatched?: boolean;
  reason?: string;
}

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function listZapsignDocs(
  zsToken: string,
  fromDateISO: string,
  hardLimit: number,
): Promise<any[]> {
  // API ZapSign IGNORA created_from/created_after — temos que filtrar client-side.
  // sort_order=desc retorna do mais novo pro mais antigo, então paramos quando
  // o created_at de um doc for anterior a fromDateISO.
  const fromTime = new Date(fromDateISO + "T00:00:00Z").getTime();
  const all: any[] = [];
  let page = 1;
  while (all.length < hardLimit) {
    const url = `${ZAPSIGN_API_URL}/docs/?sort_order=desc&page=${page}`;
    const res = await fetch(url, { headers: authHeaders(zsToken) });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`zapsign list page ${page} ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json().catch(() => null);
    const results: any[] = json?.results || json?.data || [];
    if (!results.length) break;
    let anyOlder = false;
    for (const r of results) {
      const ts = new Date(r.created_at || r.last_update_at || 0).getTime();
      if (ts >= fromTime) {
        all.push(r);
        if (all.length >= hardLimit) break;
      } else {
        anyOlder = true;
      }
    }
    if (anyOlder) break; // entrou em datas antigas, não tem mais nada útil
    if (!json?.next) break;
    page += 1;
    if (page > 200) break; // safety
  }
  return all.slice(0, hardLimit);
}

function inferBoardFromName(
  docName: string,
  rules: Array<{ keyword: string; board_id: string }>,
  defaultBoardId: string | null,
): { boardId: string | null; matchedKeyword: string | null } {
  const name = (docName || "").toLowerCase();
  for (const r of rules) {
    const kw = (r.keyword || "").toLowerCase().trim();
    if (kw && name.includes(kw)) {
      return { boardId: r.board_id, matchedKeyword: r.keyword };
    }
  }
  return { boardId: defaultBoardId, matchedKeyword: null };
}

async function getZapsignDoc(zsToken: string, docToken: string): Promise<any> {
  const res = await fetch(`${ZAPSIGN_API_URL}/docs/${docToken}/`, {
    headers: authHeaders(zsToken),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`zapsign get ${docToken} ${res.status}: ${txt.slice(0, 200)}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const errors: Array<{ doc_token?: string; error: string }> = [];
  const summary: SummaryRow[] = [];
  const missingTemplates = new Map<string, { name: string | null; count: number }>();

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dry_run === true;
    const limit: number = Math.min(Math.max(Number(body?.limit) || 500, 1), 2000);

    const zsToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    if (!zsToken) {
      return new Response(
        JSON.stringify({ success: false, error: "ZAPSIGN_API_TOKEN missing" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cloudUrl = Deno.env.get("SUPABASE_URL")!;
    const cloudKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cloud = createClient(cloudUrl, cloudKey);

    const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL") || "https://kmedldlepwiityjsdahz.supabase.co";
    const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
    const ext = createClient(extUrl, extKey);

    // ---- Pré-resolve mapeamento template -> board (External)
    const { data: boards } = await ext
      .from("kanban_boards")
      .select("id, name, zapsign_template_id, product_service_id")
      .not("zapsign_template_id", "is", null);
    const templateToBoard = new Map<string, { id: string; name: string }>();
    for (const b of boards || []) {
      if (b.zapsign_template_id) templateToBoard.set(b.zapsign_template_id, { id: b.id, name: b.name });
    }
    console.log(`[backfill] template->board mappings: ${templateToBoard.size}`);

    // ---- Pré-resolve instância Raym (Cloud)
    const { data: inst } = await cloud
      .from("whatsapp_instances")
      .select("instance_name, base_url, instance_token")
      .ilike("instance_name", TARGET_INSTANCE)
      .maybeSingle();
    if (!inst?.instance_token) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `instance ${TARGET_INSTANCE} not found or no token`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const targetInstanceName = inst.instance_name;

    // ---- Pré-resolve acolhedor (dono da instância)
    let acolhedor: string | null = null;
    {
      const { data: instRow } = await ext
        .from("whatsapp_instances")
        .select("id, owner_name")
        .ilike("instance_name", targetInstanceName)
        .maybeSingle();
      if (instRow?.id) {
        const { data: ownerProfile } = await ext
          .from("profiles")
          .select("full_name, email")
          .eq("default_instance_id", instRow.id)
          .maybeSingle();
        acolhedor = ownerProfile?.full_name || ownerProfile?.email || instRow.owner_name || null;
      }
    }

    // ---- Lista contratos
    const docs = await listZapsignDocs(zsToken, FROM_DATE, limit);
    console.log(`[backfill] zapsign returned ${docs.length} docs from ${FROM_DATE}`);

    for (const docLite of docs) {
      const docToken: string = docLite.token || docLite.doc_token;
      if (!docToken) continue;

      const row: SummaryRow = {
        doc_token: docToken,
        template_name: docLite?.template?.name || docLite?.template_name || null,
        signer_name: null,
        signer_phone: null,
        status: docLite.status || "unknown",
        outcome: "skipped_no_phone",
      };

      try {
        // Busca detalhes (signers + template token)
        const doc = await getZapsignDoc(zsToken, docToken);
        const signer = (doc.signers || [])[0] || {};
        const phoneRaw: string = signer.phone_number || signer.phone || "";
        const phoneCountry: string = signer.phone_country || "";
        const fullPhone = phoneRaw.startsWith("+") || phoneCountry === ""
          ? digits(phoneRaw)
          : digits(phoneCountry + phoneRaw);
        const signerName: string = signer.name || "Lead";
        const templateToken: string = doc?.template?.token || doc?.template_id || docLite?.template?.token || "";
        const templateName: string = doc?.template?.name || row.template_name || "";

        row.template_name = templateName || null;
        row.signer_name = signerName;
        row.signer_phone = fullPhone || null;
        row.status = doc.status || row.status;

        if (!fullPhone) {
          row.outcome = "skipped_no_phone";
          row.reason = "signer has no phone";
          summary.push(row);
          continue;
        }

        // Mapeamento de template
        const board = templateToken ? templateToBoard.get(templateToken) : null;
        if (!board) {
          row.outcome = "skipped_no_template_mapping";
          row.reason = templateToken ? `template ${templateToken} not mapped` : "doc has no template";
          if (templateToken) {
            const cur = missingTemplates.get(templateToken);
            missingTemplates.set(templateToken, {
              name: templateName || cur?.name || null,
              count: (cur?.count || 0) + 1,
            });
          }
          summary.push(row);
          continue;
        }

        // Dedup: já processamos esse doc?
        const { data: existingDoc } = await cloud
          .from("zapsign_documents")
          .select("id, lead_id, status")
          .eq("doc_token", docToken)
          .maybeSingle();

        let leadId: string | null = existingDoc?.lead_id || null;
        let outcome: SummaryRow["outcome"] = "lead_linked_existing";

        if (dryRun) {
          row.outcome = leadId ? "lead_linked_existing" : "lead_created";
          row.reason = "dry_run";
          row.lead_id = leadId;
          summary.push(row);
          continue;
        }

        if (!leadId) {
          // Tenta achar lead existente por telefone (último 10 dígitos)
          const last10 = fullPhone.slice(-10);
          const { data: existingLead } = await ext
            .from("leads")
            .select("id, lead_name, board_id, lead_phone")
            .ilike("lead_phone", `%${last10}%`)
            .limit(1)
            .maybeSingle();

          if (existingLead?.id) {
            leadId = existingLead.id;
            outcome = "lead_updated";
            // Atualiza board e acolhedor se vazios
            const upd: Record<string, any> = {};
            if (!existingLead.board_id) upd.board_id = board.id;
            if (acolhedor) upd.acolhedor = acolhedor;
            if (Object.keys(upd).length > 0) {
              await ext.from("leads").update(upd).eq("id", leadId);
            }
          } else {
            const insertPayload: Record<string, any> = {
              lead_name: signerName,
              lead_phone: fullPhone,
              board_id: board.id,
              acolhedor,
              lead_source: "zapsign_backfill",
            };
            const { data: newLead, error: insErr } = await ext
              .from("leads")
              .insert(insertPayload)
              .select("id")
              .single();
            if (insErr) throw new Error(`lead insert: ${insErr.message}`);
            leadId = newLead!.id;
            outcome = "lead_created";
          }
        }

        // Upsert zapsign_documents (Cloud)
        await cloud.from("zapsign_documents").upsert(
          {
            doc_token: docToken,
            template_id: templateToken || null,
            template_name: templateName || null,
            document_name: doc.name || templateName || "Documento ZapSign",
            status: doc.status || "pending",
            original_file_url: doc.original_file || null,
            signed_file_url: doc.signed_file || null,
            sign_url: signer.sign_url || null,
            lead_id: leadId,
            signer_name: signerName,
            signer_token: signer.token || null,
            signer_email: signer.email || null,
            signer_phone: fullPhone,
            signer_status: signer.status || null,
            signed_at: signer.signed_at || null,
            instance_name: targetInstanceName,
          },
          { onConflict: "doc_token" },
        );

        // Vincular grupo via find-contact-groups
        let groupsLinked = 0;
        let groupCreateDispatched = false;
        try {
          const fcgRes = await fetch(
            `${cloudUrl}/functions/v1/find-contact-groups`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${cloudKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                phone: fullPhone,
                instance_name: targetInstanceName,
              }),
            },
          );
          const fcgJson = await fcgRes.json().catch(() => null);
          const groups: any[] = Array.isArray(fcgJson?.groups) ? fcgJson.groups : [];

          if (groups.length > 0) {
            const rows = groups.map((g) => ({
              lead_id: leadId,
              group_jid: g.jid,
              group_name: g.name,
              group_link: g.invite_link,
              instance_name: targetInstanceName,
              auto_linked: true,
            }));
            const { error: lwgErr } = await cloud
              .from("lead_whatsapp_groups")
              .upsert(rows, { onConflict: "lead_id,group_jid" });
            if (lwgErr) console.warn(`[backfill] lwg upsert ${docToken}:`, lwgErr.message);
            else groupsLinked = rows.length;

            // Compat: grava 1º grupo no lead.whatsapp_group_id se vazio
            const first = groups[0];
            const { data: leadCur } = await ext
              .from("leads")
              .select("whatsapp_group_id")
              .eq("id", leadId)
              .maybeSingle();
            if (!leadCur?.whatsapp_group_id) {
              await ext.from("leads").update({
                whatsapp_group_id: first.jid,
                group_link: first.invite_link || null,
              }).eq("id", leadId);
            }
          } else {
            // Fallback: dispara create-whatsapp-group (1:1)
            try {
              fetch(`${cloudUrl}/functions/v1/create-whatsapp-group`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${cloudKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  lead_id: leadId,
                  instance_name: targetInstanceName,
                  participant_phone: fullPhone,
                  source: "zapsign_backfill",
                }),
              }).catch((e) => console.warn(`[backfill] cwg dispatch ${docToken}:`, e));
              groupCreateDispatched = true;
            } catch (e) {
              console.warn(`[backfill] create-whatsapp-group dispatch failed:`, e);
            }
          }
        } catch (e) {
          console.warn(`[backfill] group resolution ${docToken}:`, e);
        }

        row.outcome = outcome;
        row.lead_id = leadId;
        row.groups_linked = groupsLinked;
        row.group_create_dispatched = groupCreateDispatched;
        summary.push(row);
      } catch (e) {
        const msg = (e as any)?.message || String(e);
        console.error(`[backfill] doc ${docToken} error:`, msg);
        row.outcome = "error";
        row.reason = msg;
        summary.push(row);
        errors.push({ doc_token: docToken, error: msg });
      }
    }

    const counts = summary.reduce<Record<string, number>>((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {});

    return new Response(
      JSON.stringify({
        success: true,
        from_date: FROM_DATE,
        instance: targetInstanceName,
        scanned: docs.length,
        counts,
        missing_templates: Array.from(missingTemplates.entries()).map(([token, v]) => ({
          template_token: token,
          template_name: v.name,
          docs_count: v.count,
        })),
        summary,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as any)?.message || String(e);
    console.error("[backfill] fatal:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

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
import { remapToExternal } from "../_shared/uuid-remap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
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
  enrich_dispatched?: boolean;
  enrich_skipped_reason?: string | null;
  doc_upserted?: boolean;
  doc_upsert_error?: string | null;
  lead_closed?: boolean;
  case_created?: boolean;
  case_number?: string | null;
  case_error?: string | null;
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

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dry_run === true;
    const limit: number = Math.min(Math.max(Number(body?.limit) || 500, 1), 2000);
    const keywordRules: KeywordRule[] = Array.isArray(body?.keyword_rules) ? body.keyword_rules : [];
    const defaultBoardId: string | null = body?.default_board_id || null;

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

    // ---- Valida boards usados nas regras (Cloud — kanban_boards está no Cloud)
    const allBoardIds = Array.from(new Set([
      ...keywordRules.map((r) => r.board_id).filter(Boolean),
      ...(defaultBoardId ? [defaultBoardId] : []),
    ]));
    if (allBoardIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "no keyword_rules nor default_board_id provided",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: boardsData } = await cloud
      .from("kanban_boards")
      .select("id, name")
      .in("id", allBoardIds);
    const boardMap = new Map<string, { id: string; name: string }>();
    for (const b of boardsData || []) boardMap.set(b.id, b);
    console.log(`[backfill] ${boardMap.size}/${allBoardIds.length} boards resolved`);

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
    let createdByUserId: string | null = null;
    {
      const { data: instRow } = await cloud
        .from("whatsapp_instances")
        .select("id, owner_name")
        .ilike("instance_name", targetInstanceName)
        .maybeSingle();
      if (instRow?.id) {
        const { data: ownerProfile } = await cloud
          .from("profiles")
          .select("full_name, email")
          .eq("default_instance_id", instRow.id)
          .maybeSingle();
        acolhedor = ownerProfile?.full_name || ownerProfile?.email || (instRow as any).owner_name || null;
        createdByUserId = ownerProfile?.user_id || null;
      }
    }

    // ---- Lista contratos
    const docs = await listZapsignDocs(zsToken, FROM_DATE, limit);
    console.log(`[backfill] zapsign returned ${docs.length} docs from ${FROM_DATE}`);

    for (const docLite of docs) {
      const docToken: string = docLite.token || docLite.doc_token;
      if (!docToken) continue;

      const docName: string = docLite.name || docLite.document_name || "";

      const row: SummaryRow = {
        doc_token: docToken,
        doc_name: docName || null,
        signer_name: null,
        signer_phone: null,
        status: docLite.status || "unknown",
        outcome: "skipped_no_phone",
      };

      try {
        // Busca detalhes (signers)
        const doc = await getZapsignDoc(zsToken, docToken);
        const signer = (doc.signers || [])[0] || {};
        const phoneRaw: string = signer.phone_number || signer.phone || "";
        const phoneCountry: string = signer.phone_country || "";
        const fullPhone = phoneRaw.startsWith("+") || phoneCountry === ""
          ? digits(phoneRaw)
          : digits(phoneCountry + phoneRaw);
        const signerName: string = signer.name || "Lead";
        const finalDocName: string = doc.name || docName;

        row.doc_name = finalDocName || null;
        row.signer_name = signerName;
        row.signer_phone = fullPhone || null;
        row.status = doc.status || row.status;

        if (!fullPhone || fullPhone.length < 8) {
          row.outcome = "skipped_no_phone";
          row.reason = "signer has no valid phone";
          summary.push(row);
          continue;
        }

        // Inferência por nome do arquivo
        const { boardId, matchedKeyword } = inferBoardFromName(
          finalDocName,
          keywordRules,
          defaultBoardId,
        );
        row.matched_keyword = matchedKeyword;
        row.board_id = boardId;

        if (!boardId || !boardMap.has(boardId)) {
          row.outcome = "skipped_no_board";
          row.reason = boardId
            ? `board ${boardId} not found`
            : "no keyword matched and no default_board_id";
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
            if (!existingLead.board_id) upd.board_id = boardId;
            if (acolhedor) upd.acolhedor = acolhedor;
            if (Object.keys(upd).length > 0) {
              await ext.from("leads").update(upd).eq("id", leadId);
            }
          } else {
            const insertPayload: Record<string, any> = {
              lead_name: signerName,
              lead_phone: fullPhone,
              board_id: boardId,
              acolhedor,
              action_source: "system",
              action_source_detail: "zapsign_backfill",
              created_by: createdByUserId,
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

        // Upsert zapsign_documents (EXTERNAL — leads vivem no externo, FK exige isso)
        let docUpserted = false;
        let docUpsertError: string | null = null;
        const { error: docUpsertErr } = await ext.from("zapsign_documents").upsert(
          {
            doc_token: docToken,
            template_id: null,
            template_name: null,
            document_name: finalDocName || "Documento ZapSign",
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
            created_by: createdByUserId,
          },
          { onConflict: "doc_token" },
        );
        if (docUpsertErr) {
          docUpsertError = docUpsertErr.message;
          console.warn(`[backfill] zapsign_documents upsert ${docToken}:`, docUpsertErr.message);
        } else {
          docUpserted = true;
        }

        // Vincular grupo via find-contact-groups (gravado no EXTERNAL)
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
            const { error: lwgErr } = await ext
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

        // ---- Dispara enrich (extrai CPF/RG/endereço/data + sobe PDF no Drive)
        // Só faz sentido para docs assinados com PDF disponível.
        let enrichDispatched = false;
        let enrichSkippedReason: string | null = null;
        const signedUrl = doc.signed_file || null;
        const isSigned = (doc.status || "").toLowerCase() === "signed";
        if (!isSigned) {
          enrichSkippedReason = `status=${doc.status || "unknown"} (precisa estar signed)`;
        } else if (!signedUrl) {
          enrichSkippedReason = "sem signed_file_url";
        } else {
          try {
            // fire-and-forget — enrich pode demorar (Vision + Drive upload)
            fetch(`${cloudUrl}/functions/v1/zapsign-enrich-lead`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${cloudKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                lead_id: leadId,
                signed_file_url: signedUrl,
                instance_name: targetInstanceName,
                doc_token: docToken,
                document_name: finalDocName,
              }),
            }).catch((e) => console.warn(`[backfill] enrich dispatch ${docToken}:`, e));
            enrichDispatched = true;
          } catch (e) {
            console.warn(`[backfill] enrich dispatch failed ${docToken}:`, e);
            enrichSkippedReason = (e as any)?.message || String(e);
          }
        }

        // ---- Se assinado: fechar lead + criar caso jurídico (replica zapsign-webhook)
        let leadClosed = false;
        let caseCreated = false;
        let caseNumber: string | null = null;
        let caseError: string | null = null;
        if (isSigned) {
          try {
            // 1) Mover lead para última stage do board e marcar como closed
            const { data: boardData } = await cloud
              .from("kanban_boards")
              .select("stages")
              .eq("id", boardId)
              .maybeSingle();
            const stages = (boardData?.stages as any[]) || [];
            const lastStage = stages.length > 0 ? stages[stages.length - 1] : null;
            const updatePayload: Record<string, any> = {
              status: lastStage?.id || "closed",
              lead_status: "closed",
            };
            const signedAtIso = signer.signed_at || new Date().toISOString();
            updatePayload.became_client_date = signedAtIso.slice(0, 10);
            const { error: leadUpdErr } = await ext.from("leads").update(updatePayload).eq("id", leadId);
            if (leadUpdErr) {
              caseError = `lead update: ${leadUpdErr.message}`;
            } else {
              leadClosed = true;
            }

            // 2) Verificar se já existe caso para este lead
            const { data: existingCase } = await ext
              .from("legal_cases")
              .select("id, case_number")
              .eq("lead_id", leadId)
              .maybeSingle();

            if (existingCase) {
              caseCreated = false;
              caseNumber = existingCase.case_number;
            } else {
              const { data: caseNumRpc, error: rpcErr } = await ext.rpc("generate_case_number", {
                p_nucleus_id: null,
              });
              if (rpcErr) throw new Error(`generate_case_number: ${rpcErr.message}`);
              caseNumber = caseNumRpc as string;

              const { data: createdCase, error: caseInsErr } = await ext
                .from("legal_cases")
                .insert({
                  case_number: caseNumber,
                  title: `Caso - ${signerName || "Novo"}`,
                  lead_id: leadId,
                  status: "em_andamento",
                  acolhedor,
                  action_source: "system",
                  action_source_detail: "zapsign_backfill",
                  created_by: createdByUserId,
                  assigned_to: createdByUserId,
                })
                .select("id")
                .single();
              if (caseInsErr) throw new Error(`legal_cases insert: ${caseInsErr.message}`);
              caseCreated = true;

              // 3) case_process_tracking
              try {
                await ext.from("case_process_tracking").insert({
                  case_id: createdCase!.id,
                  lead_id: leadId,
                  cliente: signerName || "",
                  caso: `Caso - ${signerName || "Novo"}`,
                  acolhedor,
                  data_criacao: new Date().toISOString().split("T")[0],
                  import_source: "auto_zapsign_backfill",
                });
              } catch (trackErr) {
                console.warn(`[backfill] case_process_tracking ${docToken}:`, trackErr);
              }

              // 4) Atividade ONBOARDING (apenas se prefixo CASO-)
              if (caseNumber && caseNumber.startsWith("CASO")) {
                try {
                  const wanessaCloudUuid = "1f788b8d-e30e-484a-9460-39a881d25128";
                  const wanessaExtUuid = await remapToExternal(ext, wanessaCloudUuid);
                  await ext.from("lead_activities").insert({
                    lead_id: leadId,
                    lead_name: signerName || "Novo",
                    title: "ONBOARDING CLIENTE",
                    description: `Atividade de onboarding criada automaticamente para o caso ${caseNumber}`,
                    activity_type: "tarefa",
                    status: "pendente",
                    priority: "alta",
                    assigned_to: wanessaExtUuid,
                    assigned_to_name: "Wanessa Vitória Rodrigues de Sousa",
                    deadline: new Date().toISOString().split("T")[0],
                  });
                } catch (onbErr) {
                  console.warn(`[backfill] onboarding activity ${docToken}:`, onbErr);
                }
              }
            }
          } catch (e) {
            caseError = (e as any)?.message || String(e);
            console.warn(`[backfill] case creation ${docToken}:`, caseError);
          }
        }

        row.outcome = outcome;
        row.lead_id = leadId;
        row.groups_linked = groupsLinked;
        row.group_create_dispatched = groupCreateDispatched;
        row.enrich_dispatched = enrichDispatched;
        row.enrich_skipped_reason = enrichSkippedReason;
        row.doc_upserted = docUpserted;
        row.doc_upsert_error = docUpsertError;
        row.lead_closed = leadClosed;
        row.case_created = caseCreated;
        row.case_number = caseNumber;
        row.case_error = caseError;
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
        dry_run: dryRun,
        from_date: FROM_DATE,
        instance: targetInstanceName,
        scanned: docs.length,
        counts,
        keyword_rules_used: keywordRules.length,
        default_board_used: defaultBoardId || null,
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

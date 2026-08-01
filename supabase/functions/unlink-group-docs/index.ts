// Desvincular grupo de WhatsApp de um caso → limpar os documentos que vieram
// daquele grupo (Google Drive + process_documents).
//
// Contrapartida do import-group-docs-to-lead: aquele traz toda mídia do grupo
// pra pasta do lead no Drive; aqui, quando o grupo deixa de pertencer ao caso
// (grupo colado errado, cliente trocado), o material do grupo sai junto — senão
// o caso fica com documento de outra pessoa na pasta.
//
// Body:
// {
//   lead_id: string,
//   group_jid: string,
//   dry_run?: boolean,    // só lista o que seria apagado, não toca em nada
//   permanent?: boolean,  // DELETE definitivo no Drive (default: lixeira)
// }
//
// Default é LIXEIRA do Drive (trashed=true), não delete definitivo: a lixeira
// segura ~30 dias e é a rota de fuga se o desvínculo tiver sido engano.
// O backup em Storage (bucket whatsapp-media) NÃO é apagado — a mídia continua
// no WhatsApp de qualquer forma, e ele é o que permite reimportar depois.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  lead_id?: string;
  group_jid?: string;
  dry_run?: boolean;
  permanent?: boolean;
}

// lead_whatsapp_groups às vezes guarda o jid sem o sufixo @g.us, e
// whatsapp_messages.phone guarda com. Comparação sempre pelo número puro.
function bareJid(value: unknown): string {
  return String(value || "").split("@")[0].replace(/\D/g, "");
}

// webViewLink do Drive: https://drive.google.com/file/d/<ID>/view?usp=...
// Serve de plano B quando metadata.drive_file_id não foi gravado (import antigo
// ou resposta de dedup sem o id).
function driveIdFromUrl(url: unknown): string | null {
  const s = String(url || "");
  const m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const leadId = String(body.lead_id || "").trim();
    const targetJid = bareJid(body.group_jid);
    if (!leadId) return json({ error: "lead_id required" }, 400);
    if (!targetJid) return json({ error: "group_jid required" }, 400);

    const dryRun = !!body.dry_run;
    const permanent = !!body.permanent;

    const cloud = createClient(SUPABASE_URL, SERVICE_KEY);
    const ext = createClient(EXT_URL, EXT_KEY);

    // 1) Todos os documentos do lead importados de grupo. Volume por lead é
    //    baixo (dezenas), então filtra em memória — evita depender de operador
    //    de JSON no PostgREST pra casar as duas grafias do jid.
    const { data: docs, error: selErr } = await cloud
      .from("process_documents")
      .select("id, title, file_name, file_url, metadata")
      .eq("lead_id", leadId)
      .eq("source", "whatsapp_group")
      .limit(1000);
    if (selErr) return json({ error: `select process_documents failed: ${selErr.message}` }, 500);

    const all = docs || [];

    // 2) Documento antigo pode ter vindo sem group_jid no metadata. Nesses casos
    //    o grupo é descoberto pelo external_message_id (whatsapp_messages.phone).
    const missingJid = all.filter((d: any) => !bareJid(d?.metadata?.group_jid));
    const phoneByMsgId = new Map<string, string>();
    if (missingJid.length > 0) {
      const msgIds = missingJid
        .map((d: any) => String(d?.metadata?.external_message_id || "").trim())
        .filter(Boolean);
      if (msgIds.length > 0) {
        try {
          const { data: msgs } = await ext
            .from("whatsapp_messages")
            .select("external_message_id, phone")
            .in("external_message_id", msgIds);
          for (const m of msgs || []) {
            if (m?.external_message_id && m?.phone) {
              phoneByMsgId.set(String(m.external_message_id), String(m.phone));
            }
          }
        } catch (e) {
          console.warn("[unlink-group-docs] lookup de phone por message_id falhou:", e);
        }
      }
    }

    const docJid = (d: any): string => {
      const direct = bareJid(d?.metadata?.group_jid);
      if (direct) return direct;
      const msgId = String(d?.metadata?.external_message_id || "").trim();
      return bareJid(phoneByMsgId.get(msgId));
    };

    const matched = all.filter((d: any) => docJid(d) === targetJid);

    const results: any[] = [];
    const rowsToDelete: string[] = [];

    for (const doc of matched) {
      const fileId = (doc as any)?.metadata?.drive_file_id || driveIdFromUrl((doc as any).file_url);
      const label = (doc as any).file_name || (doc as any).title || (doc as any).id;

      if (dryRun) {
        results.push({ document_id: (doc as any).id, file_name: label, drive_file_id: fileId, status: "dry_run" });
        continue;
      }

      // Sem arquivo no Drive (upload falhou na importação): só o registro sai.
      if (!fileId) {
        rowsToDelete.push((doc as any).id);
        results.push({ document_id: (doc as any).id, file_name: label, status: "row_only_no_drive_file" });
        continue;
      }

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/lead-drive`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY,
          },
          body: JSON.stringify({
            action: permanent ? "delete" : "trash",
            lead_id: leadId,
            file_id: fileId,
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out?.success === false || out?.error) {
          // Drive falhou → registro FICA. Apagar a linha aqui deixaria o arquivo
          // órfão na pasta do caso, sem nada apontando pra ele.
          results.push({
            document_id: (doc as any).id,
            file_name: label,
            drive_file_id: fileId,
            status: "drive_failed",
            error: out?.error || `http ${res.status}`,
          });
          continue;
        }
        rowsToDelete.push((doc as any).id);
        results.push({
          document_id: (doc as any).id,
          file_name: label,
          drive_file_id: fileId,
          status: permanent ? "drive_deleted" : "drive_trashed",
          already_gone: !!out?.already_gone,
        });
      } catch (e: any) {
        results.push({
          document_id: (doc as any).id,
          file_name: label,
          drive_file_id: fileId,
          status: "drive_failed",
          error: e?.message || String(e),
        });
      }
    }

    let deletedRows = 0;
    let deleteError: string | null = null;
    if (rowsToDelete.length > 0) {
      const { error: delErr } = await cloud.from("process_documents").delete().in("id", rowsToDelete);
      if (delErr) deleteError = delErr.message;
      else deletedRows = rowsToDelete.length;
    }

    const failed = results.filter((r) => r.status === "drive_failed").length;

    return json({
      ok: !deleteError,
      lead_id: leadId,
      group_jid: body.group_jid,
      dry_run: dryRun,
      permanent,
      scanned: all.length,
      matched: matched.length,
      removed: deletedRows,
      failed,
      delete_error: deleteError,
      results,
    });
  } catch (e: any) {
    console.error("[unlink-group-docs] error:", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

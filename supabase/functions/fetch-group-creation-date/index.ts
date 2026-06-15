import { getExternalClient } from "../_shared/external-client.ts";
const FUNCTION_VERSION = 4;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

const json = (body: Record<string, unknown>) => new Response(
  JSON.stringify({ _functionVersion: FUNCTION_VERSION, ...body }),
  { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
);

const digitsOnly = (value: unknown) => String(value || "").split("@")[0].replace(/\D/g, "");

const payloadOf = (data: any) => data?.data || data || {};

const extractCreationTs = (data: any) => {
  const p = payloadOf(data);
  return p?.creation || p?.GroupCreated || p?.created_at || data?.creation || data?.GroupCreated || data?.created_at;
};

const extractOwnerPn = (data: any): string | null => {
  const p = payloadOf(data);
  const raw = p?.OwnerPN || p?.owner_pn || p?.ownerPN || p?.owner || p?.creator || data?.OwnerPN || data?.owner_pn || data?.owner || data?.creator || "";
  const digits = digitsOnly(raw);
  return digits ? digits : null;
};

const extractOwnerJid = (data: any): string | null => {
  const p = payloadOf(data);
  return p?.OwnerJID || p?.owner_jid || p?.GroupOwner || p?.owner || data?.OwnerJID || data?.owner_jid || data?.GroupOwner || null;
};

const extractSubject = (data: any, fallback = "") => {
  const p = payloadOf(data);
  return String(p?.subject || p?.name || p?.Name || data?.subject || data?.name || data?.Name || fallback || "").trim();
};

const toIso = (creationTs: unknown): string | null => {
  if (!creationTs) return null;
  const d = typeof creationTs === "number" ? new Date(creationTs * 1000) : new Date(String(creationTs));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const findInstanceByPhone = (instances: any[], phone: string | null): any | null => {
  if (!phone) return null;
  const exact = instances.find((i) => digitsOnly(i?.owner_phone) === phone);
  if (exact) return exact;
  // Fallback por últimos 8 dígitos — variações de DDI/9º dígito.
  const tail = phone.slice(-8);
  if (tail.length < 8) return null;
  return instances.find((i) => digitsOnly(i?.owner_phone).slice(-8) === tail) || null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { lead_id, group_jid: groupJidInput, instance_name: instanceNameInput } = body || {};
    if (!lead_id && !groupJidInput) {
      return json({ success: false, error: "lead_id or group_jid is required" });
    }

    const extClient = getExternalClient();

    let groupJid: string | null = groupJidInput || null;
    let groups: any[] | null = null;

    if (!groupJid && lead_id) {
      // Get group JID for this lead
      const { data } = await extClient
        .from("lead_whatsapp_groups")
        .select("group_jid, group_name")
        .eq("lead_id", lead_id)
        .order("created_at", { ascending: false })
        .limit(1);
      groups = data;
      groupJid = data?.[0]?.group_jid ?? null;

      if (!groupJid) {
        // Fallback: check leads.whatsapp_group_id (External)
        const { data: lead } = await extClient
          .from("leads")
          .select("whatsapp_group_id")
          .eq("id", lead_id)
          .maybeSingle();
        groupJid = (lead as any)?.whatsapp_group_id ?? null;
      }
    }


    if (!groupJid) {
      return json({ success: false, error: "No group linked to this lead" });
    }

    if (!groupJid.includes("@")) {
      groupJid = `${groupJid}@g.us`;
    }

    // Pega qualquer instância com token — não exige status='connected' porque
    // pode estar como 'open'/'active' e ainda assim responder ao /group/info.
    // Ordena: connected primeiro, depois as outras.
    // whatsapp_instances vivem no Externo (não no Cloud).
    const { data: instances } = await extClient
      .from("whatsapp_instances")
      .select("id, instance_name, instance_token, base_url, owner_phone, is_active")
      .not("instance_token", "is", null);

    const hintedInstance = String(instanceNameInput || "").trim().toLowerCase();
    const sortedInstances = (instances || []).sort((a: any, b: any) => {
      const score = (i: any) => {
        if (hintedInstance && String(i.instance_name || "").toLowerCase() === hintedInstance) return -1;
        return i.is_active ? 0 : 1;
      };
      return score(a) - score(b);
    });


    if (!sortedInstances.length) {
      return json({ success: false, error: "No instances with token available" });
    }

    const { data: existingSnapshot } = await extClient
      .from("whatsapp_groups_uazapi_snapshot")
      .select("seen_in_instances, owner_pn, group_created_at, group_name")
      .eq("jid", groupJid)
      .maybeSingle();

    let mergedSeen = Array.isArray((existingSnapshot as any)?.seen_in_instances)
      ? [...(existingSnapshot as any).seen_in_instances]
      : [];
    let best: { data: any; inst: any; creationIso: string | null; ownerPn: string | null; ownerJid: string | null; subject: string } | null = null;
    const tried: string[] = [];

    const MAX_TRIES = 12;
    const PER_CALL_MS = 4500;
    for (const inst of sortedInstances.slice(0, MAX_TRIES)) {
      const baseUrl = inst.base_url || "https://abraci.uazapi.com";
      tried.push(inst.instance_name);
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), PER_CALL_MS);
        const res = await fetch(`${baseUrl}/group/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token: inst.instance_token },
          body: JSON.stringify({ groupjid: groupJid }),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(tid));

        if (!res.ok) continue;
        const data = await res.json();
        const creationIso = toIso(extractCreationTs(data));
        const ownerPn = extractOwnerPn(data);
        const ownerJid = extractOwnerJid(data);
        const subject = extractSubject(data, groups?.[0]?.group_name || (existingSnapshot as any)?.group_name || "");
        const hasGroupData = !!(creationIso || ownerPn || subject || payloadOf(data)?.Participants || payloadOf(data)?.participants);
        if (!hasGroupData) continue;

        const ownerPhoneOfInst = digitsOnly((inst as any).owner_phone);
        const alreadyHas = mergedSeen.some((s: any) =>
          String(s?.id || "") === String(inst.id) ||
          (s?.name && String(s.name).toLowerCase() === String(inst.instance_name).toLowerCase())
        );
        if (!alreadyHas) mergedSeen.push({ id: inst.id, name: inst.instance_name, owner_phone: ownerPhoneOfInst });

        const candidate = { data, inst, creationIso, ownerPn, ownerJid, subject };
        if (!best || (!best.ownerPn && ownerPn) || (!best.creationIso && creationIso)) best = candidate;
        if (ownerPn && creationIso) break;
      } catch (e) {
        console.warn(`Instance ${inst.instance_name} failed:`, e);
      }
    }

    const finalCreationIso = best?.creationIso || (existingSnapshot as any)?.group_created_at || null;
    const finalOwnerPn = best?.ownerPn || digitsOnly((existingSnapshot as any)?.owner_pn) || null;
    const creatorInstance = findInstanceByPhone(instances || [], finalOwnerPn);
    if (best || finalCreationIso || finalOwnerPn) {
      const creationDate = finalCreationIso ? String(finalCreationIso).split("T")[0] : null;
      try {
        const upsertRow: any = {
          jid: groupJid,
          group_name: best?.subject || (existingSnapshot as any)?.group_name || null,
          last_synced_at: new Date().toISOString(),
          raw_data: best?.data ?? null,
          seen_in_instances: mergedSeen,
        };
        if (finalCreationIso) upsertRow.group_created_at = finalCreationIso;
        if (finalOwnerPn) upsertRow.owner_pn = finalOwnerPn;
        if (best?.ownerJid) upsertRow.owner_jid = best.ownerJid;
        if (creatorInstance?.instance_name) upsertRow.creator_instance_name = creatorInstance.instance_name;
        await extClient.from("whatsapp_groups_uazapi_snapshot").upsert(upsertRow, { onConflict: "jid" });
      } catch (persistErr) {
        console.warn("snapshot upsert failed:", persistErr);
      }

      return json({
        success: true,
        creation_date: creationDate,
        creation_iso: finalCreationIso,
        group_name: best?.subject || (existingSnapshot as any)?.group_name || "",
        owner_pn: finalOwnerPn,
        creator_instance_name: creatorInstance?.instance_name || null,
        instance_name: best?.inst?.instance_name || null,
        tried,
      });
    }

    return json({ success: false, error: "Could not fetch group info", tried });
  } catch (e: any) {
    return json({ success: false, error: e.message });
  }
});

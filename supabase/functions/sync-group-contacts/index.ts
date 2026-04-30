import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getExternalClient } from "../_shared/external-client.ts";
import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "../_shared/supabase-url-resolver.ts";

const INTERNAL_SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const INTERNAL_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

// Normalize to E.164-ish digits with BR country code
function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
  return digits;
}

// Returns the canonical "match key": last 10 digits (DDD + 8 base digits),
// stripping the optional 9th mobile digit. This is the SAME key for both
// "5519995705510" (13) and "551995705510" (12).
function phoneMatchKey(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  // Drop country code 55 if present
  let local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  // If 11 digits (DDD + 9 + 8), drop the leading 9 after DDD
  if (local.length === 11 && local[2] === "9") {
    local = local.slice(0, 2) + local.slice(3);
  }
  // Keep last 10 digits as the canonical key
  return local.slice(-10);
}

function extractPhoneFromJid(jid: string): string {
  return (jid || "").replace(/@.*$/, "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { group_jid, lead_id, instance_id } = await req.json();

    if (!group_jid || !lead_id) {
      return new Response(
        JSON.stringify({ error: "group_jid and lead_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const internalClient = createClient(INTERNAL_SUPABASE_URL, INTERNAL_SERVICE_ROLE_KEY);
    const extClient = getExternalClient();
    const dataClient = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);

    // 1. Build ordered list of instances to try
    const { data: allActiveInstances } = await internalClient
      .from("whatsapp_instances")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (!allActiveInstances || allActiveInstances.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No active WhatsApp instance found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orderedInstances: any[] = [];
    if (instance_id) {
      const preferred = allActiveInstances.find((i: any) => i.id === instance_id);
      if (preferred) orderedInstances.push(preferred);
    }
    for (const inst of allActiveInstances) {
      if (!orderedInstances.some((o: any) => o.id === inst.id)) {
        orderedInstances.push(inst);
      }
    }

    // 2. Build BLOCKLIST of phone match-keys to ignore (instances + staff)
    const blocklistKeys = new Set<string>();

    // 2a. Instance owners
    for (const inst of orderedInstances) {
      const k = phoneMatchKey(inst.owner_phone || "");
      if (k.length >= 10) blocklistKeys.add(k);
    }

    // 2b. Profiles (any system user phone)
    try {
      const { data: profiles } = await internalClient
        .from("profiles")
        .select("phone");
      for (const p of profiles || []) {
        const k = phoneMatchKey((p as any).phone || "");
        if (k.length >= 10) blocklistKeys.add(k);
      }
    } catch (e) {
      console.log("Could not load profiles for blocklist:", (e as any)?.message);
    }

    // 2c. Contacts already classified as staff/collaborator/lawyer/attendant
    try {
      const { data: staffContacts } = await dataClient
        .from("contacts")
        .select("phone, classification")
        .in("classification", ["staff", "collaborator", "lawyer", "attendant"]);
      for (const c of staffContacts || []) {
        const k = phoneMatchKey((c as any).phone || "");
        if (k.length >= 10) blocklistKeys.add(k);
      }
    } catch (e) {
      console.log("Could not load staff contacts for blocklist:", (e as any)?.message);
    }

    console.log(`Blocklist size (match-keys): ${blocklistKeys.size}`);

    // 3. Fetch group participants from UazAPI
    let groupJid = (group_jid || "").trim();
    if (!groupJid.includes("@")) {
      groupJid = `${groupJid}@g.us`;
    }
    if (!groupJid.endsWith("@g.us")) {
      return new Response(
        JSON.stringify({ success: false, error: `Formato de JID inválido: ${groupJid}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let groupData: any = null;
    let usedInstanceName = "";
    let lastError = "";

    for (const inst of orderedInstances) {
      const baseUrl = inst.base_url || "https://abraci.uazapi.com";
      console.log(`Trying instance: ${inst.instance_name} for group ${groupJid}`);
      try {
        const infoRes = await fetch(`${baseUrl}/group/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token: inst.instance_token },
          body: JSON.stringify({ groupjid: groupJid }),
        });
        if (infoRes.ok) {
          groupData = await infoRes.json();
          usedInstanceName = inst.instance_name;
          console.log(`Success with instance: ${inst.instance_name}`);
          break;
        } else {
          const errText = await infoRes.text();
          lastError = `${inst.instance_name}: ${errText}`;
          console.log(`Instance ${inst.instance_name} failed: ${lastError}`);
          if (infoRes.status === 400 && !errText.includes("not participating")) break;
        }
      } catch (e: any) {
        lastError = `${inst.instance_name}: ${e.message}`;
      }
    }

    if (!groupData) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Nenhuma instância tem acesso ao grupo. Último erro: ${lastError}`,
          tried_instances: orderedInstances.map((i: any) => i.instance_name),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const participants = groupData?.participants || groupData?.Participants ||
      groupData?.data?.participants || [];
    console.log(`Group ${groupJid}: ${participants.length} participants found via ${usedInstanceName}`);

    // 4. Extract participant phones, deduped by match-key, blocklist applied
    type ParticipantPhone = { full: string; key: string };
    const participantPhones: ParticipantPhone[] = [];
    const seenKeys = new Set<string>();
    let blockedCount = 0;

    for (const p of participants) {
      const phoneJid = p.PhoneNumber || p.phoneNumber || p.phone_number || "";
      const jid = p.id || p.JID || p.jid || "";

      if (jid && jid.includes("@g.us")) continue;

      let phone = "";
      if (phoneJid && phoneJid.includes("@")) {
        phone = extractPhoneFromJid(phoneJid);
      } else if (phoneJid) {
        phone = phoneJid.replace(/\D/g, "");
      }
      if (!phone && jid && jid.includes("@s.whatsapp.net")) {
        phone = extractPhoneFromJid(jid);
      }
      if (!phone && jid && !jid.includes("@lid")) {
        phone = jid.replace(/\D/g, "");
      }

      if (!phone || phone.length < 10) {
        if (jid) console.log(`Skipped: invalid phone jid=${jid}`);
        continue;
      }

      const fullNorm = normalizePhone(phone);
      const key = phoneMatchKey(phone);

      if (!key || key.length < 10) continue;

      if (blocklistKeys.has(key)) {
        blockedCount++;
        console.log(`Blocked (staff/instance): ${fullNorm} key=${key}`);
        continue;
      }

      if (seenKeys.has(key)) continue; // dedupe
      seenKeys.add(key);

      participantPhones.push({ full: fullNorm, key });
      console.log(`Participant accepted: ${fullNorm} key=${key}`);
    }

    console.log(`After filtering: ${participantPhones.length} kept, ${blockedCount} blocked, ${participants.length} total`);

    // 5. Find existing contacts by EXACT match-key (no LIKE collisions)
    const allKeys = participantPhones.map((p) => p.key);
    const contactsByKey = new Map<string, any>();

    if (allKeys.length > 0) {
      // Pull contacts whose normalized phone ends with any of the keys.
      // We do this by fetching candidates per key with eq on the right-trimmed value.
      // Simpler: fetch all contacts whose phone digits end with one of the keys,
      // then filter in memory using phoneMatchKey for exactness.
      const orFilter = allKeys.map((k) => `phone.ilike.%${k}`).join(",");
      const { data: candidates } = await dataClient
        .from("contacts")
        .select("id, phone, full_name, classification")
        .or(orFilter)
        .is("deleted_at", null);

      for (const c of candidates || []) {
        const ckey = phoneMatchKey(c.phone || "");
        if (!ckey) continue;
        // Only set if key matches one of the participants (avoids stray hits)
        if (allKeys.includes(ckey) && !contactsByKey.has(ckey)) {
          contactsByKey.set(ckey, c);
        }
      }
    }

    // 6. Existing links for this lead
    const { data: existingLinks } = await dataClient
      .from("contact_leads")
      .select("contact_id")
      .eq("lead_id", lead_id);
    const linkedContactIds = new Set((existingLinks || []).map((l: any) => l.contact_id));

    // 7. Process each participant
    const results = {
      linked_existing: 0,
      needs_creation: [] as { phone: string; jid: string }[],
      already_linked: 0,
      skipped_blocklist: blockedCount,
    };

    for (const pp of participantPhones) {
      const existing = contactsByKey.get(pp.key);

      if (existing) {
        if (linkedContactIds.has(existing.id)) {
          results.already_linked++;
          continue;
        }
        const { error } = await dataClient
          .from("contact_leads")
          .insert({ contact_id: existing.id, lead_id });
        if (!error) {
          results.linked_existing++;
          linkedContactIds.add(existing.id);
        } else {
          console.log(`Link error for ${existing.id}:`, error.message);
        }
      } else {
        results.needs_creation.push({ phone: pp.full, jid: `${pp.full}@s.whatsapp.net` });
      }
    }

    // 8. Build name suggestions for needs_creation by looking at recent messages
    const contactSuggestions = [];
    for (const nc of results.needs_creation) {
      const ncKey = phoneMatchKey(nc.phone);
      // Pull a wider candidate set then filter in memory by exact match-key.
      const { data: recentMessages } = await dataClient
        .from("whatsapp_messages")
        .select("contact_name, message_text, direction, instance_name, created_at, phone")
        .ilike("phone", `%${ncKey}`)
        .order("created_at", { ascending: false })
        .limit(60);

      const matched = (recentMessages || []).filter((m: any) => phoneMatchKey(m.phone || "") === ncKey).slice(0, 30);

      const names = matched
        .map((m: any) => m.contact_name)
        .filter((n: string) => n && n.trim() && n !== "unknown" && n !== nc.phone);

      const nameFreq: Record<string, number> = {};
      for (const n of names) nameFreq[n] = (nameFreq[n] || 0) + 1;
      const bestName = Object.entries(nameFreq)
        .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || "";

      const messagesSample = matched
        .slice(0, 15)
        .map((m: any) => `[${m.direction}] ${m.message_text || ""}`.substring(0, 200))
        .join("\n");

      contactSuggestions.push({
        phone: nc.phone,
        suggested_name: bestName,
        message_count: matched.length,
        instances_seen: [...new Set(matched.map((m: any) => m.instance_name))],
        conversation_preview: messagesSample.substring(0, 1000),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        group_jid: groupJid,
        total_participants: participants.length,
        results,
        contact_suggestions: contactSuggestions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("sync-group-contacts error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

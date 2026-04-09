import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
  return digits;
}

function extractPhoneFromJid(jid: string): string {
  return jid.replace(/@.*$/, "").replace(/\D/g, "");
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
    const dataClient = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);

    // 1. Get instance for API calls
    let instance: any = null;
    if (instance_id) {
      const { data } = await internalClient
        .from("whatsapp_instances")
        .select("*")
        .eq("id", instance_id)
        .eq("is_active", true)
        .single();
      instance = data;
    }
    if (!instance) {
      const { data: fallback } = await internalClient
        .from("whatsapp_instances")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      instance = fallback;
    }

    if (!instance) {
      return new Response(
        JSON.stringify({ error: "No active WhatsApp instance found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Get ALL instance phone numbers (to exclude them)
    const { data: allInstances } = await internalClient
      .from("whatsapp_instances")
      .select("owner_phone")
      .eq("is_active", true);
    
    const instancePhones = new Set(
      (allInstances || [])
        .map((i: any) => normalizePhone(i.owner_phone || ""))
        .filter((p: string) => p.length >= 10)
    );

    // 3. Fetch group participants from UazAPI
    const baseUrl = instance.base_url || "https://abraci.uazapi.com";
    // Normalize JID: ensure it ends with @g.us and strip any extra whitespace
    let groupJid = (group_jid || "").trim();
    // If it's a raw numeric ID, append @g.us
    if (!groupJid.includes("@")) {
      groupJid = `${groupJid}@g.us`;
    }
    // Validate format: must be like "digits@g.us"
    if (!groupJid.endsWith("@g.us")) {
      console.error("Invalid group JID format:", groupJid);
      return new Response(
        JSON.stringify({ success: false, error: `Formato de JID inválido: ${groupJid}. Deve terminar com @g.us` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetching group info for JID: ${groupJid} via instance: ${instance.instance_name}`);

    const infoRes = await fetch(`${baseUrl}/group/info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: instance.instance_token,
      },
      body: JSON.stringify({ id: groupJid }),
    });

    if (!infoRes.ok) {
      const errText = await infoRes.text();
      console.error("Group info error:", infoRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `Erro ao buscar info do grupo (${infoRes.status}): ${errText}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const groupData = await infoRes.json();
    const participants = groupData?.participants || groupData?.Participants || 
      groupData?.data?.participants || [];
    
    console.log(`Group ${groupJid}: ${participants.length} participants found`);

    // 4. Extract phone numbers from participants (exclude instances)
    const participantPhones: string[] = [];
    for (const p of participants) {
      const jid = p.id || p.JID || p.jid || "";
      if (!jid || jid.includes("@lid") || jid.includes("@g.us")) continue;
      const phone = extractPhoneFromJid(jid);
      if (phone && phone.length >= 10 && !instancePhones.has(phone)) {
        participantPhones.push(phone);
      }
    }

    console.log(`After filtering instances: ${participantPhones.length} participant phones`);

    // 5. Find existing contacts by phone
    const { data: existingContacts } = await dataClient
      .from("contacts")
      .select("id, phone, full_name")
      .or(participantPhones.map(p => `phone.like.%${p.slice(-8)}%`).join(","));

    const contactsByPhone = new Map<string, any>();
    for (const c of existingContacts || []) {
      const cPhone = normalizePhone(c.phone || "");
      if (cPhone) contactsByPhone.set(cPhone, c);
      // Also map by last 8 digits
      if (cPhone.length >= 8) contactsByPhone.set(cPhone.slice(-8), c);
    }

    // 6. Get already linked contacts for this lead
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
      skipped_instances: instancePhones.size,
    };

    for (const phone of participantPhones) {
      // Check if contact exists (by full phone or last 8 digits)
      const existing = contactsByPhone.get(phone) || contactsByPhone.get(phone.slice(-8));

      if (existing) {
        if (linkedContactIds.has(existing.id)) {
          results.already_linked++;
          continue;
        }
        // Link existing contact to lead
        const { error } = await dataClient
          .from("contact_leads")
          .insert({ contact_id: existing.id, lead_id });
        if (!error) {
          results.linked_existing++;
          linkedContactIds.add(existing.id);
        }
      } else {
        // Need to create - collect conversation data
        results.needs_creation.push({ phone, jid: `${phone}@s.whatsapp.net` });
      }
    }

    // 8. For contacts that need creation, fetch conversation summaries to suggest names
    const contactSuggestions = [];
    for (const nc of results.needs_creation) {
      // Look up recent messages across ALL instances for this phone
      const { data: recentMessages } = await dataClient
        .from("whatsapp_messages")
        .select("contact_name, message_text, direction, instance_name, created_at")
        .like("phone", `%${nc.phone.slice(-8)}%`)
        .order("created_at", { ascending: false })
        .limit(30);

      // Extract best contact name from messages
      const names = (recentMessages || [])
        .map((m: any) => m.contact_name)
        .filter((n: string) => n && n.trim() && n !== "unknown" && n !== nc.phone);
      
      const nameFreq: Record<string, number> = {};
      for (const n of names) {
        nameFreq[n] = (nameFreq[n] || 0) + 1;
      }
      const bestName = Object.entries(nameFreq)
        .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || "";

      // Gather conversation context for AI analysis
      const messagesSample = (recentMessages || [])
        .slice(0, 15)
        .map((m: any) => `[${m.direction}] ${m.message_text || ""}`.substring(0, 200))
        .join("\n");

      contactSuggestions.push({
        phone: nc.phone,
        suggested_name: bestName,
        message_count: recentMessages?.length || 0,
        instances_seen: [...new Set((recentMessages || []).map((m: any) => m.instance_name))],
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

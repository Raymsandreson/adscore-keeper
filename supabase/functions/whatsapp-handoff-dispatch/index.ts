// Cloud edge function: recebe marcadores [HANDOFF:...] do agente WhatsApp
// e cria (a) atividade no Externo p/ o responsável, (b) mensagem + menção
// no chat interno do lead apontando para o responsável.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXT_URL = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "https://kmedldlepwiityjsdahz.supabase.co").trim();
const EXT_KEY = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const CLOUD_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const CLOUD_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

const HANDOFF_LABELS: Record<string, { title: string; type: string; emoji: string }> = {
  retorno:    { title: "Confirmar e retornar ao cliente", type: "tarefa",   emoji: "↩️" },
  ligacao:    { title: "Ligar para o cliente",            type: "ligacao",  emoji: "📞" },
  reuniao:    { title: "Agendar reunião com o cliente",   type: "reuniao",  emoji: "🤝" },
  fechamento: { title: "Fechar caso pendente",            type: "tarefa",   emoji: "✅" },
};

function computeDeadline(hc: any): string {
  const mode = hc?.deadline || "end_of_day";
  const tz = "America/Sao_Paulo";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  if (mode === "plus_2h") return new Date(Date.now() + 2 * 3600_000).toISOString();
  if (mode === "plus_4h") return new Date(Date.now() + 4 * 3600_000).toISOString();
  if (mode === "next_morning") {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  // end_of_day default
  const eodHour = Number(hc?.end_of_day_hour ?? 18);
  const d = new Date(now);
  if (now.getHours() >= eodHour) { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  else { d.setHours(eodHour, 0, 0, 0); }
  return d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { lead_id, phone, instance_name, agent_id, agent_name, handoff_config, markers } = body || {};

    if (!Array.isArray(markers) || markers.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "no markers" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ext = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });
    const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });

    // 1. Resolver lead (do request ou via última whatsapp_messages)
    let leadId: string | null = lead_id || null;
    if (!leadId && phone && instance_name) {
      const { data: m } = await ext.from("whatsapp_messages")
        .select("lead_id").eq("phone", phone).eq("instance_name", instance_name)
        .not("lead_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      leadId = (m as any)?.lead_id || null;
    }

    if (!leadId) {
      console.warn("[handoff-dispatch] sem lead_id, abortando");
      return new Response(JSON.stringify({ success: false, error: "no lead" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: lead } = await ext.from("leads")
      .select("id, lead_name, acolhedor, assigned_to, created_by")
      .eq("id", leadId).maybeSingle();
    if (!lead) {
      return new Response(JSON.stringify({ success: false, error: "lead not found" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Resolver responsável via fallback configurável
    const fallback: string[] = Array.isArray(handoff_config?.fallback)
      ? handoff_config.fallback
      : ["responsible", "acolhedor", "assigned", "creator"];

    let extUserId: string | null = null;

    // 2a. processo ativo desse lead
    const { data: proc } = await ext.from("lead_processes")
      .select("responsible_user_id")
      .eq("lead_id", leadId).is("deleted_at", null)
      .not("responsible_user_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const responsibleExt = (proc as any)?.responsible_user_id || null;

    // 2b. acolhedor → profile.user_id
    let acolhedorExt: string | null = null;
    if (lead.acolhedor && String(lead.acolhedor).trim()) {
      const { data: prof } = await ext.from("profiles")
        .select("user_id").ilike("full_name", String(lead.acolhedor).trim()).limit(1).maybeSingle();
      acolhedorExt = (prof as any)?.user_id || null;
    }

    for (const step of fallback) {
      if (step === "responsible" && responsibleExt) { extUserId = responsibleExt; break; }
      if (step === "acolhedor"   && acolhedorExt)   { extUserId = acolhedorExt;   break; }
      if (step === "assigned"    && lead.assigned_to) { extUserId = lead.assigned_to; break; }
      if (step === "creator"     && lead.created_by)  { extUserId = lead.created_by;  break; }
    }

    if (!extUserId) {
      console.warn("[handoff-dispatch] nenhum responsável resolvido", { leadId });
      return new Response(JSON.stringify({ success: false, error: "no responsible" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. ext→cloud para notificações Cloud
    const { data: mapRow } = await ext.from("auth_uuid_mapping")
      .select("cloud_uuid").eq("ext_uuid", extUserId).maybeSingle();
    const cloudUserId = (mapRow as any)?.cloud_uuid || extUserId;

    // Nome completo p/ assigned_to_name
    const { data: profExt } = await ext.from("profiles")
      .select("full_name").eq("user_id", extUserId).maybeSingle();
    const fullName = (profExt as any)?.full_name || null;

    const deadline = computeDeadline(handoff_config || {});
    const created: Array<{ marker: string; activity_id: string | null; message_id: string | null }> = [];

    for (const mk of markers) {
      const kind = String(mk?.type || "").toLowerCase();
      const reason = String(mk?.reason || "").trim();
      const meta = HANDOFF_LABELS[kind];
      if (!meta) continue;

      const title = `${meta.emoji} ${meta.title}`;
      const description = `Solicitado pelo agente${agent_name ? ` "${agent_name}"` : ""} via WhatsApp.\n\nMotivo: ${reason || "—"}\n\nLead: ${lead.lead_name || leadId}\nTelefone: ${phone || "—"} (${instance_name || "—"})`;

      // 3a. Atividade no Externo
      const { data: act, error: actErr } = await ext.from("lead_activities").insert({
        lead_id: leadId,
        lead_name: lead.lead_name || null,
        title,
        description,
        activity_type: meta.type,
        status: "pendente",
        priority: kind === "ligacao" || kind === "fechamento" ? "alta" : "normal",
        assigned_to: extUserId,
        assigned_to_name: fullName,
        created_by: extUserId,
        deadline,
        notes: `handoff:${kind}`,
      }).select("id").maybeSingle();
      if (actErr) console.error("[handoff-dispatch] activity insert", actErr);

      // 3b. Mensagem + menção no chat interno do lead (Cloud)
      let msgId: string | null = null;
      try {
        const { data: msg, error: msgErr } = await cloud.from("team_chat_messages").insert({
          entity_type: "lead",
          entity_id: leadId,
          entity_name: lead.lead_name || null,
          sender_id: cloudUserId,
          sender_name: `🤖 Handoff IA${agent_name ? ` (${agent_name})` : ""}`,
          content: `${meta.emoji} **${meta.title}**\n${reason ? `> ${reason}\n` : ""}Prazo: ${new Date(deadline).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
        }).select("id").maybeSingle();
        if (msgErr) console.error("[handoff-dispatch] msg insert", msgErr);
        msgId = (msg as any)?.id || null;
        if (msgId) {
          await cloud.from("team_chat_mentions").insert({
            message_id: msgId,
            mentioned_user_id: cloudUserId,
            entity_type: "lead",
            entity_id: leadId,
            entity_name: lead.lead_name || null,
          });
        }
      } catch (e) {
        console.error("[handoff-dispatch] cloud chat err", e);
      }

      created.push({ marker: kind, activity_id: (act as any)?.id || null, message_id: msgId });
    }

    return new Response(JSON.stringify({
      success: true,
      lead_id: leadId,
      ext_user_id: extUserId,
      cloud_user_id: cloudUserId,
      created,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[handoff-dispatch] fatal", e);
    return new Response(JSON.stringify({ success: false, error: String((e as any)?.message || e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

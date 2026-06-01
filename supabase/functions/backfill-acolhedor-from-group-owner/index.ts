// backfill-acolhedor-from-group-owner
// Para cada lead fechado SEM acolhedor que tem um grupo vinculado,
// consulta /group/info no UazAPI, lê o "owner" (criador do grupo),
// mapeia o telefone para a instância dona e grava o operador como acolhedor.
//
// Body: { limit?: number, dry_run?: boolean, lead_id?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

// Instâncias compartilhadas / bots — NUNCA viram acolhedor
const SHARED_INSTANCES = new Set([
  "WHATSJUD IA",
  "Atendimento Previdenciário",
  "Atendimento Previdenciário 2",
  "Atendimento Processual",
  "Andreia Atendimento Maternidade",
  "Luiz Abraci",
  "Prudencred",
  "Léo Teste",
].map((s) => s.toLowerCase()));

// instance_name → full_name canônico (profiles.full_name)
const INSTANCE_TO_OPERATOR: Record<string, string> = {
  "Ana Ligia": "Ana Lígia Santos Cavalcante",
  "Analyne Oliveira": "Analyne Sousa de Oliveira",
  "Andressa SDR": "Andressa Leão da Silva Duarte",
  "BRUNO DANTAS": "Bruno Wenner Dantas Nunes",
  "cris": "Crisley Costa de Oliveira",
  "ISRAEL ATENDIMENTO": "Israel de Jesus Carvalho Filho",
  "João Manoel- Acolhedor": "João Manoel Cavalcante Santana",
  "João Pedro": "João Pedro Sá",
  "Juliana Pimentel": "Juliana Clara Santos Pimentel",
  "Karolyne Atendimento": "Maria Karolyne de Aguiar Nunes",
  "Luana Gerente": "Luana Barros",
  "Mateus Atendimento": "Mateus Santos Saraiva",
  "Prev. Edilan": "Edilan da silva santos",
  "Viviane": "Viviane Amorin",
  "Raym": "Raymsandreson de Morais Prudêncio",
  "Dom": "Dom",
};

function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

async function runExternalSQL(sql: string): Promise<any[]> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/run-external-migration`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ sql }),
  });
  const json = await res.json().catch(() => ({}));
  return json?.results?.[0]?.data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(body?.limit ?? 200, 500);
    const dryRun = body?.dry_run === true;
    const leadIdFilter: string | undefined = body?.lead_id;

    const cloud = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Instâncias (cloud)
    const { data: instances } = await cloud
      .from("whatsapp_instances")
      .select("instance_name, instance_token, base_url, owner_phone, is_active")
      .eq("is_active", true);

    if (!instances?.length) {
      return new Response(JSON.stringify({ success: false, error: "no instances" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // phoneKey → instance_name (resolve owner_phone do grupo)
    const phoneToInstance = new Map<string, string>();
    for (const i of instances) {
      const k = phoneKey(i.owner_phone);
      if (k) phoneToInstance.set(k, i.instance_name);
    }

    // 2) Candidatos no Externo
    const where = leadIdFilter
      ? `l.id = '${leadIdFilter.replace(/'/g, "''")}'`
      : `l.lead_status='closed' AND (l.acolhedor IS NULL OR btrim(l.acolhedor)='')`;
    const candidates = await runExternalSQL(
      `SELECT l.id, l.lead_name, lwg.group_jid, lwg.instance_name as group_instance
       FROM leads l
       JOIN lead_whatsapp_groups lwg ON lwg.lead_id = l.id
       WHERE ${where}
       ORDER BY l.updated_at DESC
       LIMIT ${limit}`
    );

    const results: any[] = [];
    let updated = 0, notFound = 0, shared = 0, errors = 0, noOwner = 0;

    for (const c of candidates) {
      let groupJid = String(c.group_jid || "");
      if (!groupJid) continue;
      if (!groupJid.includes("@")) groupJid = `${groupJid}@g.us`;

      // Ordem de tentativas: a instância do grupo primeiro, depois até 3 outras
      const groupInstFirst = instances.filter((i) => i.instance_name === c.group_instance);
      const others = instances.filter((i) => i.instance_name !== c.group_instance).slice(0, 3);
      const tryOrder = [...groupInstFirst, ...others];

      let ownerJid: string | null = null;
      for (const inst of tryOrder) {
        if (!inst.instance_token) continue;
        try {
          const baseUrl = inst.base_url || "https://abraci.uazapi.com";
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 4000);
          const r = await fetch(`${baseUrl}/group/info`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token: inst.instance_token },
            body: JSON.stringify({ groupjid: groupJid }),
            signal: ctrl.signal,
          });
          clearTimeout(tid);
          if (!r.ok) continue;
          const d = await r.json();
          ownerJid = d?.OwnerPN || d?.OwnerJID || d?.owner || d?.GroupOwner || null;
          if (ownerJid) break;
        } catch (_) {/* try next */}
      }

      if (!ownerJid) { noOwner++; results.push({ id: c.id, status: "no_owner", lead_name: c.lead_name }); continue; }

      const ownerKey = phoneKey(ownerJid);
      const ownerInstance = ownerKey ? phoneToInstance.get(ownerKey) : null;

      if (!ownerInstance) {
        notFound++;
        results.push({ id: c.id, status: "owner_not_in_instances", owner: ownerJid, lead_name: c.lead_name });
        continue;
      }

      if (SHARED_INSTANCES.has(ownerInstance.toLowerCase())) {
        shared++;
        results.push({ id: c.id, status: "shared_instance", instance: ownerInstance, lead_name: c.lead_name });
        continue;
      }

      const operator = INSTANCE_TO_OPERATOR[ownerInstance] || ownerInstance;
      results.push({ id: c.id, status: "ok", instance: ownerInstance, operator, lead_name: c.lead_name });

      if (!dryRun) {
        const upd = await runExternalSQL(
          `UPDATE leads SET acolhedor = '${operator.replace(/'/g, "''")}' WHERE id = '${c.id}' RETURNING id`
        );
        if (upd.length) updated++; else errors++;
      } else {
        updated++; // contagem de previsão
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      total_candidates: candidates.length,
      updated, no_owner: noOwner, owner_not_in_instances: notFound, shared, errors,
      results: results.slice(0, 50),
    }, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

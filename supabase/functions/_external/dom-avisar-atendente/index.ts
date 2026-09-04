// =============================================================================
// dom-avisar-atendente — leva a reclamação para uma pessoa.
//
// Roda no Supabase EXTERNO (kmedldlepwiityjsdahz).
//
// Quando o atendente virtual classifica a mensagem no grupo E (reclamação,
// dinheiro, prazo, ou pedido de falar com alguém), o dom-rascunho já sorteia um
// atendente pelo rodízio e grava `atendente_id` na fila. Esta função é o passo
// que faltava: avisar a pessoa, no privado dela.
//
// O aviso leva o que ela precisa para agir sem abrir o sistema: nome do grupo,
// quem falou, o que foi dito, por que caiu no colo dela, e o link para entrar
// no grupo.
//
// ENSAIO A SECO POR PADRÃO
// `dry_run` é TRUE quando não vem no corpo. Uma função que manda mensagem para
// o WhatsApp pessoal de alguém não pode disparar por acidente — nem numa
// chamada de teste, nem num cron mal configurado. Para valer, é explícito:
//   POST { "dry_run": false }
//
// O LINK FALHA SOZINHO, O AVISO NÃO
// O link de convite só existe se a nossa instância for admin do grupo. Quando
// não for, o aviso sai mesmo assim, com o nome do grupo — atendente sem link
// acha o grupo; atendente sem aviso não sabe que existe reclamação.
//
// CONTRATO
//   POST { dry_run?: boolean = true, limite?: number = 10 }
//   →    { pendentes, enviados, avisos: [{ para, texto, enviado, erro }] }
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/** As 19 intenções em português, para a atendente não precisar decorar código. */
const INTENCAO_LEGIVEL: Record<string, string> = {
  E16: "reclamação ou ameaça de sair",
  E17: "pergunta sobre dinheiro ou prazo",
  E18: "quer falar com uma pessoa",
  E19: "assunto jurídico novo, fora deste processo",
};

/**
 * Link de convite do grupo, via UazAPI. Devolve null em qualquer tropeço: a
 * instância pode não ser admin, e isso não pode impedir o aviso.
 */
async function linkDoGrupo(supabase: any, groupJid: string, instanceName: string | null) {
  try {
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("base_url, instance_token")
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (!inst?.instance_token) return null;

    const res = await fetch(`${inst.base_url || "https://abraci.uazapi.com"}/group/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: inst.instance_token },
      body: JSON.stringify({
        groupjid: groupJid.includes("@") ? groupJid : `${groupJid}@g.us`,
        getInviteLink: true,
        getRequestsParticipants: false,
        force: false,
      }),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    const link = d?.invite_link || d?.inviteLink || d?.InviteLink || null;
    const code = d?.invite_code || d?.inviteCode || d?.code || null;
    return link || (code ? `https://chat.whatsapp.com/${code}` : null);
  } catch {
    return null;
  }
}

function montarAviso(p: any, link: string | null) {
  const intencao = INTENCAO_LEGIVEL[p.intencao] || p.intencao || "precisa de atenção";
  const linhas = [
    "🚨 *Um cliente precisa de você*",
    "",
    `*Grupo:* ${p.group_name || p.group_jid}`,
    `*Quem falou:* ${p.pergunta_autor || "cliente"}`,
    `*Assunto:* ${intencao}`,
    "",
    "*O que ele escreveu:*",
    `"${String(p.pergunta || "").slice(0, 500)}"`,
  ];
  if (p.motivo_revisao) {
    linhas.push("", `*Por que veio pra você:* ${p.motivo_revisao}`);
  }
  linhas.push("", link ? `*Entrar no grupo:* ${link}` : "_Não consegui gerar o link do grupo — procure pelo nome acima._");
  return linhas.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // Ausente = ensaio. Só dispara de verdade quem escreveu dry_run: false.
    const ensaio = corpo?.dry_run !== false;
    const limite = Math.min(Math.max(Number(corpo?.limite) || 10, 1), 50);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(url, chave);

    const { data: pendentes } = await supabase
      .from("dom_respostas_pendentes")
      .select("id, group_jid, group_name, instance_name, pergunta, pergunta_autor, intencao, motivo_revisao, atendente_id, dom_atendentes(nome, whatsapp, is_active)")
      .not("atendente_id", "is", null)
      .is("notificado_em", null)
      .order("criado_em", { ascending: true })
      .limit(limite);

    const avisos: any[] = [];
    let enviados = 0;

    for (const p of pendentes ?? []) {
      // A relação embutida do PostgREST volta como array mesmo sendo um-para-um.
      const rel: any = (p as any).dom_atendentes;
      const at = Array.isArray(rel) ? rel[0] : rel;

      if (!at?.whatsapp || at.is_active === false) {
        avisos.push({ id: p.id, erro: "atendente sem WhatsApp ou inativo" });
        await supabase.from("dom_respostas_pendentes")
          .update({ erro_notificacao: "atendente sem WhatsApp ou inativo" })
          .eq("id", p.id);
        continue;
      }

      const link = await linkDoGrupo(supabase, p.group_jid, p.instance_name);
      const texto = montarAviso(p, link);

      if (ensaio) {
        avisos.push({ id: p.id, para: at.nome, whatsapp: at.whatsapp, texto, enviado: false, ensaio: true });
        continue;
      }

      // Sai pelo MESMO send-whatsapp de todo o resto: resolução de instância,
      // reconexão e gravação da bolha continuam num lugar só.
      let erro: string | null = null;
      try {
        const r = await fetch(`${url}/functions/v1/send-whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
          body: JSON.stringify({
            phone: at.whatsapp,
            message: texto,
            instance_name: p.instance_name,
          }),
        });
        const resp = await r.json().catch(() => null);
        if (!r.ok || resp?.success === false) erro = resp?.error || `HTTP ${r.status}`;
      } catch (e) {
        erro = (e as Error).message;
      }

      if (erro) {
        await supabase.from("dom_respostas_pendentes")
          .update({ erro_notificacao: erro }).eq("id", p.id);
        avisos.push({ id: p.id, para: at.nome, enviado: false, erro });
        continue;
      }

      // Só marca depois de sair. Marcar antes transforma uma falha de envio em
      // reclamação que ninguém nunca mais vai ver.
      await supabase.from("dom_respostas_pendentes")
        .update({ notificado_em: new Date().toISOString(), erro_notificacao: null })
        .eq("id", p.id);
      avisos.push({ id: p.id, para: at.nome, enviado: true });
      enviados++;
      console.log(`[dom-avisar] aviso entregue para ${at.nome} sobre o grupo ${p.group_jid}`);
    }

    return json({ pendentes: (pendentes ?? []).length, enviados, ensaio, avisos });
  } catch (e) {
    console.error("[dom-avisar] erro", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "erro" }, 500);
  }
});

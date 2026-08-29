// Vínculo de um protocolo administrativo do INSS a um caso — sugestões, busca
// manual e a gravação em si.
//
// A lógica nasceu dentro do InssAdminProcessesTab (Acompanhamento Processual).
// Saiu para cá quando a lista de protocolos da Visão Geral ganhou o botão
// "Vincular caso": são duas telas fazendo a MESMA coisa, e uma segunda cópia
// da heurística de sugestão divergiria na primeira correção — foi exatamente
// isso que já aconteceu com outras cópias nesta base.
//
// O que uma tela chamadora precisa saber:
//   - `buscarSugestoesDeCaso` é caro (várias consultas): chame ao abrir o
//     diálogo de UM protocolo, nunca em loop por linha da lista.
//   - `vincularProtocoloAoCaso` grava em três lugares (inss_admin_processes,
//     lead_custom_field_values e lead_processes) e pode criar um legal_case.
//     Ela não emite toast nem recarrega nada — quem chama decide.

import { authClient, db } from "@/integrations/supabase";
import { upsertInssLeadProcess, type InssProcessRow } from "@/lib/inssLeadProcess";
import {
  buildIlikeSearchTokens,
  isLooseTokenMatch,
  namesAreCompatible,
  safeIlikeToken,
  tokenizeName,
  uniqueTokens,
} from "@/lib/nomeMatch";
import { pontuarSugestao, type PistaVinculo } from "@/lib/inssVinculoScore";
import { cloudFunctions } from "@/lib/functionRouter";

/** Custom field "Nº Requerimento INSS" — memoriza o nº no lead p/ auto-match. */
export const INSS_REQUERIMENTO_FIELD_ID = "111f9a38-98c3-4f83-9095-5c469106a7bf";

export interface CaseOption {
  /** case_id real OU "lead:<lead_id>" quando o lead ainda não tem caso. */
  id: string;
  case_number: string;
  title: string;
  lead_id: string | null;
  lead_name?: string | null;
  matched_via?: string;
  /** true quando `id` é "lead:..." e o caso precisa ser criado no vínculo. */
  needs_case_creation?: boolean;
}

/** O mínimo que o vínculo precisa saber do protocolo. */
export interface ProtocoloParaVinculo extends InssProcessRow {
  id: string;
  requerimento_number: string;
}

const normalizeCpf = (s?: string | null) => (s || "").replace(/\D/g, "");

/**
 * Sugestões automáticas para um protocolo órfão, em ordem de força da pista:
 * nº do requerimento já cadastrado → CPF → nome (contato, lead, grupo).
 *
 * Mesma família de pistas do robô do Railway (`inss-matcher.ts`), mas aqui o
 * resultado é uma LISTA para uma pessoa escolher — lá o robô só aplica quando
 * o candidato é único.
 */
export async function buscarSugestoesDeCaso(proc: ProtocoloParaVinculo): Promise<CaseOption[]> {
  type Candidato = CaseOption & { _score: number; _motivos: string[] };
  const found = new Map<string, Candidato>();

  const registrar = (opt: CaseOption, pista: PistaVinculo, dadosLead: {
    leadName?: string | null;
    leadCriadoEm?: string | null;
    temCaso: boolean;
  }) => {
    const { score, motivos } = pontuarSugestao({
      pista,
      beneficioProtocolo: (proc as any).benefit_type,
      beneficioCandidato: [dadosLead.leadName, opt.title].filter(Boolean).join(' '),
      dataProtocolo: (proc as any).protocol_date || (proc as any).created_at,
      dataLead: dadosLead.leadCriadoEm,
      temCaso: dadosLead.temCaso,
    });
    const anterior = found.get(opt.id);
    // Mesma linha achada por duas pistas fica com a mais forte.
    if (anterior && anterior._score >= score) return;
    found.set(opt.id, { ...opt, _score: score, _motivos: motivos });
  };

  /** Lê o lead uma vez: nome e data de entrada alimentam o desempate. */
  const cacheLead = new Map<string, { lead_name: string | null; created_at: string | null }>();
  const lerLead = async (leadId: string) => {
    if (cacheLead.has(leadId)) return cacheLead.get(leadId)!;
    const { data } = await db
      .from("leads" as any)
      .select("lead_name, created_at")
      .eq("id", leadId)
      .maybeSingle();
    const v = { lead_name: (data as any)?.lead_name || null, created_at: (data as any)?.created_at || null };
    cacheLead.set(leadId, v);
    return v;
  };

  const addCase = async (caseId: string, via: string, pista: PistaVinculo) => {
    const { data: c } = await db
      .from("legal_cases" as any)
      .select("id, case_number, title, lead_id")
      .eq("id", caseId)
      .maybeSingle();
    if (!c) return;
    const info = (c as any).lead_id ? await lerLead((c as any).lead_id) : null;
    registrar(
      { ...(c as any), lead_name: info?.lead_name || null, matched_via: via },
      pista,
      { leadName: info?.lead_name, leadCriadoEm: info?.created_at, temCaso: true },
    );
  };

  /**
   * Lead vira sugestão mesmo SEM caso aberto ("(criar caso)", igual à busca
   * manual). Antes só entrava lead que já tivesse `legal_case`, e o protocolo
   * previdenciário quase nunca tem: dos 304 órfãos de 26/08/2026, a maioria dos
   * candidatos plausíveis é lead cru. A sugestão vinha vazia por construção.
   */
  const addLead = async (leadId: string, leadNamePista: string | null, via: string, pista: PistaVinculo) => {
    const info = await lerLead(leadId);
    const leadName = info.lead_name || leadNamePista;
    const { data: cs } = await db
      .from("legal_cases" as any)
      .select("id, case_number, title, lead_id")
      .eq("lead_id", leadId)
      .limit(5);
    const casos = (cs || []) as any[];
    if (casos.length === 0) {
      registrar(
        {
          id: `lead:${leadId}`,
          case_number: "",
          title: leadName || "(lead sem caso)",
          lead_id: leadId,
          lead_name: leadName,
          matched_via: via,
          needs_case_creation: true,
        },
        pista,
        { leadName, leadCriadoEm: info.created_at, temCaso: false },
      );
      return;
    }
    for (const c of casos) {
      registrar(
        { ...c, lead_name: leadName, matched_via: via },
        pista,
        { leadName, leadCriadoEm: info.created_at, temCaso: true },
      );
    }
  };

  const reqDigits = (proc.requerimento_number || "").replace(/\D/g, "");
  if (reqDigits) {
    const { data: processesByNumber } = await db
      .from("lead_processes" as any)
      .select("lead_id, case_id, title, process_number, protocolo_administrativo")
      .or(`process_number.ilike.%${reqDigits}%,title.ilike.%${reqDigits}%,protocolo_administrativo.ilike.%${reqDigits}%`)
      .order("updated_at", { ascending: false })
      .limit(10);
    for (const lp of (processesByNumber || []) as any[]) {
      const via = `Nº do requerimento bate: ${lp.protocolo_administrativo || lp.process_number || lp.title}`;
      if (lp.case_id) await addCase(lp.case_id, via, "requerimento");
      else if (lp.lead_id) await addLead(lp.lead_id, null, via, "requerimento");
    }

    // O número também mora no campo "Nº Requerimento INSS" do lead — é a chave
    // exata que existe quando alguém anotou no ato do protocolo (158 dos 989
    // requerimentos em 26/08/2026).
    const { data: campos } = await db
      .from("lead_custom_field_values" as any)
      .select("lead_id, value_text")
      .eq("field_id", INSS_REQUERIMENTO_FIELD_ID)
      .ilike("value_text", `%${reqDigits}%`)
      .limit(10);
    for (const cv of (campos || []) as any[]) {
      if (cv.lead_id) await addLead(cv.lead_id, null, "Nº do requerimento anotado no lead", "requerimento");
    }
  }

  // 1) Match por CPF exato em contacts
  const cpf = normalizeCpf(proc.cpf_segurado);
  if (cpf) {
    const { data: contactsByCpf } = await db
      .from("contacts" as any)
      .select("id, full_name, cpf, lead_id")
      .or(`cpf.eq.${cpf},cpf.eq.${proc.cpf_segurado}`)
      .is("deleted_at", null)
      .limit(10);
    for (const ct of (contactsByCpf || []) as any[]) {
      if (ct.lead_id) await addLead(ct.lead_id, ct.full_name, `CPF bate com contato "${ct.full_name}"`, "cpf");
      const { data: cl } = await db
        .from("contact_leads" as any)
        .select("lead_id")
        .eq("contact_id", ct.id);
      for (const link of (cl || []) as any[]) {
        await addLead(link.lead_id, ct.full_name, `CPF bate com contato "${ct.full_name}"`, "cpf");
      }
    }
  }

  // 2) Nome — primeiro a passada FORTE (nome + sobrenome compatíveis).
  const tokens = uniqueTokens(tokenizeName(proc.nome_segurado));
  const matchTokens = (full?: string | null) => namesAreCompatible(proc.nome_segurado || "", full);
  const searchTokens = tokens.length
    ? buildIlikeSearchTokens([...tokens].sort((a, b) => b.length - a.length).slice(0, 4))
    : [];
  if (searchTokens.length) {
    const nameOr = searchTokens.map((t) => `full_name.ilike.%${t}%`).join(",");
    const { data: ctExt } = await db
      .from("contacts" as any)
      .select("id, full_name, lead_id")
      .or(nameOr)
      .is("deleted_at", null)
      .limit(100);
    const { data: ctCloud } = await authClient
      .from("contacts" as any)
      .select("id, full_name, lead_id")
      .or(nameOr)
      .is("deleted_at", null)
      .limit(100);
    const allContacts = [...(ctExt || []), ...(ctCloud || [])].filter((ct: any) => matchTokens(ct.full_name));
    const seenContact = new Set<string>();
    for (const ct of allContacts as any[]) {
      if (seenContact.has(ct.id)) continue;
      seenContact.add(ct.id);
      if (ct.lead_id) await addLead(ct.lead_id, ct.full_name, `Nome bate com contato "${ct.full_name}"`, "nome_forte");
      const { data: cl } = await db
        .from("contact_leads" as any)
        .select("lead_id")
        .eq("contact_id", ct.id);
      for (const link of (cl || []) as any[]) {
        await addLead(link.lead_id, ct.full_name, `Nome bate com contato "${ct.full_name}"`, "nome_forte");
      }
    }

    const { data: leadsRaw } = await db
      .from("leads" as any)
      .select("id, lead_name")
      .or(searchTokens.map((t) => `lead_name.ilike.%${t}%`).join(","))
      .limit(100);
    for (const l of ((leadsRaw || []) as any[]).filter((l: any) => matchTokens(l.lead_name))) {
      await addLead(l.id, l.lead_name, "Nome bate com o lead", "nome_forte");
    }

    const { data: groupsByName } = await db
      .from("lead_whatsapp_groups" as any)
      .select("lead_id, group_name")
      .or(searchTokens.map((t) => `group_name.ilike.%${t}%`).join(","))
      .limit(100);
    for (const g of ((groupsByName || []) as any[]).filter((g: any) => matchTokens(g.group_name))) {
      if (g.lead_id) await addLead(g.lead_id, g.group_name, `Nome bate com grupo "${g.group_name}"`, "nome_forte");
    }
  }

  // 3) Passada FRACA: só o primeiro nome, e só quando nada forte apareceu.
  // "Maria" bate em dezenas de leads — por isso entra depois, com peso baixo,
  // rotulada como palpite e ordenada pelos desempates (benefício e data).
  if (found.size === 0 && tokens.length) {
    const primeiro = buildIlikeSearchTokens([tokens[0]]);
    const or = primeiro.map((t) => `lead_name.ilike.%${t}%`).join(",");
    const { data: leadsFracos } = await db
      .from("leads" as any)
      .select("id, lead_name")
      .or(or)
      .is("deleted_at", null)
      .limit(60);
    for (const l of (leadsFracos || []) as any[]) {
      await addLead(l.id, l.lead_name, `Só o primeiro nome bate ("${tokens[0]}") — confira`, "nome_fraco");
    }
    const orG = primeiro.map((t) => `group_name.ilike.%${t}%`).join(",");
    const { data: gruposFracos } = await db
      .from("lead_whatsapp_groups" as any)
      .select("lead_id, group_name")
      .or(orG)
      .limit(60);
    for (const g of (gruposFracos || []) as any[]) {
      if (g.lead_id) await addLead(g.lead_id, g.group_name, `Primeiro nome no grupo "${g.group_name}" — confira`, "nome_fraco");
    }
  }

  return Array.from(found.values())
    .sort((a, b) => b._score - a._score)
    .slice(0, 12)
    .map(({ _score, _motivos, ...opt }) => ({
      ...opt,
      matched_via: _motivos.length ? `${opt.matched_via} · ${_motivos.join(', ')}` : opt.matched_via,
    }));
}

/**
 * Busca manual: aceita nº/título de caso, nome de lead, nome de contato,
 * telefone e CPF. Lead sem caso volta como opção "(criar caso)".
 */
export async function buscarCasosPorTexto(query: string): Promise<CaseOption[]> {
  const q = query.trim();
  if (!q) return [];

  const results = new Map<string, CaseOption>();
  const digitsOnly = q.replace(/\D/g, "");

  // 1) Casos por número/título
  const { data: casesByCaseFields } = await db
    .from("legal_cases" as any)
    .select("id, case_number, title, lead_id")
    .or(`case_number.ilike.%${q}%,title.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(10);
  for (const c of (casesByCaseFields || []) as any[]) {
    results.set(c.id, { ...c, matched_via: "Caso" });
  }

  const qTokens = uniqueTokens(tokenizeName(q));
  const textSearchTokens = qTokens.length
    ? buildIlikeSearchTokens(qTokens.sort((a, b) => b.length - a.length).slice(0, 5))
    : [safeIlikeToken(q)].filter(Boolean);
  if (!textSearchTokens.length) return [];

  // 2) Leads por nome / telefone / CPF
  const leadOr: string[] = textSearchTokens.map((t) => `lead_name.ilike.%${t}%`);
  if (digitsOnly.length >= 4) {
    leadOr.push(`lead_phone.ilike.%${digitsOnly}%`);
    leadOr.push(`cpf.ilike.%${digitsOnly}%`);
  }
  const { data: leadsRaw } = await db
    .from("leads" as any)
    .select("id, lead_name")
    .or(leadOr.join(","))
    .limit(80);
  const leads = ((leadsRaw || []) as any[]).filter((l) =>
    digitsOnly.length >= 4 || isLooseTokenMatch(q, l.lead_name)
  );

  // 3) Contatos por nome/telefone/CPF (Externo + Cloud)
  const contactOr: string[] = textSearchTokens.map((t) => `full_name.ilike.%${t}%`);
  if (digitsOnly.length >= 4) {
    contactOr.push(`phone.ilike.%${digitsOnly}%`);
    contactOr.push(`cpf.ilike.%${digitsOnly}%`);
  }
  const [ctExtR, ctCloudR] = await Promise.all([
    db.from("contacts" as any).select("id, full_name, lead_id").or(contactOr.join(",")).is("deleted_at", null).limit(80),
    authClient.from("contacts" as any).select("id, full_name, lead_id").or(contactOr.join(",")).is("deleted_at", null).limit(80),
  ]);
  const contacts = [...((ctExtR.data || []) as any[]), ...((ctCloudR.data || []) as any[])].filter((ct: any) =>
    digitsOnly.length >= 4 || isLooseTokenMatch(q, ct.full_name)
  );

  // 4) Grupos de WhatsApp por nome → leads vinculados
  const { data: groupsRaw } = await db
    .from("lead_whatsapp_groups" as any)
    .select("lead_id, group_name")
    .or(textSearchTokens.map((t) => `group_name.ilike.%${t}%`).join(","))
    .limit(100);
  const groups = ((groupsRaw || []) as any[]).filter((g) => isLooseTokenMatch(q, g.group_name));

  // Para cada lead candidato (direto ou via contato), busca casos vinculados
  const candidateLeads = new Map<string, { lead_name: string | null; via: string }>();
  for (const l of leads as any[]) {
    candidateLeads.set(l.id, { lead_name: l.lead_name, via: "Lead" });
  }
  for (const ct of contacts) {
    if (ct.lead_id && !candidateLeads.has(ct.lead_id)) {
      candidateLeads.set(ct.lead_id, { lead_name: ct.full_name, via: `Contato "${ct.full_name}"` });
    }
    const { data: cl } = await db.from("contact_leads" as any).select("lead_id").eq("contact_id", ct.id);
    for (const link of (cl || []) as any[]) {
      if (!candidateLeads.has(link.lead_id)) {
        candidateLeads.set(link.lead_id, { lead_name: ct.full_name, via: `Contato "${ct.full_name}"` });
      }
    }
  }
  for (const g of groups as any[]) {
    if (g.lead_id && !candidateLeads.has(g.lead_id)) {
      candidateLeads.set(g.lead_id, { lead_name: g.group_name, via: `Grupo WhatsApp "${g.group_name}"` });
    }
  }

  for (const [leadId, info] of candidateLeads.entries()) {
    const { data: cs } = await db
      .from("legal_cases" as any)
      .select("id, case_number, title, lead_id")
      .eq("lead_id", leadId)
      .limit(5);
    if (cs && cs.length) {
      for (const c of cs as any[]) {
        if (!results.has(c.id)) results.set(c.id, { ...c, lead_name: info.lead_name, matched_via: info.via });
      }
    } else {
      // lead sem caso ainda — oferece criar
      const key = `lead:${leadId}`;
      results.set(key, {
        id: key,
        case_number: "(criar caso)",
        title: info.lead_name || "Lead sem caso ainda",
        lead_id: leadId,
        lead_name: info.lead_name,
        matched_via: info.via + " — sem caso. Clique para criar e vincular.",
        needs_case_creation: true,
      });
    }
  }

  return Array.from(results.values()).slice(0, 20);
}

export interface ResultadoVinculo {
  caseId: string;
  leadId: string | null;
  caseNumberLabel: string;
  /** Preenchido quando o vínculo gravou, mas o processo do caso não. */
  avisoLeadProcess?: string;
}

/**
 * Grava o vínculo. Cria o legal_case antes quando a opção é um lead sem caso.
 *
 * Falha ao popular `lead_processes` NÃO derruba o vínculo: o protocolo já
 * mudou de dono e desfazer aqui deixaria estado pior. O aviso volta no
 * retorno pra tela mostrar.
 */
export async function vincularProtocoloAoCaso(params: {
  proc: ProtocoloParaVinculo;
  caseOpt: CaseOption;
  /** UUID de quem clicou (grava em linked_by). */
  userId?: string | null;
}): Promise<ResultadoVinculo> {
  const { proc, caseOpt, userId } = params;
  let caseId = caseOpt.id;
  const leadId = caseOpt.lead_id;
  let caseNumberLabel = caseOpt.case_number;

  if (caseOpt.needs_case_creation && leadId) {
    // gera número via RPC (usa specialized_nuclei se houver)
    const { data: newCaseNum } = await db.rpc("generate_case_number" as any, { p_nucleus_id: null } as any);
    const { data: newCase, error: caseErr } = await db
      .from("legal_cases" as any)
      .insert({
        lead_id: leadId,
        case_number: newCaseNum || `CASO-${Date.now()}`,
        title: proc.nome_segurado || caseOpt.lead_name || "Caso INSS",
        status: "active",
      } as any)
      .select("id, case_number")
      .single();
    if (caseErr || !newCase) throw caseErr || new Error("Falha ao criar caso");
    caseId = (newCase as any).id;
    caseNumberLabel = (newCase as any).case_number;
  }

  const { error } = await db
    .from("inss_admin_processes" as any)
    .update({
      case_id: caseId,
      lead_id: leadId,
      linked_at: new Date().toISOString(),
      linked_by: userId || null,
    })
    .eq("id", proc.id);
  if (error) throw error;

  // Memoriza nº do requerimento no lead (auto-match futuro)
  if (leadId && proc.requerimento_number) {
    await db
      .from("lead_custom_field_values" as any)
      .upsert(
        {
          lead_id: leadId,
          field_id: INSS_REQUERIMENTO_FIELD_ID,
          value_text: proc.requerimento_number,
        } as any,
        { onConflict: "lead_id,field_id" } as any
      );
  }

  // O nome do BENEFICIÁRIO é o que o INSS manda e o que falta na base: dos 304
  // protocolos órfãos de 26/08/2026, 220 não casam com nada porque o lead é do
  // responsável ("PREV 1630 - EVELYN/BERNARDO" é mãe e criança). Gravar aqui
  // fecha o buraco para o próximo requerimento do mesmo cliente — e só quando
  // o campo está vazio, para não sobrescrever o que alguém já escreveu.
  if (leadId && proc.nome_segurado) {
    try {
      const { data: lead } = await db
        .from("leads" as any)
        .select("victim_name")
        .eq("id", leadId)
        .maybeSingle();
      if (!(lead as any)?.victim_name) {
        await db.from("leads" as any).update({ victim_name: proc.nome_segurado } as any).eq("id", leadId);
      }
    } catch (e: any) {
      console.warn("Falha ao gravar victim_name:", e?.message);
    }
  }

  // O e-mail do INSS já chegou e ficou parado por falta de vínculo: agora que
  // ele existe, a atividade nasce (e o cliente é avisado, se o evento for
  // posterior ao corte de ativação). Sem isto, o vínculo feito na fila deixaria
  // a novidade do INSS sem tarefa e sem aviso até o próximo e-mail.
  try {
    await cloudFunctions.invoke("notify-inss-update", { body: { process_id: proc.id } });
  } catch (e: any) {
    console.warn("notify-inss-update falhou após o vínculo:", e?.message);
  }

  let avisoLeadProcess: string | undefined;
  try {
    await upsertInssLeadProcess({ caseId, leadId, proc, createdBy: userId });
  } catch (e: any) {
    console.warn("Falha ao popular lead_processes:", e?.message);
    avisoLeadProcess = e?.message || "erro desconhecido";
  }

  return { caseId, leadId, caseNumberLabel, avisoLeadProcess };
}

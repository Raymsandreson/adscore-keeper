// Cascata determinística que descobre de quem é o lead quando o rótulo não diz.
//
// O problema: 995 leads vivos têm grupo de WhatsApp e um lead_name que é só
// código de dossiê ("LEAD314", "PREV 1512 - ( ) Acd- -"). Medido em 04/09/2026.
// O nome dessas pessoas existe no banco — em 848 dos 995 há ao menos uma fonte.
//
// O que esta função NÃO faz, de propósito:
//  - não escreve em lead_name (é rótulo operacional, com número e sequência);
//  - não usa semelhança de nome, só igualdade e vínculo direto. Semelhança já
//    entregou a procuração de uma funcionária a 9 clientes;
//  - não copia victim_name: no BPC a mãe é o lead e a criança é a beneficiária
//    ("Aline" → "Sophia"), então victim_name é OUTRA pessoa, não o nome que falta;
//  - não adivinha quando a fonte é ambígua. Caso ambíguo fica sem resolver e
//    aparece no relatório com o motivo, para a conferência humana.
//
// Ordem das fontes, da mais forte para a mais fraca. Vence a primeira que
// responder — não há voto nem desempate por parecença.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { temNomeDePessoa } from '../lib/lead-nome-pessoa';

type Fonte = 'procuracao' | 'contato' | 'titulo_grupo' | 'inss';

const limpar = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim();

/** Número do dossiê no rótulo: "PREV 1512", "LEAD314", "Caso 98" → "1512". */
function numeroDoDossie(rotulo: string): string | null {
  const m = String(rotulo || '').match(/\b(?:prev|lead|caso)\s*[-_|:.]?\s*(\d{1,5})\b/i);
  return m ? String(Number(m[1])) : null;
}

/**
 * Nome do cliente dentro do título real do grupo.
 *
 * Só o formato de tubo é lido, porque nele o nome ocupa um campo delimitado:
 *   "LEAD301 | Nova Serrana/MG | Willian Rodrigues Gomes x Mac Supermercados | 26/08/2026"
 * A receita do funil Acidente de Trabalho é `city_state | victim_name x
 * main_company | accident_date`, então o segmento que contém " x " tem o cliente
 * antes e a empresa depois.
 *
 * Os formatos de hífen do previdenciário ficam de fora de propósito: em
 * "✅PREV 1656 - Déborah - Gabriel - BPC/LOAS" não dá para saber por posição
 * quem é cliente e quem é acolhedora. Chutar ali é o erro que esta função existe
 * para não cometer — esses vão para a conferência.
 */
function nomeNoTituloDeTubo(titulo: string): string | null {
  if (!titulo.includes('|')) return null;
  for (const seg of titulo.split('|')) {
    const m = seg.match(/^(.*?)\s+x\s+/i);
    if (m) {
      const nome = limpar(m[1]);
      if (temNomeDePessoa(nome)) return nome;
    }
  }
  return null;
}

async function porProcuracao(leadId: string): Promise<string | null> {
  const { data } = await ext
    .from('zapsign_documents')
    .select('outorgante_name, signer_name, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(5);
  for (const d of (data as any[]) || []) {
    // outorgante é quem outorga a procuração — o cliente. signer_name pode ser o
    // representante legal quando o beneficiário é menor, então vem depois.
    const nome = limpar(d.outorgante_name) || limpar(d.signer_name);
    if (temNomeDePessoa(nome)) return nome;
  }
  return null;
}

async function porContato(leadId: string): Promise<{ nome: string | null; motivo?: string }> {
  const { data } = await ext
    .from('contacts')
    .select('full_name, classification')
    .eq('lead_id', leadId)
    .is('deleted_at', null);
  const uteis = ((data as any[]) || []).filter(
    (c) => !['parte_contraria', 'non_client'].includes(String(c.classification || '')),
  );
  // 411 leads têm 2+ contatos: parente, testemunha, a própria parte. Sem um campo
  // que diga qual é o titular, escolher um é chute. Fica para a conferência.
  if (uteis.length !== 1) {
    return { nome: null, motivo: uteis.length === 0 ? 'sem contato' : 'contatos demais' };
  }
  const nome = limpar(uteis[0].full_name);
  return temNomeDePessoa(nome) ? { nome } : { nome: null, motivo: 'contato sem nome' };
}

async function porTituloDoGrupo(
  leadId: string,
  numeroDoLead: string | null,
): Promise<{ nome: string | null; motivo?: string }> {
  const { data: vinculos } = await ext
    .from('lead_whatsapp_groups')
    .select('group_jid')
    .eq('lead_id', leadId);
  const jids = [...new Set(((vinculos as any[]) || []).map((v) => v.group_jid).filter(Boolean))];
  if (!jids.length) return { nome: null, motivo: 'sem grupo' };

  const { data: idx } = await ext
    .from('whatsapp_groups_index')
    .select('group_jid, contact_name')
    .in('group_jid', jids);
  // O índice guarda uma linha por instância-membro: o mesmo grupo aparece 4x.
  const titulos = [...new Set(((idx as any[]) || []).map((i) => limpar(i.contact_name)).filter(Boolean))];
  if (!titulos.length) return { nome: null, motivo: 'grupo sem titulo no indice' };

  for (const titulo of titulos) {
    const numeroDoTitulo = numeroDoDossie(titulo);
    // A trava que sustenta esta fonte. Em 145 de 698 casos comparáveis o número
    // do lead diverge do número no título, e em 114 desses o número do título
    // pertence a OUTRO lead vivo. Sem essa igualdade, o nome lido aqui seria o
    // do cliente do vizinho.
    if (!numeroDoLead || !numeroDoTitulo || numeroDoLead !== numeroDoTitulo) {
      return { nome: null, motivo: `numero diverge (lead=${numeroDoLead} titulo=${numeroDoTitulo})` };
    }
    const nome = nomeNoTituloDeTubo(titulo);
    if (nome) return { nome };
  }
  return { nome: null, motivo: 'titulo sem campo de nome legivel' };
}

async function porInss(cpf: string | null): Promise<string | null> {
  const digitos = String(cpf || '').replace(/\D/g, '');
  if (digitos.length !== 11) return null;
  const { data } = await ext
    .from('inss_admin_processes')
    .select('nome_segurado')
    .eq('cpf_segurado', digitos)
    .is('deleted_at', null)
    .limit(5);
  const nomes = [...new Set(((data as any[]) || []).map((d) => limpar(d.nome_segurado)).filter(Boolean))];
  if (nomes.length !== 1) return null;
  return temNomeDePessoa(nomes[0]) ? nomes[0] : null;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { dry_run, limit, lead_id, incluir_sem_grupo } = (req.body || {}) as {
      dry_run?: boolean;
      limit?: number;
      lead_id?: string;
      incluir_sem_grupo?: boolean;
    };
    const teto = Math.min(Math.max(Number(limit) || 500, 1), 5000);

    let q = ext
      .from('leads')
      .select('id, lead_name, case_number, cpf')
      .is('deleted_at', null)
      .limit(teto);
    if (lead_id) q = q.eq('id', lead_id);
    const { data: leads, error } = await q;
    if (error) return ok({ success: false, error: `load leads: ${error.message}` });

    // Só entra quem não tem nome de gente no rótulo. O filtro roda em JS porque a
    // regra é a mesma do front (lead-nome-pessoa), e duplicá-la em SQL abriria a
    // porta para as duas divergirem.
    const candidatos = ((leads as any[]) || []).filter((l) => !temNomeDePessoa(l.lead_name));

    const porFonte: Record<string, number> = { procuracao: 0, contato: 0, titulo_grupo: 0, inss: 0 };
    const motivos: Record<string, number> = {};
    const amostra: any[] = [];
    let resolvidos = 0;
    let semFonte = 0;
    let semGrupo = 0;

    for (const lead of candidatos) {
      const numeroDoLead =
        numeroDoDossie(String(lead.lead_name || '')) ||
        (lead.case_number ? String(Number(String(lead.case_number).replace(/\D/g, ''))) : null);

      let nome: string | null = null;
      let fonte: Fonte | null = null;
      const trilha: string[] = [];

      nome = await porProcuracao(lead.id);
      if (nome) fonte = 'procuracao';

      if (!nome) {
        const c = await porContato(lead.id);
        if (c.nome) { nome = c.nome; fonte = 'contato'; } else if (c.motivo) trilha.push(`contato: ${c.motivo}`);
      }

      if (!nome) {
        const t = await porTituloDoGrupo(lead.id, numeroDoLead);
        if (t.nome) { nome = t.nome; fonte = 'titulo_grupo'; } else if (t.motivo) trilha.push(`grupo: ${t.motivo}`);
        if (t.motivo === 'sem grupo') semGrupo++;
      }

      if (!nome) {
        const i = await porInss(lead.cpf || null);
        if (i) { nome = i; fonte = 'inss'; } else trilha.push('inss: sem requerimento unico');
      }

      if (!nome || !fonte) {
        semFonte++;
        const chave = trilha[0] || 'sem trilha';
        motivos[chave] = (motivos[chave] || 0) + 1;
        continue;
      }

      resolvidos++;
      porFonte[fonte]++;
      if (amostra.length < 20) amostra.push({ lead_name: lead.lead_name, nome, fonte });

      if (!dry_run) {
        const { error: updErr } = await ext
          .from('leads')
          .update({
            client_name_resolved: nome,
            client_name_source: fonte,
            client_name_resolved_at: new Date().toISOString(),
          })
          .eq('id', lead.id);
        if (updErr) console.warn('[resolve-client-names] update falhou', lead.id, updErr.message);
      }
    }

    return ok({
      success: true,
      dry_run: !!dry_run,
      examinados: candidatos.length,
      resolvidos,
      sem_fonte: semFonte,
      sem_grupo: semGrupo,
      por_fonte: porFonte,
      motivos,
      amostra,
      incluir_sem_grupo: !!incluir_sem_grupo,
    });
  } catch (e: any) {
    console.error('[resolve-client-names] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};

import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { descreverErro, enviarDocumentoAoGrupo, LEGENDA_PROCURACAO } from '../lib/inss-zap';

/**
 * Busca e vínculo manual da procuração de um lead.
 *
 * Existe porque a busca automática (lib/inss-procuracao) só casa por chave
 * exata e acha 22 dos 58 requerimentos com exigência de procuração. Nos outros
 * o requerimento está no nome da criança e a procuração no nome da mãe, e não
 * há campo ligando as duas — quem sabe qual é a certa é a pessoa que atende o
 * caso, não o robô (casar por semelhança de nome entregava a procuração de uma
 * acolhedora para 9 clientes; está medido e proibido).
 *
 * Mora no Railway, e não no front, por dois motivos: `zapsign_documents` não
 * responde à anon key sem sessão (a policy devolve lista vazia, sem erro), e a
 * escrita do vínculo tem que ser por service role — mesma regra de `profiles`.
 *
 * Body:
 *   { action: 'listar', lead_id?, lead_name?, nome_segurado?, cpf_segurado?, busca? }
 *   { action: 'vincular', doc_token, lead_id, group_jid?, instance_name? }
 */

const COLUNAS =
  'doc_token, lead_id, outorgante_name, outorgante_cpf, signer_name, document_name, ' +
  'template_name, tipo_documento, created_at, original_file_url, status';

const norm = (s?: string | null) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digitos = (s?: string | null) => (s || '').replace(/\D/g, '');

/** Ruído do título do grupo: não é nome de gente. */
const RUIDO_DO_GRUPO = new Set([
  'PREV', 'LEAD', 'CASO', 'GRUPO', 'BPC', 'LOAS', 'ANUNCIO', 'INSS', 'ADM', 'JUD',
  'MAT', 'MATERNIDADE', 'SALARIO', 'AUX', 'ACIDENTE', 'KIT', 'ATENDIMENTO',
]);

/**
 * Só procuração serve — mas a regra é excluir o que sabidamente NÃO é, e não
 * exigir a palavra no nome. `tipo_documento` é nulo em 2.006 dos 3.331
 * registros com PDF (nunca foram classificados) e `template_name` é nulo em
 * todos, então o nome do arquivo é a única pista — e ele quase sempre é
 * "NOME DO CLIENTE.BPC LOAS.docx", sem a palavra "procuração". Exigi-la
 * descartaria 1.508 procurações boas. Os tipos abaixo são os únicos que a
 * classificação já provou serem outra coisa (69 documentos no total).
 */
const NAO_E_PROCURACAO = new Set(['cessao_credito', 'aditamento_quitepay', 'contrato', 'outro']);

function ehProcuracao(d: any): boolean {
  return !d.tipo_documento || !NAO_E_PROCURACAO.has(d.tipo_documento);
}

interface Candidata {
  doc_token: string;
  outorgante: string | null;
  cpf_mascarado: string | null;
  document_name: string | null;
  created_at: string | null;
  url: string;
  ja_vinculado: boolean;
  /** Por que apareceu na lista — a pessoa decide sabendo disso. */
  motivo: string;
}

/** CPF nunca sai inteiro: a tela só precisa dos últimos dígitos para conferir. */
const mascararCpf = (cpf?: string | null) => {
  const d = digitos(cpf);
  return d.length === 11 ? `***.***.${d.slice(6, 9)}-${d.slice(9)}` : null;
};

export const handler: RequestHandler = async (req, res) => {
  try {
    const action = req.body?.action || 'listar';

    if (action === 'vincular') {
      const { doc_token, lead_id, group_jid, instance_name } = req.body || {};
      if (!doc_token || !lead_id) {
        return res.status(200).json({ success: false, error: 'doc_token e lead_id são obrigatórios' });
      }
      const { data: doc, error } = await supabase
        .from('zapsign_documents')
        .select(COLUNAS)
        .eq('doc_token', doc_token)
        .maybeSingle();
      if (error) return res.status(200).json({ success: false, error: error.message });
      if (!doc) return res.status(200).json({ success: false, error: 'documento não encontrado' });
      if (!(doc as any).original_file_url) {
        return res.status(200).json({
          success: false,
          error: 'este documento não tem o PDF sem assinatura gravado',
        });
      }

      // O vínculo é o conserto que sobrevive: da próxima exigência deste lead a
      // busca automática acha sozinha, por `lead_id`.
      const { error: upErr } = await supabase
        .from('zapsign_documents')
        .update({ lead_id })
        .eq('doc_token', doc_token);
      if (upErr) return res.status(200).json({ success: false, error: `vínculo não gravou: ${upErr.message}` });

      let enviado = false;
      let erroEnvio: string | null = null;
      if (group_jid) {
        const r = await enviarDocumentoAoGrupo({
          group_jid,
          file_url: (doc as any).original_file_url,
          doc_name: 'procuracao-para-assinar.pdf',
          caption: LEGENDA_PROCURACAO,
          instance_name: instance_name || null,
        });
        enviado = r.ok;
        if (!r.ok) erroEnvio = descreverErro(r);
      }

      return res.status(200).json({
        success: true,
        vinculado: true,
        enviado,
        erro_envio: erroEnvio,
        url: (doc as any).original_file_url,
      });
    }

    // ---- listar ----
    const { lead_id, lead_name, nome_segurado, cpf_segurado, busca } = req.body || {};
    const achadas = new Map<string, Candidata>();
    const push = (d: any, motivo: string) => {
      if (!d?.original_file_url || !ehProcuracao(d)) return;
      if (achadas.has(d.doc_token)) return;
      achadas.set(d.doc_token, {
        doc_token: d.doc_token,
        outorgante: d.outorgante_name || d.signer_name || null,
        cpf_mascarado: mascararCpf(d.outorgante_cpf),
        document_name: d.document_name || d.template_name || null,
        created_at: d.created_at || null,
        url: d.original_file_url,
        ja_vinculado: !!d.lead_id && d.lead_id === lead_id,
        motivo,
      });
    };

    if (lead_id) {
      const { data } = await supabase.from('zapsign_documents').select(COLUNAS).eq('lead_id', lead_id);
      (data || []).forEach((d: any) => push(d, 'já vinculada a este lead'));
    }

    const cpf = digitos(cpf_segurado);
    if (cpf.length === 11) {
      const fmt = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
      const { data } = await supabase.from('zapsign_documents').select(COLUNAS).in('outorgante_cpf', [cpf, fmt]);
      (data || []).forEach((d: any) => push(d, 'CPF do segurado'));
    }

    // Termos de busca: o que a pessoa digitou vale mais; sem isso, os nomes
    // próprios do título do grupo, que é onde costuma estar o nome da mãe.
    const termos: string[] = [];
    if (busca && String(busca).trim().length >= 3) termos.push(String(busca).trim());
    else {
      if (nome_segurado) termos.push(String(nome_segurado));
      for (const t of norm(lead_name).split(' ')) {
        if (t.length > 3 && !RUIDO_DO_GRUPO.has(t) && !/^\d+$/.test(t)) termos.push(t);
      }
    }
    for (const termo of termos.slice(0, 6)) {
      const escapado = termo.replace(/[%,()]/g, ' ').trim();
      if (escapado.length < 3) continue;
      const { data } = await supabase
        .from('zapsign_documents')
        .select(COLUNAS)
        .or(`outorgante_name.ilike.%${escapado}%,signer_name.ilike.%${escapado}%`)
        .order('created_at', { ascending: false })
        .limit(40);
      (data || []).forEach((d: any) => push(d, `nome contém "${escapado}"`));
    }

    const lista = [...achadas.values()].sort((a, b) => {
      if (a.ja_vinculado !== b.ja_vinculado) return a.ja_vinculado ? -1 : 1;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    return res.status(200).json({ success: true, candidatas: lista.slice(0, 40), total: lista.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[inss-procuracao-vincular] error:', msg);
    return res.status(200).json({ success: false, error: msg });
  }
};

// Procuração para assinatura MANUSCRITA nas exigências do INSS.
//
// Desde meados de 2026 o INSS deixou de aceitar a procuração assinada pelo
// ZapSign. Os despachos são explícitos: "favor reenviar o documento acima
// citado, assinado de forma manuscrita", "deve corrigir o erro ou apresentar
// nova procuração com consulta de autenticidade válida ou procuração
// física/original", "o documento anexado consta Assinado por: ZAPSIGN
// PROCESSAMENTO DE DADOS LTDA, quando na realidade deveria constar assinado por
// (nome e CPF da Requerente)". São 78 exigências, em 71 requerimentos.
//
// Não geramos PDF nenhum: o documento já existe. Todo documento criado pelo
// ZapSign guarda em `zapsign_documents.original_file_url` o PDF ANTES da
// assinatura — a procuração já preenchida com a qualificação do cliente, com a
// data e a linha "____ OUTORGANTE" em branco, e sem nenhuma marca do ZapSign
// (o `signed_file_url` é que carrega a tarja e o rodapé que o INSS recusa).
// Medido em 01/09/2026: 3.327 dos 3.328 documentos têm essa URL, e ela é
// pública no S3 do ZapSign — baixa com GET anônimo, sem token e sem consumir
// cota da API. Amostra de dez/2025 a mai/2026: todas responderam 200.
//
// A identificação é SEMPRE determinística. A tentação é casar pelo nome que
// aparece no grupo, porque em BPC e maternidade o `nome_segurado` é a criança e
// quem assina a procuração é a mãe. Foi medido e está proibido: o título do
// grupo ("✅ PREV 1129 GABRIELY - BENTO") também carrega o nome do ACOLHEDOR, e
// o casamento por semelhança entregava a procuração de uma funcionária para 9
// clientes diferentes — CPF e endereço dela iriam ao INSS no lugar dos do
// cliente. Sem chave exata, o robô avisa e uma pessoa escolhe o documento.

import { supabase } from './supabase';
import { exigeProcuracao } from './inss-despacho';

export { exigeProcuracao };

/** Documento achado, pronto para imprimir e assinar à caneta. */
export interface ProcuracaoParaAssinar {
  url: string;
  docToken: string;
  documentName: string | null;
  outorganteName: string | null;
  criadoEm: string | null;
  /** Como o documento foi ligado ao requerimento — vai no texto da atividade. */
  via: 'vínculo do lead' | 'CPF do segurado' | 'nome do segurado' | 'nome do representante';
}

const norm = (s?: string | null) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const digitos = (s?: string | null) => (s || '').replace(/\D/g, '');

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

function ehProcuracao(d: { tipo_documento?: string | null }): boolean {
  return !d.tipo_documento || !NAO_E_PROCURACAO.has(d.tipo_documento);
}

const COLUNAS =
  'doc_token, lead_id, outorgante_cpf, outorgante_name, signer_name, representante_name, ' +
  'original_file_url, document_name, template_name, tipo_documento, created_at';

type Doc = Record<string, any>;

/** Mais recente primeiro — a procuração vigente é a última que o cliente assinou. */
function melhor(docs: Doc[]): Doc | null {
  const uteis = docs.filter((d) => d.original_file_url && ehProcuracao(d));
  if (!uteis.length) return null;
  return uteis.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
}

/**
 * Acha o PDF sem assinatura da procuração deste cliente. Devolve `null` quando
 * nenhuma chave exata bate — nunca um palpite.
 */
export async function buscarProcuracaoDoCliente(args: {
  leadId?: string | null;
  cpfSegurado?: string | null;
  nomeSegurado?: string | null;
}): Promise<ProcuracaoParaAssinar | null> {
  const achar = (d: Doc, via: ProcuracaoParaAssinar['via']): ProcuracaoParaAssinar => ({
    url: d.original_file_url,
    docToken: d.doc_token,
    documentName: d.document_name || d.template_name || null,
    outorganteName: d.outorgante_name || d.signer_name || null,
    criadoEm: d.created_at || null,
    via,
  });

  if (args.leadId) {
    const { data } = await supabase.from('zapsign_documents').select(COLUNAS).eq('lead_id', args.leadId);
    const d = melhor((data as Doc[]) || []);
    if (d) return achar(d, 'vínculo do lead');
  }

  const cpf = digitos(args.cpfSegurado);
  if (cpf.length === 11) {
    // A coluna guarda o CPF formatado e sem formatar, conforme o extrator.
    const formatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const { data } = await supabase
      .from('zapsign_documents').select(COLUNAS).in('outorgante_cpf', [cpf, formatado]);
    const d = melhor((data as Doc[]) || []);
    if (d) return achar(d, 'CPF do segurado');
  }

  const nome = norm(args.nomeSegurado);
  if (nome.length > 8) {
    // `ilike` sem curinga é comparação exata sem diferenciar caixa; o acento é
    // que não normaliza no Postgres, então a conferência final é em JS.
    //
    // `representante_name` entra como chave porque a procuração de menor é
    // lavrada assim: "OUTORGANTE: BENTO DA SILVA EMILIANO, MENOR, NESTE ATO
    // REPRESENTADO POR SUA GENITORA GABRIELY DA SILVA". O outorgante é a
    // criança (que é o `nome_segurado` do requerimento) e a mãe é a
    // representante — então o requerimento casa por um lado ou pelo outro,
    // conforme em nome de quem ele foi protocolado. Continua sendo nome
    // IDÊNTICO: casar pedaço de nome segue proibido (ver o cabeçalho).
    const nomeBruto = String(args.nomeSegurado);
    const { data } = await supabase
      .from('zapsign_documents').select(COLUNAS)
      .or(
        `outorgante_name.ilike.${nomeBruto},signer_name.ilike.${nomeBruto},` +
        `representante_name.ilike.${nomeBruto}`,
      );
    const docs = (data as Doc[]) || [];
    const porOutorgante = docs.filter(
      (d) => norm(d.outorgante_name) === nome || norm(d.signer_name) === nome,
    );
    const d = melhor(porOutorgante);
    if (d) return achar(d, 'nome do segurado');
    // Requerimento protocolado no nome de quem representa o menor.
    const porRepresentante = docs.filter((d) => norm(d.representante_name) === nome);
    const r = melhor(porRepresentante);
    if (r) return achar(r, 'nome do representante');
  }

  return null;
}

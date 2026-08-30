// =============================================================================
// A CAPA do processo no Escavador, traduzida para as colunas de lead_processes.
//
// POR QUE EXISTE (30/08/2026): o endpoint /processos/{cnj}/movimentacoes NÃO
// devolve capa. Quem só passou por ele fica com a ficha vazia — 1.175 dos 1.291
// processos judiciais estavam sem tribunal e 1.181 sem polo ativo. A edge
// backfill-process-marcos já pagava uma consulta extra em /processos/{cnj} para
// esses casos, mas aproveitava só três campos (data_distribuicao, data_inicio,
// ano_inicio) e jogava o resto fora. Este módulo é o "resto".
//
// Espelha o mesmo mapeamento que a ficha faz em handleReExtract
// (src/components/cases/ProcessDetailSheet.tsx). Só campos de CAPA: quem cuida
// de movimentações, quantidade e data da última verificação é quem chama.
// =============================================================================

/**
 * As colunas de lead_processes que mapearCapa() sabe preencher.
 *
 * Serve para quem lê a linha ANTES de gravar: sem trazer estas colunas no
 * SELECT, "está vazio?" responde undefined para todas e a capa da API passaria
 * por cima de campo já preenchido à mão.
 */
export const COLUNAS_DA_CAPA = [
  'classe', 'area', 'assunto_principal', 'assuntos', 'orgao_julgador',
  'valor_causa', 'valor_causa_formatado', 'moeda', 'situacao',
  'data_distribuicao', 'data_arquivamento', 'informacoes_complementares',
  'tribunal', 'tribunal_sigla', 'grau', 'sistema', 'url_tribunal',
  'segredo_justica', 'arquivado', 'status_predito', 'fisico',
  'estado_origem', 'estado_origem_sigla', 'unidade_origem',
  'unidade_origem_endereco', 'unidade_origem_classificacao', 'unidade_origem_cidade',
  'polo_ativo', 'polo_passivo', 'ano_inicio', 'data_inicio',
  'audiencias', 'envolvidos', 'fonte_nome', 'fonte_tipo',
  'fonte_data_inicio', 'fonte_data_fim',
] as const;

/** Resposta de GET /api/v2/processos/numero_cnj/{cnj}. Campos livres de propósito. */
export type RespostaCapa = Record<string, unknown>;

const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};

const texto = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : '');
  return s || null;
};

const booleano = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/**
 * Traduz a resposta da capa nas colunas de lead_processes.
 * Devolve SÓ o que veio preenchido — nunca escreve null por cima de dado bom.
 */
export function mapearCapa(raw: RespostaCapa | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  const fontes = Array.isArray(raw.fontes) ? raw.fontes : [];
  const fonte = obj(fontes[0]);
  const capa = obj(fonte.capa);
  const valorCausa = obj(capa.valor_causa);
  const estadoOrigem = obj(raw.estado_origem);
  const unidadeOrigem = obj(raw.unidade_origem);
  const orgaoNorm = obj(capa.orgao_julgador_normatizado);
  const assuntos = Array.isArray(capa.assuntos_normalizados)
    ? (capa.assuntos_normalizados as Record<string, unknown>[]).map((a) => texto(a?.nome)).filter(Boolean)
    : [];

  const bruto: Record<string, unknown> = {
    classe: texto(capa.classe) ?? texto(obj(fonte.classe).nome),
    area: texto(capa.area) ?? texto(obj(fonte.area).nome),
    assunto_principal: texto(obj(capa.assunto_principal_normalizado).nome) ?? texto(capa.assunto),
    assuntos: assuntos.length ? assuntos : null,
    orgao_julgador: texto(capa.orgao_julgador),
    valor_causa: texto(valorCausa.valor) ? Number(valorCausa.valor) : (texto(raw.valor_causa) ? Number(raw.valor_causa) : null),
    valor_causa_formatado: texto(valorCausa.valor_formatado),
    moeda: texto(valorCausa.moeda),
    situacao: texto(capa.situacao) ?? texto(fonte.situacao) ?? texto(fonte.status_predito),
    data_distribuicao: texto(capa.data_distribuicao),
    data_arquivamento: texto(capa.data_arquivamento),
    informacoes_complementares: texto(capa.informacoes_complementares),
    tribunal: texto(obj(fonte.tribunal).nome) ?? texto(fonte.descricao) ?? texto(fonte.nome),
    tribunal_sigla: texto(obj(fonte.tribunal).sigla) ?? texto(fonte.sigla),
    grau: texto(fonte.grau_formatado) ?? texto(fonte.grau),
    sistema: texto(fonte.sistema),
    url_tribunal: texto(fonte.url),
    segredo_justica: booleano(fonte.segredo_justica),
    arquivado: booleano(fonte.arquivado),
    status_predito: texto(fonte.status_predito),
    fisico: booleano(fonte.fisico),
    estado_origem: texto(estadoOrigem.nome) ?? texto(obj(orgaoNorm.estado).nome),
    estado_origem_sigla: texto(estadoOrigem.sigla) ?? texto(obj(orgaoNorm.estado).sigla),
    unidade_origem: texto(unidadeOrigem.nome) ?? texto(orgaoNorm.nome),
    unidade_origem_endereco: texto(unidadeOrigem.endereco) ?? texto(orgaoNorm.endereco),
    unidade_origem_classificacao: texto(unidadeOrigem.classificacao) ?? texto(orgaoNorm.classificacao),
    unidade_origem_cidade: texto(unidadeOrigem.cidade) ?? texto(orgaoNorm.cidade),
    polo_ativo: texto(raw.titulo_polo_ativo),
    polo_passivo: texto(raw.titulo_polo_passivo),
    ano_inicio: texto(raw.ano_inicio) ? Number(raw.ano_inicio) : null,
    data_inicio: texto(raw.data_inicio),
    audiencias: Array.isArray(fonte.audiencias) && fonte.audiencias.length ? fonte.audiencias : null,
    envolvidos: Array.isArray(fonte.envolvidos) && fonte.envolvidos.length ? fonte.envolvidos : null,
    fonte_nome: texto(fonte.nome) ?? texto(fonte.descricao),
    fonte_tipo: texto(fonte.tipo),
    fonte_data_inicio: texto(fonte.data_inicio),
    fonte_data_fim: texto(fonte.data_ultima_movimentacao),
  };

  const limpo: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (valor === null || valor === undefined || valor === '' || Number.isNaN(valor)) continue;
    limpo[chave] = valor;
  }
  return limpo;
}

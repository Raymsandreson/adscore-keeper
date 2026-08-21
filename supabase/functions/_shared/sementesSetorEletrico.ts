// =============================================================================
// Sementes de prospecção — setor elétrico de distribuição.
//
// POR QUE ESTE SETOR: trabalho de campo em rede elétrica concentra acidente
// grave (choque, queda de altura, queimadura por arco) e a operação é
// majoritariamente TERCEIRIZADA. Duas consequências práticas para a
// prospecção: o volume de ação por acidente é alto, e o valor da causa tende a
// passar do piso porque envolve invalidez, morte ou dano estético.
//
// QUEM É RÉ, E POR QUÊ ISSO IMPORTA NA ESCOLHA DA SEMENTE:
// a TERCEIRIZADA é a empregadora — é ela que figura como ré principal na ação
// do trabalhador. A CONCESSIONÁRIA costuma entrar por responsabilidade
// subsidiária (Súmula 331 do TST). Semear pela terceirizada tende a render
// mais acidente por consulta; semear pela concessionária pega o caso mesmo
// quando a terceirizada mudou de nome ou fechou.
//
// O ADVOGADO ALVO ESTÁ NO POLO ATIVO. Estas empresas são o polo PASSIVO — são
// a chave de busca, não o destinatário. Quem recebe a oferta é o advogado do
// trabalhador, extraído por extrairAdvogadosPoloAtivo().
//
// PRECISÃO: busca por NOME é imprecisa — casa por similaridade e pode trazer
// homônimo de outro ramo. CNPJ é exato. Por isso cada semente tem campo
// `cnpj`, nulo até alguém preencher com o número real; quando houver CNPJ,
// preferir varrer_cnpj a varrer_nome.
//
// PROCEDÊNCIA: lista levantada pelo usuário em 20/08/2026 a partir de material
// jornalístico sobre terceirização no setor elétrico. NÃO foi verificada
// contra a Receita nem contra a base do Escavador — deste ambiente não há
// acesso de rede a nenhum dos dois. Tratar como hipótese de trabalho: rodar
// dry_run primeiro e descartar semente que não render.
// =============================================================================

export type TipoSemente = 'terceirizada' | 'concessionaria';

export interface SementeEmpresa {
  nome: string;
  tipo: TipoSemente;
  grupo: string;
  /** UFs onde a empresa atua — orienta qual TRT vai aparecer nos resultados. */
  ufs: string[];
  /** Exato quando preenchido. Nulo = só dá para buscar por nome. */
  cnpj: string | null;
  /**
   * 1 = varrer primeiro. Prioridade alta é para terceirizada que atua em
   * VÁRIOS grupos/UFs: uma consulta cobre mais território, então rende mais
   * candidato por real gasto.
   */
  prioridade: 1 | 2 | 3;
  nota?: string;
}

export const SEMENTES_SETOR_ELETRICO: SementeEmpresa[] = [
  // ---------------------------------------------------------------------------
  // Prioridade 1 — terceirizadas nacionais, presentes em vários grupos.
  // São as sementes de melhor rendimento: uma busca cobre múltiplas UFs.
  // ---------------------------------------------------------------------------
  {
    nome: 'Sirtec Sistemas Eletricos',
    tipo: 'terceirizada',
    grupo: 'multi',
    ufs: ['SP', 'CE', 'RS', 'DF', 'MA', 'PI', 'AL'],
    cnpj: null,
    prioridade: 1,
    nota: 'Atua com CPFL, Enel, Equatorial e Neoenergia. Maior alcance da lista.',
  },
  {
    nome: 'B&Q Energia',
    tipo: 'terceirizada',
    grupo: 'multi',
    ufs: ['MG', 'BA', 'PE', 'RN', 'MA', 'PI', 'AL', 'PA', 'AP', 'GO'],
    cnpj: null,
    prioridade: 1,
    nota: 'Cemig, Equatorial e Neoenergia. Cobre Nordeste, Norte e MG.',
  },
  {
    nome: 'Zopone Engenharia',
    tipo: 'terceirizada',
    grupo: 'multi',
    ufs: ['SP', 'PB', 'SE', 'MT', 'MS', 'TO', 'RO', 'AC', 'DF'],
    cnpj: null,
    prioridade: 1,
    nota: 'Energisa e CPFL. Forte no Centro-Oeste e Norte.',
  },
  {
    nome: 'Elecnor Brasil',
    tipo: 'terceirizada',
    grupo: 'multi',
    ufs: ['SP', 'RS'],
    cnpj: null,
    prioridade: 1,
    nota: 'Expansão de linhas para concessionárias do Sudeste e Sul.',
  },
  {
    nome: 'Serede Servicos de Rede',
    tipo: 'terceirizada',
    grupo: 'multi',
    ufs: ['RJ', 'SP'],
    cnpj: null,
    prioridade: 1,
    nota: 'Muito forte no RJ (Light e Enel Rio).',
  },

  // ---------------------------------------------------------------------------
  // Prioridade 2 — terceirizadas regionais.
  // ---------------------------------------------------------------------------
  { nome: 'Lider Construcoes', tipo: 'terceirizada', grupo: 'equatorial', ufs: ['MA', 'PI', 'AL', 'PA', 'AP', 'GO'], cnpj: null, prioridade: 2 },
  { nome: 'Proelt Engenharia', tipo: 'terceirizada', grupo: 'equatorial/copel', ufs: ['MA', 'PI', 'AL', 'PR'], cnpj: null, prioridade: 2 },
  { nome: 'Sertenge', tipo: 'terceirizada', grupo: 'neoenergia', ufs: ['BA'], cnpj: null, prioridade: 2 },
  { nome: 'Sinaliza', tipo: 'terceirizada', grupo: 'neoenergia/edp/cpfl', ufs: ['BA', 'PE', 'RN', 'SP', 'ES', 'RS'], cnpj: null, prioridade: 2 },
  { nome: 'Instaladora Sao Marcos', tipo: 'terceirizada', grupo: 'energisa', ufs: ['PB', 'SE'], cnpj: null, prioridade: 2 },
  { nome: 'Manserv', tipo: 'terceirizada', grupo: 'enel', ufs: ['CE', 'SP', 'RJ'], cnpj: null, prioridade: 2 },
  { nome: 'Incen Engenharia', tipo: 'terceirizada', grupo: 'cemig/energisa', ufs: ['MG', 'MT', 'MS', 'TO', 'RO', 'AC'], cnpj: null, prioridade: 2 },
  { nome: 'Selt Engenharia', tipo: 'terceirizada', grupo: 'cemig/celesc', ufs: ['MG', 'SC'], cnpj: null, prioridade: 2 },
  { nome: 'Engeform', tipo: 'terceirizada', grupo: 'light', ufs: ['RJ'], cnpj: null, prioridade: 2 },
  { nome: 'Alusa Engenharia', tipo: 'terceirizada', grupo: 'cpfl', ufs: ['SP'], cnpj: null, prioridade: 2 },
  { nome: 'Contek Engenharia', tipo: 'terceirizada', grupo: 'edp', ufs: ['SP', 'ES'], cnpj: null, prioridade: 2 },
  { nome: 'Quantum Engenharia', tipo: 'terceirizada', grupo: 'celesc', ufs: ['SC'], cnpj: null, prioridade: 2 },
  { nome: 'Murali', tipo: 'terceirizada', grupo: 'enel/energisa', ufs: ['SP', 'RJ', 'MT', 'MS', 'TO', 'RO', 'AC'], cnpj: null, prioridade: 2 },

  // ---------------------------------------------------------------------------
  // Prioridade 3 — concessionárias.
  // Pegam o caso por responsabilidade subsidiária, inclusive quando a
  // terceirizada sumiu. Volume de processo é enorme e a maioria NÃO é
  // acidente (tarifa, consumidor), então o filtro descarta muito — por isso
  // vêm por último.
  // ---------------------------------------------------------------------------
  { nome: 'Equatorial Maranhao Distribuidora de Energia', tipo: 'concessionaria', grupo: 'equatorial', ufs: ['MA'], cnpj: null, prioridade: 3 },
  { nome: 'Equatorial Piaui Distribuidora de Energia', tipo: 'concessionaria', grupo: 'equatorial', ufs: ['PI'], cnpj: null, prioridade: 3 },
  { nome: 'Equatorial Alagoas Distribuidora de Energia', tipo: 'concessionaria', grupo: 'equatorial', ufs: ['AL'], cnpj: null, prioridade: 3 },
  { nome: 'Equatorial Para Distribuidora de Energia', tipo: 'concessionaria', grupo: 'equatorial', ufs: ['PA'], cnpj: null, prioridade: 3 },
  { nome: 'Neoenergia Coelba', tipo: 'concessionaria', grupo: 'neoenergia', ufs: ['BA'], cnpj: null, prioridade: 3 },
  { nome: 'Neoenergia Pernambuco', tipo: 'concessionaria', grupo: 'neoenergia', ufs: ['PE'], cnpj: null, prioridade: 3 },
  { nome: 'Neoenergia Cosern', tipo: 'concessionaria', grupo: 'neoenergia', ufs: ['RN'], cnpj: null, prioridade: 3 },
  { nome: 'Energisa Paraiba', tipo: 'concessionaria', grupo: 'energisa', ufs: ['PB'], cnpj: null, prioridade: 3 },
  { nome: 'Energisa Sergipe', tipo: 'concessionaria', grupo: 'energisa', ufs: ['SE'], cnpj: null, prioridade: 3 },
  { nome: 'Energisa Mato Grosso', tipo: 'concessionaria', grupo: 'energisa', ufs: ['MT'], cnpj: null, prioridade: 3 },
  { nome: 'Enel Distribuicao Ceara', tipo: 'concessionaria', grupo: 'enel', ufs: ['CE'], cnpj: null, prioridade: 3 },
  { nome: 'Enel Distribuicao Sao Paulo', tipo: 'concessionaria', grupo: 'enel', ufs: ['SP'], cnpj: null, prioridade: 3 },
  { nome: 'Cemig Distribuicao', tipo: 'concessionaria', grupo: 'cemig', ufs: ['MG'], cnpj: null, prioridade: 3 },
  { nome: 'Light Servicos de Eletricidade', tipo: 'concessionaria', grupo: 'light', ufs: ['RJ'], cnpj: null, prioridade: 3 },
  { nome: 'CPFL Paulista', tipo: 'concessionaria', grupo: 'cpfl', ufs: ['SP'], cnpj: null, prioridade: 3 },
  { nome: 'CPFL RGE', tipo: 'concessionaria', grupo: 'cpfl', ufs: ['RS'], cnpj: null, prioridade: 3 },
  { nome: 'Copel Distribuicao', tipo: 'concessionaria', grupo: 'copel', ufs: ['PR'], cnpj: null, prioridade: 3 },
  { nome: 'Celesc Distribuicao', tipo: 'concessionaria', grupo: 'celesc', ufs: ['SC'], cnpj: null, prioridade: 3 },
];

/**
 * Sementes na ordem em que devem ser varridas: prioridade primeiro, e dentro
 * da mesma prioridade a que cobre mais UF na frente — mais território por
 * consulta paga.
 */
export function sementesPorPrioridade(
  filtro?: { tipo?: TipoSemente; uf?: string; prioridadeMaxima?: 1 | 2 | 3 },
): SementeEmpresa[] {
  const uf = filtro?.uf?.toUpperCase();
  return SEMENTES_SETOR_ELETRICO
    .filter((s) => (filtro?.tipo ? s.tipo === filtro.tipo : true))
    .filter((s) => (uf ? s.ufs.includes(uf) : true))
    .filter((s) => (filtro?.prioridadeMaxima ? s.prioridade <= filtro.prioridadeMaxima : true))
    .sort((a, b) =>
      a.prioridade - b.prioridade
      || b.ufs.length - a.ufs.length
      || a.nome.localeCompare(b.nome),
    );
}

/** Acha uma semente pelo nome, sem depender de caixa ou acento. */
export function acharSemente(nome: string): SementeEmpresa | null {
  const alvo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return (
    SEMENTES_SETOR_ELETRICO.find(
      (s) => s.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === alvo,
    ) ?? null
  );
}

// =============================================================================
// Busca de processo: pelo número, pela parte, ou por qualquer texto da ficha.
//
// A aba "Processos do POP" listava `lead_processes` cru, sem busca nenhuma —
// achar um processo entre 1289 fichas era rolar a lista. Aqui a ficha inteira
// vira um palheiro de texto normalizado, e a busca corre em cima dele.
//
// TRÊS JEITOS DE PROCURAR, no mesmo campo:
//   número   "0000581-03.2026.5.06.0391", "00005810320265060391" ou só "581032026"
//            — a pontuação é jogada fora dos dois lados antes de comparar.
//   parte    autor, réu, e todo mundo do `envolvidos` do Escavador, advogado
//            incluído. Também o nome do lead, que na prática carrega a cidade
//            ("Caso 88 - Mauro- Ererê/CE").
//   texto    classe, assunto, órgão julgador, tribunal, cidade, observação,
//            descrição, área — o que estiver preenchido na ficha.
//
// TERMOS SOMAM: "premolaje pernambuco" só acha quem tem os dois. É o que
// permite recortar um réu dentro de um estado sem filtro nenhum na tela.
// =============================================================================
import { parseCnj, onlyDigits } from './cnj';
import { ramoDoProcesso, RAMO_BADGE } from './ramoDoProcesso';

/** Sem acento e em minúscula: buscar "ererê" tem que achar "Ererê" e "EREREE". */
export const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** O que a busca precisa enxergar. Tudo opcional — ficha vem pela metade. */
export interface ProcessoBuscavel {
  process_number?: string | null;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  polo_ativo?: string | null;
  polo_passivo?: string | null;
  classe?: string | null;
  area?: string | null;
  assunto_principal?: string | null;
  assuntos?: string[] | null;
  tribunal?: string | null;
  tribunal_sigla?: string | null;
  orgao_julgador?: string | null;
  unidade_origem?: string | null;
  unidade_origem_cidade?: string | null;
  estado_origem?: string | null;
  estado_origem_sigla?: string | null;
  situacao?: string | null;
  status?: string | null;
  process_type?: string | null;
  envolvidos?: unknown;
}

/** Nomes de dentro do `envolvidos` do Escavador — partes e seus advogados. */
const nomesDosEnvolvidos = (envolvidos: unknown): string[] => {
  if (!Array.isArray(envolvidos)) return [];
  const nomes: string[] = [];
  for (const bruto of envolvidos) {
    if (!bruto || typeof bruto !== 'object') continue;
    const e = bruto as Record<string, unknown>;
    if (typeof e.nome === 'string') nomes.push(e.nome);
    // CPF/CNPJ entram sem pontuação: quem cola um CNPJ do site do tribunal acha.
    if (typeof e.cnpj === 'string') nomes.push(e.cnpj);
    if (typeof e.cpf === 'string') nomes.push(e.cpf);
    if (Array.isArray(e.advogados)) {
      for (const adv of e.advogados) {
        if (adv && typeof adv === 'object' && typeof (adv as { nome?: unknown }).nome === 'string') {
          nomes.push((adv as { nome: string }).nome);
        }
      }
    }
  }
  return nomes;
};

/**
 * O palheiro de uma ficha. `extras` é para o que não mora em `lead_processes`
 * — hoje o nome do lead e o da empresa demandada da Tabela Auxiliar.
 */
export const palheiroDoProcesso = (p: ProcessoBuscavel, extras: Array<string | null | undefined> = []): string => {
  const cnj = parseCnj(p.process_number);
  const pedacos: Array<string | null | undefined> = [
    p.process_number,
    onlyDigits(p.process_number) || null,
    // A máscara também, para quem digita com ponto o que está salvo sem.
    cnj?.formatted,
    cnj?.courtCode,
    // Todas as UFs do tribunal: no TRT-8 quem busca "AP" também tem de achar.
    ...(cnj?.ufs ?? []),
    RAMO_BADGE[ramoDoProcesso(p.process_number)],
    p.title, p.description, p.notes,
    p.polo_ativo, p.polo_passivo,
    p.classe, p.area, p.assunto_principal,
    ...(p.assuntos ?? []),
    p.tribunal, p.tribunal_sigla, p.orgao_julgador,
    p.unidade_origem, p.unidade_origem_cidade,
    p.estado_origem, p.estado_origem_sigla,
    p.situacao, p.status, p.process_type,
    ...nomesDosEnvolvidos(p.envolvidos),
    ...extras,
  ];
  return normalizar(pedacos.filter(Boolean).join('  '));
};

/**
 * Quebra o que foi digitado em termos. Um termo só de dígitos vira busca de
 * número: "0000581-03.2026" e "00005810320265060391" viram a mesma coisa.
 */
export const termosDaBusca = (busca: string): string[] => {
  const bruto = normalizar(busca).trim();
  if (!bruto) return [];
  return bruto.split(/\s+/).map(t => {
    const so = t.replace(/\D/g, '');
    // 4+ dígitos e nada além de pontuação: é número de processo, CPF ou CNPJ.
    return so.length >= 4 && so.length === t.replace(/[^\w]/g, '').length ? so : t;
  }).filter(Boolean);
};

/** Todos os termos têm de bater. "premolaje pernambuco" exige os dois. */
export const casaComBusca = (palheiro: string, termos: string[]): boolean =>
  termos.every(t => palheiro.includes(t));

/** Atalho para quem só quer filtrar uma lista já carregada. */
export const filtrarProcessos = <T extends ProcessoBuscavel>(
  processos: T[],
  busca: string,
  extrasDe: (p: T) => Array<string | null | undefined> = () => [],
): T[] => {
  const termos = termosDaBusca(busca);
  if (!termos.length) return processos;
  return processos.filter(p => casaComBusca(palheiroDoProcesso(p, extrasDe(p)), termos));
};

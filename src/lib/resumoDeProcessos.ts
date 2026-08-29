// =============================================================================
// Quantos processos são, de verdade, e quantos são do ramo que o POP promete.
//
// O card do POP anunciava "Processos 1289" contando linha de `lead_processes`.
// Linha é FICHA, não processo, e ficha não é processo por dois motivos:
//   1. o mesmo CNJ pode ter mais de uma ficha (48 CNJs repetidos na base);
//   2. ficha sem número não é processo identificável — são 210 só neste POP.
//
// E o POP "Trabalhistas judicial — marcos" tinha, em 24/08/2026:
//   796 fichas /  786 CNJs  na Justiça do Trabalho   <- o que o POP promete
//   215 fichas /  206 CNJs  na Justiça Estadual
//    51 fichas /   49 CNJs  na Justiça Federal
//   210 fichas sem número
//    17 fichas com número quebrado
//
// Este módulo devolve os três números de uma vez para a tela poder dizer
// "786 trabalhistas · 255 de outra justiça · 227 sem número utilizável" em vez
// de um 1289 que não significa nada.
// =============================================================================
import { onlyDigits } from './cnj';
import {
  ramoDoProcesso, RAMO_ORDEM, RAMO_SEM_IDENTIDADE, type RamoDoProcesso,
} from './ramoDoProcesso';

export interface ResumoRamo {
  ramo: RamoDoProcesso;
  /** Linhas de `lead_processes`. */
  fichas: number;
  /** CNJs distintos. Em SEM_NUMERO e NUMERO_INVALIDO é igual a `fichas`: sem
   *  número identificável, cada ficha conta por si. */
  processos: number;
  /** Fichas a mais do que processos — o passivo de duplicata deste ramo. */
  excedentes: number;
}

export interface ResumoDeProcessos {
  fichas: number;
  /** O número honesto: CNJs distintos + cada ficha sem número contando por si. */
  processos: number;
  excedentes: number;
  porRamo: ResumoRamo[];
  doRamo: (ramo: RamoDoProcesso) => ResumoRamo | undefined;
}

export const resumirProcessos = (
  fichas: Array<{ process_number?: string | null }>,
): ResumoDeProcessos => {
  const contagem = new Map<RamoDoProcesso, { fichas: number; cnjs: Set<string>; soltas: number }>();

  for (const f of fichas) {
    const ramo = ramoDoProcesso(f.process_number);
    let c = contagem.get(ramo);
    if (!c) { c = { fichas: 0, cnjs: new Set(), soltas: 0 }; contagem.set(ramo, c); }
    c.fichas += 1;
    if (RAMO_SEM_IDENTIDADE.has(ramo)) c.soltas += 1;
    else c.cnjs.add(onlyDigits(f.process_number));
  }

  const porRamo: ResumoRamo[] = RAMO_ORDEM
    .filter(r => contagem.has(r))
    .map(r => {
      const c = contagem.get(r)!;
      const processos = c.cnjs.size + c.soltas;
      return { ramo: r, fichas: c.fichas, processos, excedentes: c.fichas - processos };
    });

  const total = porRamo.reduce(
    (acc, r) => ({
      fichas: acc.fichas + r.fichas,
      processos: acc.processos + r.processos,
      excedentes: acc.excedentes + r.excedentes,
    }),
    { fichas: 0, processos: 0, excedentes: 0 },
  );

  return { ...total, porRamo, doRamo: (ramo) => porRamo.find(r => r.ramo === ramo) };
};

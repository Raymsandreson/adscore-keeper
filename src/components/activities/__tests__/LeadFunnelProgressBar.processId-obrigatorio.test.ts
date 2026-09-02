/**
 * Invariante de tela: quem monta a barra do POP com um PROCESSO em mãos tem que
 * passar `processId`.
 *
 * Sem ele, `useProcessoMarcos(null)` volta vazio, a barra cai no percentual de
 * PASSOS marcados à mão (`calculateHierarchicalProgress`) e ainda perde a fase
 * gravada em `lead_processes.workflow_stage_id`, voltando para a 1ª fase do POP.
 * Resultado: a mesma régua vira dois números na mesma carteira.
 *
 * Já aconteceu duas vezes, nas telas gêmeas:
 *  - caso 88 (30/08/2026): consertado só no ActivityFullSheet;
 *  - caso 60 (02/09/2026), processo 0100419-74.2021.5.01.0281: a ActivitiesPage
 *    ficou sem, e mostrava "Pré-Processual · fase 1 de 24 · 3%" enquanto a ficha
 *    do processo mostrava "Embargos de declaração (2º grau) · fase 10 de 24 · 80%".
 *    Medido no banco na época: 999 dos 1.290 processos desse POP com a fase errada.
 *
 * Único ramo dispensado: `origemDoPop="lead"` — ali não há processo nenhum.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === 'node_modules' ? [] : arquivosTsx(caminho);
    return caminho.endsWith('.tsx') ? [caminho] : [];
  });
}

describe('LeadFunnelProgressBar: processId não é opcional quando há processo', () => {
  it('todo ponto de montagem que não é o funil do lead passa processId', () => {
    const semProcessId: string[] = [];
    let encontrados = 0;

    for (const arquivo of arquivosTsx(SRC)) {
      const linhas = readFileSync(arquivo, 'utf-8').split('\n');
      linhas.forEach((linha, i) => {
        if (!linha.includes('<LeadFunnelProgressBar')) return;
        // Só interessa a montagem real (JSX de uma linha, como está hoje nas 6
        // chamadas); import e comentário não têm `leadId=`.
        if (!linha.includes('leadId=')) return;
        encontrados++;
        if (linha.includes('origemDoPop="lead"')) return;
        if (!linha.includes('processId=')) {
          semProcessId.push(`${relative(process.cwd(), arquivo)}:${i + 1}`);
        }
      });
    }

    // Guarda contra a varredura passar a achar nada (refactor de JSX multilinha):
    // um teste que não vê chamada nenhuma passaria sempre.
    expect(encontrados).toBeGreaterThanOrEqual(6);
    expect(semProcessId).toEqual([]);
  });
});

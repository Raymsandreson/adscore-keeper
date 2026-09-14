/**
 * Os passos do POP abrem em ABA LATERAL, numa lista só — não dentro da atividade
 * e não uma fase por vez.
 *
 * Por que existe: até 14/09/2026 o painel era um `<Collapsible>` que abria DENTRO
 * do cabeçalho da atividade, numa caixa de 320px, mostrando UMA fase de cada vez
 * (navegação "Fase anterior / Próxima fase"). A equipe parou de usar: ficha e POP
 * disputando a mesma tela, e um marco por "aba" obrigava a caçar onde o processo
 * parou. Pedido do usuário: barra continua na atividade, os passos vão para a aba
 * lateral, todas as fases empilhadas, com a rolagem caindo no passo atual.
 *
 * Quem for reverter para o painel embutido passa por aqui primeiro.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FONTE = readFileSync(
  join(process.cwd(), 'src/components/activities/LeadFunnelProgressBar.tsx'),
  'utf-8',
);

describe('LeadFunnelProgressBar: painel dos passos é aba lateral', () => {
  it('não renderiza os passos embutidos na atividade', () => {
    expect(FONTE).not.toContain('CollapsibleContent');
    expect(FONTE).not.toContain('@/components/ui/collapsible');
  });

  it('abre em Sheet à esquerda — ao lado da ficha, nunca por cima dela', () => {
    expect(FONTE).toContain("from '@/components/ui/sheet'");
    expect(FONTE).toMatch(/<SheetContent\s+side="left"/);
  });

  it('mostra TODAS as fases numa lista só, sem navegação por fase', () => {
    // O agrupamento por fase substituiu o filtro de fase única.
    expect(FONTE).toContain('instancesPorFase');
    expect(FONTE).not.toContain('currentStageInstances');
    // Os botões de "aba" por marco não existem mais.
    expect(FONTE).not.toContain('Fase anterior');
    expect(FONTE).not.toContain('Próxima fase');
  });

  it('rola até o passo atual e deixa recolher por marco, objetivo ou passo', () => {
    expect(FONTE).toContain('passoAtualRef');
    expect(FONTE).toContain('scrollIntoView');
    expect(FONTE).toMatch(/NivelVisao = 'marcos' \| 'objetivos' \| 'passos'/);
    expect(FONTE).toContain('faseAberta');
    expect(FONTE).toContain('objetivoAberto');
  });
});

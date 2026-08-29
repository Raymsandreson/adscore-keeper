// A régua não pode pular estação do caminho à frente (28/08/2026): com o marco
// atual em "Alvará expedido", a linha ia direto para "Arquivamento definitivo",
// escondendo "Levantamento / pagamento" por ser eventual pendente. Eventual
// pendente só some quando ficou PARA TRÁS do marco atual.
import { describe, expect, it } from 'vitest';
import { fasesVisiveis, type MarcoDaRegua } from '@/components/cases/ReguaMarcosDoPop';

function marco(p: Partial<MarcoDaRegua> & Pick<MarcoDaRegua, 'chave' | 'ordem'>): MarcoDaRegua {
  return {
    rotulo: p.chave,
    estado: 'pendente',
    eventual: false,
    terminal: false,
    atravessaFases: false,
    data: null,
    fonte: null,
    temProvaDocumental: false,
    atual: false,
    ...p,
  };
}

// Recorte do processo real 0825565-13.2019.8.10.0001 que revelou o bug.
const regua: MarcoDaRegua[] = [
  marco({ chave: 'sentenca', ordem: 7, estado: 'presumido' }),
  marco({ chave: 'embargos_1grau', ordem: 8, eventual: true }),
  marco({ chave: 'transito_julgado', ordem: 20, estado: 'atingido', data: '2026-04-20' }),
  marco({ chave: 'liquidacao', ordem: 21, eventual: true }),
  marco({ chave: 'execucao_iniciada', ordem: 22, eventual: true, estado: 'atingido', data: '2025-09-26' }),
  marco({ chave: 'constricao', ordem: 24, eventual: true }),
  marco({ chave: 'alvara_expedido', ordem: 25, eventual: true, estado: 'atingido', data: '2024-08-15', atual: true }),
  marco({ chave: 'pagamento', ordem: 26, eventual: true }),
  marco({ chave: 'arquivamento_definitivo', ordem: 27, terminal: true }),
  marco({ chave: 'acordo_homologado', ordem: 28, atravessaFases: true, estado: 'atingido', data: '2025-09-26' }),
];

describe('fasesVisiveis', () => {
  it('mostra eventual pendente DEPOIS do marco atual — a linha não pula para o arquivamento', () => {
    const chaves = fasesVisiveis(regua).map(m => m.chave);
    expect(chaves).toEqual([
      'sentenca',
      'transito_julgado',
      'execucao_iniciada',
      'alvara_expedido',
      'pagamento',
      'arquivamento_definitivo',
    ]);
  });

  it('continua escondendo eventual pendente que ficou para trás do marco atual', () => {
    const chaves = fasesVisiveis(regua).map(m => m.chave);
    expect(chaves).not.toContain('embargos_1grau'); // recursal que nunca houve
    expect(chaves).not.toContain('liquidacao'); // ordem 21 < atual 25, não parou lá
    expect(chaves).not.toContain('constricao'); // ordem 24 < atual 25, idem
  });

  it('estado (atravessa fases) nunca entra na linha', () => {
    expect(fasesVisiveis(regua).map(m => m.chave)).not.toContain('acordo_homologado');
  });

  it('sem marco atual, eventual pendente segue oculto (comportamento antigo)', () => {
    const semAtual = regua.map(m => ({ ...m, atual: false }));
    const chaves = fasesVisiveis(semAtual).map(m => m.chave);
    expect(chaves).toEqual([
      'sentenca',
      'transito_julgado',
      'execucao_iniciada',
      'alvara_expedido',
      'arquivamento_definitivo',
    ]);
  });
});

// A régua não pode pular estação (29/08/2026, pedido do Raym: "tem que
// aparecer todos os marcos"). A primeira versão escondia eventual pendente e a
// linha ia de "Alvará expedido" direto para "Arquivamento definitivo"; a
// segunda ainda escondia eventual pendente ATRÁS do marco atual, e um processo
// arquivado sumia com toda a fase de execução. Regra final: toda fase aparece,
// sempre — só ESTADO (acordo, suspensão…) fica de fora, como badge.
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
  it('mostra TODAS as fases em ordem — pendente eventual incluído, antes e depois do marco atual', () => {
    const chaves = fasesVisiveis(regua).map(m => m.chave);
    expect(chaves).toEqual([
      'sentenca',
      'embargos_1grau',
      'transito_julgado',
      'liquidacao',
      'execucao_iniciada',
      'constricao',
      'alvara_expedido',
      'pagamento',
      'arquivamento_definitivo',
    ]);
  });

  it('estado (atravessa fases) nunca entra na linha — vira badge', () => {
    expect(fasesVisiveis(regua).map(m => m.chave)).not.toContain('acordo_homologado');
  });

  it('ordena por ordem mesmo com entrada embaralhada', () => {
    const embaralhada = [...regua].reverse();
    expect(fasesVisiveis(embaralhada).map(m => m.ordem)).toEqual([7, 8, 20, 21, 22, 24, 25, 26, 27]);
  });
});

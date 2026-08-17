import { describe, it, expect } from 'vitest';
import {
  agruparTiposPorRotulo,
  chaveCanonicaDoTipo,
  deduparTiposPorRotulo,
  expandirChavesDeTipo,
  mapaCanonicoDeTipos,
  rotuloNormalizado,
} from '../activityTypeAliases';

/** O catálogo real: seed do código primeiro, gêmeo da tabela depois. */
const CATALOGO = [
  { value: 'tarefa', label: 'Tarefa' },
  { value: 'audiencia', label: 'Audiência' },
  { value: 'prazo', label: 'Prazo' },
  { value: 'custom_1778676331097', label: 'Tarefa' },
  { value: 'custom_1778676337509', label: 'Audiência' },
  { value: 'custom_1778676343311', label: 'Prazo' },
  { value: 'custom_1784047277015', label: 'INSTRUÇÃO DE PERICIA' },
];

describe('rotuloNormalizado', () => {
  it('ignora acento, caixa e espaço sobrando', () => {
    expect(rotuloNormalizado('Audiência')).toBe('audiencia');
    expect(rotuloNormalizado('  AUDIENCIA  ')).toBe('audiencia');
    expect(rotuloNormalizado('Reunião')).toBe('reuniao');
    expect(rotuloNormalizado('Perícia  Médica')).toBe('pericia medica');
    expect(rotuloNormalizado(null)).toBe('');
  });
});

describe('agruparTiposPorRotulo', () => {
  it('junta as duas famílias de chave sob o mesmo rótulo', () => {
    const grupos = agruparTiposPorRotulo(CATALOGO);
    expect(grupos.get('prazo')).toEqual(['prazo', 'custom_1778676343311']);
    expect(grupos.get('audiencia')).toEqual(['audiencia', 'custom_1778676337509']);
    expect(grupos.get('tarefa')).toEqual(['tarefa', 'custom_1778676331097']);
  });

  it('tipo sem gêmeo fica sozinho', () => {
    expect(agruparTiposPorRotulo(CATALOGO).get('instrucao de pericia'))
      .toEqual(['custom_1784047277015']);
  });

  it('chave sem rótulo se agrupa por ela mesma, sem fundir com ninguém', () => {
    // É o fallback de tipo que só apareceu nas atividades: não dá para afirmar
    // que duas chaves cruas diferentes são a mesma coisa.
    const grupos = agruparTiposPorRotulo([
      { value: 'orfa_a', label: '' },
      { value: 'orfa_b', label: '' },
    ]);
    expect(grupos.get('orfa_a')).toEqual(['orfa_a']);
    expect(grupos.get('orfa_b')).toEqual(['orfa_b']);
  });
});

describe('deduparTiposPorRotulo', () => {
  it('deixa uma entrada por rótulo, guardando as irmãs', () => {
    const dedup = deduparTiposPorRotulo(CATALOGO);
    expect(dedup.map(t => t.label)).toEqual(['Tarefa', 'Audiência', 'Prazo', 'INSTRUÇÃO DE PERICIA']);
    expect(dedup.find(t => t.label === 'Prazo')?.aliases).toEqual(['prazo', 'custom_1778676343311']);
  });

  it('mantém a PRIMEIRA ocorrência — é a seed, que carrega a cor boa', () => {
    const dedup = deduparTiposPorRotulo(CATALOGO);
    expect(dedup.find(t => t.label === 'Tarefa')?.value).toBe('tarefa');
  });

  it('preserva os campos extras da entrada mantida', () => {
    const dedup = deduparTiposPorRotulo([
      { value: 'prazo', label: 'Prazo', header: 'bg-yellow-500' },
      { value: 'custom_1778676343311', label: 'Prazo', header: 'bg-gray-500' },
    ]);
    expect(dedup).toHaveLength(1);
    expect(dedup[0].header).toBe('bg-yellow-500');
  });
});

describe('expandirChavesDeTipo', () => {
  it('uma escolha traz as duas metades', () => {
    // É o que faz o filtro "Prazo" trazer 938 em vez de 548.
    expect(expandirChavesDeTipo(['prazo'], CATALOGO).sort())
      .toEqual(['custom_1778676343311', 'prazo']);
  });

  it('tanto faz qual das duas chaves foi salva no localStorage', () => {
    const pelaSeed = expandirChavesDeTipo(['prazo'], CATALOGO).sort();
    const pelaCustom = expandirChavesDeTipo(['custom_1778676343311'], CATALOGO).sort();
    expect(pelaCustom).toEqual(pelaSeed);
  });

  it('várias escolhas não se misturam nem se repetem', () => {
    const r = expandirChavesDeTipo(['prazo', 'audiencia'], CATALOGO);
    expect(new Set(r)).toEqual(new Set(['prazo', 'custom_1778676343311', 'audiencia', 'custom_1778676337509']));
    expect(r).toHaveLength(4);
  });

  it('chave fora do catálogo passa direto, sem sumir do filtro', () => {
    expect(expandirChavesDeTipo(['tipo_que_nao_existe'], CATALOGO)).toEqual(['tipo_que_nao_existe']);
  });

  it('nada selecionado continua nada', () => {
    expect(expandirChavesDeTipo([], CATALOGO)).toEqual([]);
  });
});

describe('chaveCanonicaDoTipo', () => {
  it('as duas chaves do par caem no mesmo bloco', () => {
    // Sem isso a visão de Blocos monta um bloco "tarefa" cinza ao lado de um
    // bloco "Tarefa" azul, no mesmo dia.
    expect(chaveCanonicaDoTipo('tarefa', CATALOGO)).toBe('tarefa');
    expect(chaveCanonicaDoTipo('custom_1778676331097', CATALOGO)).toBe('tarefa');
  });

  it('tipo sem gêmeo continua ele mesmo', () => {
    expect(chaveCanonicaDoTipo('custom_1784047277015', CATALOGO)).toBe('custom_1784047277015');
  });

  it('chave desconhecida devolve ela mesma em vez de sumir', () => {
    expect(chaveCanonicaDoTipo('notificacao', CATALOGO)).toBe('notificacao');
    expect(chaveCanonicaDoTipo(null, CATALOGO)).toBe('');
  });
});

describe('mapaCanonicoDeTipos', () => {
  it('dá a mesma resposta que chaveCanonicaDoTipo, em O(1)', () => {
    const mapa = mapaCanonicoDeTipos(CATALOGO);
    for (const t of CATALOGO) {
      expect(mapa.get(t.value)).toBe(chaveCanonicaDoTipo(t.value, CATALOGO));
    }
  });

  it('não conhece chave fora do catálogo — quem chama usa a própria', () => {
    expect(mapaCanonicoDeTipos(CATALOGO).get('notificacao')).toBeUndefined();
  });
});

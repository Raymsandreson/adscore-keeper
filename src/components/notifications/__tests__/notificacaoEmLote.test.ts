import { describe, expect, it } from 'vitest';
import { camposConsolidados, movimentacaoPrincipal } from '../notificacaoEmLote';
import type { ProcessUpdate } from '@/hooks/useProcessUpdates';

const base: ProcessUpdate = {
  id: '1',
  process_id: 'p1',
  lead_id: 'l1',
  case_id: null,
  numero_cnj: '0011351-63.2022.5.15.0031',
  processo_titulo: 'ACIDENTE DE TRABALHO',
  esfera: 'trabalhista',
  categoria: 'movimentacao',
  titulo: 'Movimentação',
  descricao: 'Juntada de petição de embargos',
  data_movimentacao: '2026-08-10',
  created_at: '2026-08-10T12:00:00Z',
  eventos: null,
  resumo_ia: null,
  vinculos: null,
};

const mov = (over: Partial<ProcessUpdate>): ProcessUpdate => ({ ...base, ...over });

describe('movimentacaoPrincipal', () => {
  it('a audiência manda na mensagem, mesmo tendo caído antes da rotina', () => {
    const principal = movimentacaoPrincipal([
      mov({ id: 'a', categoria: 'movimentacao', data_movimentacao: '2026-08-12' }),
      mov({ id: 'b', categoria: 'audiencia', data_movimentacao: '2026-08-09' }),
    ]);
    expect(principal.id).toBe('b');
  });

  it('empatada a categoria, vale a mais recente', () => {
    const principal = movimentacaoPrincipal([
      mov({ id: 'a', data_movimentacao: '2026-08-05' }),
      mov({ id: 'b', data_movimentacao: '2026-08-12' }),
    ]);
    expect(principal.id).toBe('b');
  });
});

describe('camposConsolidados', () => {
  it('uma só movimentação sai igual ao texto de sempre', () => {
    const campos = camposConsolidados([base], 'Redação da Petição');
    expect(campos.titulo).toBe('Atualização do processo — ACIDENTE DE TRABALHO');
    expect(campos.oQueFoiFeito).toContain('este foi o registro que apareceu');
    expect(campos.proximo).toContain('Redação da Petição');
  });

  it('três do mesmo cliente viram um texto só, com todos os registros', () => {
    const campos = camposConsolidados([
      mov({ id: 'a', descricao: 'Conclusos para despacho', data_movimentacao: '2026-08-08' }),
      mov({ id: 'b', categoria: 'audiencia', descricao: 'Audiência una designada', data_movimentacao: '2026-08-10' }),
      mov({ id: 'c', descricao: 'Juntada de contestação', data_movimentacao: '2026-08-12' }),
    ], null);

    // O assunto é o da audiência, não o da última linha que caiu.
    expect(campos.titulo).toContain('Audiência marcada');
    expect(campos.titulo).toContain('e mais 2 atualizações');
    // Cronológica: o cliente lê na ordem em que aconteceu.
    expect(campos.oQueFoiFeito.indexOf('Conclusos'))
      .toBeLessThan(campos.oQueFoiFeito.indexOf('Audiência una'));
    expect(campos.oQueFoiFeito).toContain('Juntada de contestação');
    // Cabeçalho uma vez só — não uma vez por registro.
    expect(campos.oQueFoiFeito.match(/estes foram os registros/g)).toHaveLength(1);
    // Próximo passo é o da audiência (preparar o cliente para a data),
    // não o "seguimos acompanhando" da movimentação de rotina.
    expect(campos.proximo).toContain('data e o horário');
    expect(campos.proximo).not.toContain('Seguimos acompanhando');
    // E a explicação da audiência entra no "como está", com a da rotina junto.
    expect(campos.comoEsta).toContain('Audiência marcada');
    expect(campos.comoEsta).toContain('3 atualizações foram registradas');
  });

  it('identifica o processo quando o cliente tem mais de um', () => {
    const campos = camposConsolidados([
      mov({ id: 'a', process_id: 'p1', processo_titulo: 'ACIDENTE DE TRABALHO' }),
      mov({ id: 'b', process_id: 'p2', processo_titulo: 'PENSÃO JUDICIAL' }),
    ], null);
    expect(campos.titulo).toContain('seus processos');
    expect(campos.oQueFoiFeito).toContain('ACIDENTE DE TRABALHO');
    expect(campos.oQueFoiFeito).toContain('PENSÃO JUDICIAL');
  });

  it('corta o excesso de registros em vez de virar parede de texto', () => {
    const oito = Array.from({ length: 8 }, (_, i) => mov({
      id: `x${i}`,
      descricao: `Registro numero ${i}`,
      data_movimentacao: `2026-08-0${i + 1}`,
    }));
    const campos = camposConsolidados(oito, null);
    expect(campos.oQueFoiFeito).toContain('mais 2 registros de rotina');
    // Os mais recentes são os que ficam.
    expect(campos.oQueFoiFeito).toContain('Registro numero 7');
    expect(campos.oQueFoiFeito).not.toContain('Registro numero 0');
  });

  it('glossário aparece uma vez, sem repetir termo', () => {
    const campos = camposConsolidados([
      mov({ id: 'a', descricao: 'Conclusos os autos ao juiz' }),
      mov({ id: 'b', descricao: 'Autos conclusos novamente' }),
    ], null);
    expect(campos.oQueFoiFeito.match(/Explicando os termos/g)).toHaveLength(1);
    expect(campos.oQueFoiFeito.match(/\*conclusos\*/g)).toHaveLength(1);
  });

  it('registro sem detalhe do tribunal não sai como aspas vazias', () => {
    const campos = camposConsolidados([
      mov({ id: 'a', descricao: null }),
      mov({ id: 'b', descricao: 'Juntada de petição' }),
    ], null);
    expect(campos.oQueFoiFeito).toContain('não detalhou este registro');
    expect(campos.oQueFoiFeito).not.toContain('_""_');
  });
});

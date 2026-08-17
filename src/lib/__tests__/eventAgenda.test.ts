import { describe, it, expect } from 'vitest';
import {
  atividadeMaisProxima,
  categoriaDaAudiencia,
  ehAtividadeDePrazo,
  contarPorCategoria,
  diaAnterior,
  diaSeguinte,
  horaCurta,
  montarEventosDaJanela,
  janelaDaVespera,
  ehFimDeSemana,
  type AtividadeLite,
  type AudienciaLite,
} from '../eventAgenda';

const audiencia = (over: Partial<AudienciaLite> = {}): AudienciaLite => ({
  id: 'h1',
  hearing_date: '2026-08-18',
  hearing_time: '14:00:00',
  hearing_type: 'Instrução',
  status: 'ativa',
  process_number: '0000242-25.2026.5.09.0663',
  lead_id: null,
  location: null,
  ...over,
});

const atividade = (over: Partial<AtividadeLite> = {}): AtividadeLite => ({
  id: 'a1',
  title: 'Preparar minuta',
  activity_type: 'prazo',
  deadline: '2026-08-18',
  priority: 'alta',
  status: 'pendente',
  lead_id: 'lead-1',
  lead_name: 'João da Silva',
  process_id: 'proc-1',
  process_title: '1001234-56',
  assigned_to_name: 'Maria',
  ...over,
});

describe('categoriaDaAudiencia', () => {
  it('separa perícia de audiência dentro da mesma tabela', () => {
    // As três grafias existem no banco (69 + 3 + 1 linhas em 17/08/2026).
    expect(categoriaDaAudiencia('Perícia Médica')).toBe('pericia');
    expect(categoriaDaAudiencia('Pericia')).toBe('pericia');
    expect(categoriaDaAudiencia('Perícia Judicial')).toBe('pericia');
  });

  it('todo o resto do catálogo real é audiência', () => {
    for (const t of ['Instrução', 'Inicial', 'UNA', 'Conciliação', 'Encerramento de Instrução', 'Homologação', 'Julgamento']) {
      expect(categoriaDaAudiencia(t)).toBe('audiencia');
    }
  });

  it('sem tipo, ou tipo "Outro", cai em Outros', () => {
    expect(categoriaDaAudiencia(null)).toBe('outros');
    expect(categoriaDaAudiencia('')).toBe('outros');
    expect(categoriaDaAudiencia('Outro')).toBe('outros');
  });
});

describe('ehAtividadeDePrazo', () => {
  it('casa a chave seed que não tem linha em activity_types', () => {
    // 85,6% das pendentes usam chave órfã; casar só pela tabela perderia elas.
    expect(ehAtividadeDePrazo('prazo', null)).toBe(true);
  });

  it('casa pelo rótulo quando a chave é custom_*', () => {
    expect(ehAtividadeDePrazo('custom_1778676343311', 'Prazo')).toBe(true);
  });

  it('audiência e perícia NÃO viram linha de atividade', () => {
    // Elas saem só de `hearings`. Incluí-las duplicava o evento (3 audiências
    // viravam 7 linhas em 18/08/2026) e datava errado: o deadline da atividade
    // é quando preparar, não quando o evento acontece.
    expect(ehAtividadeDePrazo('audiencia', null)).toBe(false);
    expect(ehAtividadeDePrazo('custom_1778676337509', 'Audiência')).toBe(false);
    expect(ehAtividadeDePrazo('custom_1785200000002', 'Perícia Médica')).toBe(false);
  });

  it('NÃO cai nos tipos-frase que poluem a tabela', () => {
    // Alguém digitou a descrição no campo do nome do tipo. Casar por substring
    // jogaria essas atividades na aba de prazo como se fossem prazo real.
    expect(ehAtividadeDePrazo('custom_1779888284474', 'atividade para se manifestar no processo com prazo aberto, as vezes ir atrás de algum documento.')).toBe(false);
  });

  it('tipo comum não é evento', () => {
    expect(ehAtividadeDePrazo('tarefa', 'Tarefa')).toBe(false);
    expect(ehAtividadeDePrazo(null, null)).toBe(false);
  });
});

describe('diaSeguinte / diaAnterior', () => {
  it('anda um dia sem escorregar de fuso', () => {
    expect(diaSeguinte('2026-08-11')).toBe('2026-08-12');
    expect(diaAnterior('2026-08-12')).toBe('2026-08-11');
  });

  it('vira o mês e o ano', () => {
    expect(diaSeguinte('2026-08-31')).toBe('2026-09-01');
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01');
    expect(diaAnterior('2026-01-01')).toBe('2025-12-31');
  });

  it('atravessa 29 de fevereiro de ano bissexto', () => {
    expect(diaSeguinte('2028-02-28')).toBe('2028-02-29');
    expect(diaSeguinte('2028-02-29')).toBe('2028-03-01');
  });

  it('aceita datetime e usa só a data', () => {
    expect(diaSeguinte('2026-08-11T23:30:00-03:00')).toBe('2026-08-12');
  });
});

describe('horaCurta', () => {
  it('corta os segundos e recusa lixo', () => {
    expect(horaCurta('14:00:00')).toBe('14:00');
    expect(horaCurta('09:30')).toBe('09:30');
    expect(horaCurta(null)).toBeNull();
    expect(horaCurta('')).toBeNull();
  });
});

describe('atividadeMaisProxima', () => {
  it('pega a de prazo mais perto do evento', () => {
    const escolhida = atividadeMaisProxima([
      atividade({ id: 'longe', deadline: '2026-09-30' }),
      atividade({ id: 'perto', deadline: '2026-08-19' }),
    ], '2026-08-18');
    expect(escolhida?.id).toBe('perto');
  });

  it('ignora concluída', () => {
    const escolhida = atividadeMaisProxima([
      atividade({ id: 'concl', deadline: '2026-08-18', status: 'concluida' }),
      atividade({ id: 'viva', deadline: '2026-09-30' }),
    ], '2026-08-18');
    expect(escolhida?.id).toBe('viva');
  });

  it('sem candidata viva devolve null em vez de inventar vínculo', () => {
    expect(atividadeMaisProxima([], '2026-08-18')).toBeNull();
    expect(atividadeMaisProxima([atividade({ status: 'concluida' })], '2026-08-18')).toBeNull();
  });

  it('atividade sem prazo perde para quem tem prazo', () => {
    const escolhida = atividadeMaisProxima([
      atividade({ id: 'sem-prazo', deadline: null }),
      atividade({ id: 'com-prazo', deadline: '2027-01-01' }),
    ], '2026-08-18');
    expect(escolhida?.id).toBe('com-prazo');
  });
});

describe('montarEventosDaJanela', () => {
  const base = {
    dias: ['2026-08-18'],
    rotuloDoTipo: new Map([['custom_1778676343311', 'Prazo']]),
    processoPorNumero: new Map([[
      '0000242-25.2026.5.09.0663',
      { process_id: 'proc-1', process_number: '0000242-25.2026.5.09.0663', lead_id: 'lead-1', lead_name: 'João da Silva' },
    ]]),
    atividadesPorProcesso: new Map([['proc-1', [atividade({ id: 'ligada', title: 'Preparar documentos' })]]]),
  };

  it('resolve o cliente da audiência pelo número do processo', () => {
    // Só 10 das 70 audiências futuras têm lead_id; 53 de 59 casam por número.
    const [linha] = montarEventosDaJanela({ ...base, audiencias: [audiencia()], atividades: [] });
    expect(linha.cliente).toBe('João da Silva');
    expect(linha.categoria).toBe('audiencia');
    expect(linha.horaEvento).toBe('14:00');
    expect(linha.atividade).toBe('Preparar documentos');
  });

  it('audiência de processo desconhecido não inventa cliente', () => {
    const [linha] = montarEventosDaJanela({
      ...base,
      audiencias: [audiencia({ process_number: '9999999-99.2026.5.09.0663' })],
      atividades: [],
    });
    expect(linha.cliente).toBeNull();
    expect(linha.atividade).toBeNull();
  });

  it('marca a situação só quando a audiência não está ativa', () => {
    const [ativa] = montarEventosDaJanela({ ...base, audiencias: [audiencia()], atividades: [] });
    expect(ativa.situacao).toBeNull();
    const [cancelada] = montarEventosDaJanela({ ...base, audiencias: [audiencia({ status: 'cancelada' })], atividades: [] });
    expect(cancelada.situacao).toBe('cancelada');
  });

  it('prazo entra como linha própria e sem hora', () => {
    const [linha] = montarEventosDaJanela({
      ...base,
      audiencias: [],
      atividades: [atividade({ activity_type: 'custom_1778676343311' })],
    });
    expect(linha.categoria).toBe('prazo');
    expect(linha.evento).toBe('Prazo');
    expect(linha.horaEvento).toBeNull(); // deadline é DATE
    expect(linha.prioridade).toBe('alta');
  });

  it('atividade que não é de tipo-evento fica de fora', () => {
    const linhas = montarEventosDaJanela({
      ...base,
      audiencias: [],
      atividades: [atividade({ activity_type: 'tarefa' })],
    });
    expect(linhas).toHaveLength(0);
  });

  it('atividade de audiência não duplica o evento que já veio da hearings', () => {
    // Regressão medida em 18/08/2026: HearingActivityDialog cria uma atividade
    // a partir da audiência, então o mesmo evento vinha duas vezes.
    const linhas = montarEventosDaJanela({
      ...base,
      audiencias: [audiencia()],
      atividades: [atividade({ id: 'gerada', activity_type: 'audiencia', title: 'Audiência Instrução 18/08/2026' })],
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].origem).toBe('audiencia');
    expect(linhas[0].horaEvento).toBe('14:00');
  });

  it('descarta o que não é do dia pedido', () => {
    const linhas = montarEventosDaJanela({
      ...base,
      audiencias: [audiencia({ hearing_date: '2026-08-19' })],
      atividades: [atividade({ deadline: '2026-08-19' })],
    });
    expect(linhas).toHaveLength(0);
  });

  it('ordena por hora e joga o sem-hora para o fim', () => {
    const linhas = montarEventosDaJanela({
      ...base,
      audiencias: [
        audiencia({ id: 'tarde', hearing_time: '16:00:00' }),
        audiencia({ id: 'manha', hearing_time: '09:00:00' }),
      ],
      atividades: [atividade({ activity_type: 'prazo' })],
    });
    expect(linhas.map(l => l.horaEvento)).toEqual(['09:00', '16:00', null]);
  });
});

describe('contarPorCategoria', () => {
  it('conta cada aba, inclusive as vazias', () => {
    const eventos = montarEventosDaJanela({
      dias: ['2026-08-18'],
      rotuloDoTipo: new Map(),
      processoPorNumero: new Map(),
      atividadesPorProcesso: new Map(),
      audiencias: [audiencia(), audiencia({ id: 'h2', hearing_type: 'Perícia Médica' })],
      atividades: [atividade({ activity_type: 'prazo' })],
    });
    expect(contarPorCategoria(eventos)).toEqual({ audiencia: 1, pericia: 1, prazo: 1, outros: 0 });
  });
});

describe('janelaDaVespera', () => {
  it('de segunda a quinta prepara um dia só', () => {
    // 17/08/2026 é segunda.
    expect(janelaDaVespera('2026-08-17')).toEqual(['2026-08-18']);
    expect(janelaDaVespera('2026-08-19')).toEqual(['2026-08-20']); // qua → qui
  });

  it('na sexta cobre sábado, domingo E segunda', () => {
    // 21/08/2026 é sexta. Sem isso a segunda nunca teria véspera.
    expect(janelaDaVespera('2026-08-21')).toEqual(['2026-08-22', '2026-08-23', '2026-08-24']);
  });

  it('no sábado cobre domingo e segunda', () => {
    expect(janelaDaVespera('2026-08-22')).toEqual(['2026-08-23', '2026-08-24']);
  });

  it('no domingo já é a segunda', () => {
    expect(janelaDaVespera('2026-08-23')).toEqual(['2026-08-24']);
  });

  it('a janela sempre termina em dia útil e não pula nada no meio', () => {
    for (const v of ['2026-08-17', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']) {
      const j = janelaDaVespera(v);
      expect(ehFimDeSemana(j[j.length - 1])).toBe(false);
      expect(j[0]).toBe(diaSeguinte(v));
      // dias consecutivos, sem buraco
      for (let i = 1; i < j.length; i++) expect(j[i]).toBe(diaSeguinte(j[i - 1]));
    }
  });

  it('atravessa a virada de mês', () => {
    // 31/07/2026 é sexta.
    expect(janelaDaVespera('2026-07-31')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });
});

describe('montarEventosDaJanela — janela de vários dias', () => {
  it('traz o prazo que vence no sábado, em vez de escondê-lo', () => {
    // 3 dos 81 prazos vivos vencem em fim de semana. Pular o sábado faria eles
    // nunca aparecerem em tela nenhuma.
    const linhas = montarEventosDaJanela({
      dias: ['2026-08-22', '2026-08-23', '2026-08-24'],
      rotuloDoTipo: new Map(),
      processoPorNumero: new Map(),
      atividadesPorProcesso: new Map(),
      audiencias: [],
      atividades: [atividade({ id: 'sabado', activity_type: 'prazo', deadline: '2026-08-22' })],
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].dataEvento).toBe('2026-08-22');
  });

  it('cada linha guarda o SEU dia, não o primeiro da janela', () => {
    const linhas = montarEventosDaJanela({
      dias: ['2026-08-22', '2026-08-23', '2026-08-24'],
      rotuloDoTipo: new Map(),
      processoPorNumero: new Map(),
      atividadesPorProcesso: new Map(),
      audiencias: [audiencia({ id: 'seg', hearing_date: '2026-08-24', hearing_time: '09:00:00' })],
      atividades: [atividade({ id: 'sab', activity_type: 'prazo', deadline: '2026-08-22' })],
    });
    expect(linhas.map(l => l.dataEvento)).toEqual(['2026-08-22', '2026-08-24']);
  });

  it('ordena por dia antes de ordenar por hora', () => {
    const linhas = montarEventosDaJanela({
      dias: ['2026-08-22', '2026-08-23', '2026-08-24'],
      rotuloDoTipo: new Map(),
      processoPorNumero: new Map(),
      atividadesPorProcesso: new Map(),
      audiencias: [
        audiencia({ id: 'seg-cedo', hearing_date: '2026-08-24', hearing_time: '08:00:00' }),
        audiencia({ id: 'sab-tarde', hearing_date: '2026-08-22', hearing_time: '17:00:00' }),
      ],
      atividades: [],
    });
    // O sábado às 17h vem antes da segunda às 8h: dia manda.
    expect(linhas.map(l => l.chave)).toEqual(['audiencia:sab-tarde', 'audiencia:seg-cedo']);
  });

  it('descarta o que está fora da janela', () => {
    const linhas = montarEventosDaJanela({
      dias: ['2026-08-24'],
      rotuloDoTipo: new Map(),
      processoPorNumero: new Map(),
      atividadesPorProcesso: new Map(),
      audiencias: [audiencia({ hearing_date: '2026-08-25' })],
      atividades: [atividade({ activity_type: 'prazo', deadline: '2026-08-22' })],
    });
    expect(linhas).toHaveLength(0);
  });
});

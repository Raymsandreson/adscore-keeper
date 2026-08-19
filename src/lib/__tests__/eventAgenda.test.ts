import { describe, it, expect } from 'vitest';
import {
  aplicarFiltrosDeEvento,
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
  diasDoIntervalo,
  nomeDoCliente,
  responsaveisDe,
  sequenciaDoEvento,
  type AtividadeLite,
  type AudienciaLite,
  type EventoAgenda,
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
  case_ref: null,
  category: null,
  assigned_user_id: null,
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
  case_id: null,
  case_title: null,
  assigned_to: 'u-maria',
  assigned_to_ids: null,
  assigned_to_names: null,
  ...over,
});

describe('categoriaDaAudiencia', () => {
  it('separa perícia de audiência dentro da mesma tabela', () => {
    // As três grafias existem no banco (69 + 3 + 1 linhas em 17/08/2026).
    expect(categoriaDaAudiencia('Perícia Médica')).toBe('pericia');
    expect(categoriaDaAudiencia('Pericia')).toBe('pericia');
    expect(categoriaDaAudiencia('Perícia Judicial')).toBe('pericia');
  });

  it('avaliação social é perícia, não "outros"', () => {
    // A perícia social do BPC não tem o radical "peric". Sem regra própria ela
    // cairia na aba Outros — onde ninguém procura convocação de cliente.
    expect(categoriaDaAudiencia('Avaliação Social (INSS)')).toBe('pericia');
    expect(categoriaDaAudiencia('avaliacao social')).toBe('pericia');
  });

  it('os tipos que a atividade grava caem na aba de perícia', () => {
    // Gravados pelo chip do cabeçalho da atividade (migration 20260819110000).
    expect(categoriaDaAudiencia('Perícia Médica (INSS)')).toBe('pericia');
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

// =============================================================================
// Identificação da linha e filtros — ago/2026.
//
// Todos os textos abaixo são de linhas reais do Externo em 19-20/08/2026: o
// problema relatado era "muitos não têm processo nem cliente, fica difícil saber
// de qual se refere".
// =============================================================================

describe('nomeDoCliente', () => {
  it('tira selo, código do caso e separador do nome do grupo', () => {
    expect(nomeDoCliente('✅PREV 704 | ADRIANA CARVALHO')).toBe('ADRIANA CARVALHO');
    expect(nomeDoCliente('✅ Caso 341 Walter x Construtora')).toBe('Walter x Construtora');
    expect(nomeDoCliente('FAMÍLIA 249 - Maicon')).toBe('Maicon');
    expect(nomeDoCliente('CASO 146 SÓ CRISTIAN')).toBe('SÓ CRISTIAN');
  });

  it('para no primeiro pipe: o resto do título do grupo não é o cliente', () => {
    expect(nomeDoCliente('✅ CASO 395 | (ANA82)/abr.26 | São José dos Pinhais/PR'))
      .toBe('(ANA82)/abr.26');
  });

  it('devolve o texto original quando o corte não deixa nome', () => {
    // Grupo que é só o código: cortar tudo deixaria a coluna vazia, que é
    // justamente o defeito que esta função existe para corrigir.
    expect(nomeDoCliente('PREV 2043')).toBe('PREV 2043');
    expect(nomeDoCliente('✅PREV 1015 | ')).toBe('✅PREV 1015 |');
  });

  it('vazio continua vazio', () => {
    expect(nomeDoCliente(null)).toBeNull();
    expect(nomeDoCliente('   ')).toBeNull();
  });
});

describe('sequenciaDoEvento', () => {
  it('prefere a fonte que tem prefixo de funil', () => {
    // "FAMÍLIA 249" sozinho viraria "nº 249"; o case_title diz que é CASO 249.
    const seq = sequenciaDoEvento('CASO 249 - FAMÍLIA 249 - Maicon', 'FAMÍLIA 249 - Maicon');
    expect(seq?.familia).toBe('CASO');
    expect(seq?.numero).toBe(249);
  });

  it('cai para a próxima fonte quando a primeira não tem sequência', () => {
    const seq = sequenciaDoEvento(null, '✅PREV 704 | ADRIANA');
    expect(seq?.familia).toBe('PREV');
    expect(seq?.numero).toBe(704);
  });

  it('ignora número CNJ — não é sequência de caso', () => {
    expect(sequenciaDoEvento('0010115-70.2026.5.03.0031')).toBeNull();
  });

  it('guarda o número sem prefixo, mas só se ninguém disser a família', () => {
    expect(sequenciaDoEvento('249')?.familia).toBe('NUM');
    expect(sequenciaDoEvento('249', 'PREV 249')?.familia).toBe('PREV');
  });
});

describe('responsaveisDe', () => {
  it('junta titular e co-responsáveis de todas as atividades do processo', () => {
    const r = responsaveisDe([
      atividade({ id: 'a1', assigned_to: 'u1', assigned_to_name: 'Gisele' }),
      atividade({ id: 'a2', assigned_to: 'u2', assigned_to_name: 'João Pedro',
        assigned_to_ids: ['u3'], assigned_to_names: ['Ana'] }),
    ], null);
    expect(r.ids.sort()).toEqual(['u1', 'u2', 'u3']);
    expect(r.nomes.sort()).toEqual(['Ana', 'Gisele', 'João Pedro']);
  });

  it('sem atividade nenhuma, o dono é só quem a audiência aponta (quando aponta)', () => {
    expect(responsaveisDe([], 'u9').ids).toEqual(['u9']);
    expect(responsaveisDe([], null).ids).toEqual([]);
  });
});

describe('diasDoIntervalo', () => {
  it('inclui as duas pontas', () => {
    expect(diasDoIntervalo('2026-08-19', '2026-08-22'))
      .toEqual(['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']);
  });

  it('aceita as pontas trocadas', () => {
    expect(diasDoIntervalo('2026-08-22', '2026-08-19').length).toBe(4);
  });

  it('atravessa a virada do mês', () => {
    expect(diasDoIntervalo('2026-08-30', '2026-09-02'))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('tem teto: data digitada errada não vira varredura de anos', () => {
    expect(diasDoIntervalo('2026-01-01', '2030-01-01').length).toBe(92);
  });
});

const evento = (over: Partial<EventoAgenda> = {}): EventoAgenda => ({
  chave: 'audiencia:h1',
  categoria: 'audiencia',
  origem: 'audiencia',
  processo: '0000242-25.2026.5.09.0663',
  cliente: 'Walter',
  clienteBruto: '✅ Caso 341 Walter',
  casoBadge: 'CASO 341',
  familia: 'CASO',
  area: 'trabalhista',
  responsaveisIds: ['u1'],
  responsaveisNomes: ['Gisele'],
  semResponsavel: false,
  caseId: 'case-1',
  leadId: 'lead-1',
  evento: 'Instrução',
  dataEvento: '2026-08-20',
  horaEvento: '08:45',
  situacao: null,
  local: null,
  atividadeId: 'a1',
  atividade: 'Preparar minuta',
  prioridade: 'alta',
  responsavel: 'Gisele',
  ...over,
});

describe('aplicarFiltrosDeEvento', () => {
  it('assessor filtra por qualquer responsável do processo, não só o principal', () => {
    const lista = [
      evento({ chave: 'e1', responsaveisIds: ['u1', 'u2'] }),
      evento({ chave: 'e2', responsaveisIds: ['u3'] }),
    ];
    expect(aplicarFiltrosDeEvento(lista, { assessores: ['u2'] }).map(e => e.chave)).toEqual(['e1']);
  });

  it('EVENTO SEM DONO continua visível mesmo com filtro de assessor', () => {
    // Regra deliberada: `hearings.assigned_user_id` estava em 6 de 74 futuras
    // (19/08/2026). Esconder o órfão faria a audiência de amanhã desaparecer da
    // tela de todo mundo, que é o oposto do que a agenda serve.
    const lista = [
      evento({ chave: 'meu', responsaveisIds: ['u1'] }),
      evento({ chave: 'orfao', responsaveisIds: [], semResponsavel: true }),
      evento({ chave: 'de-outro', responsaveisIds: ['u9'] }),
    ];
    expect(aplicarFiltrosDeEvento(lista, { assessores: ['u1'] }).map(e => e.chave))
      .toEqual(['meu', 'orfao']);
  });

  it('Caso/Prev filtra pela família da sequência', () => {
    const lista = [
      evento({ chave: 'prev', familia: 'PREV' }),
      evento({ chave: 'caso', familia: 'CASO' }),
      evento({ chave: 'sem', familia: null }),
    ];
    expect(aplicarFiltrosDeEvento(lista, { familias: ['PREV'] }).map(e => e.chave)).toEqual(['prev']);
  });

  it('área não varre prazo: atividade não tem área para comparar', () => {
    const lista = [
      evento({ chave: 'aud', area: 'trabalhista' }),
      evento({ chave: 'aud2', area: 'previdenciario' }),
      evento({ chave: 'prazo', categoria: 'prazo', origem: 'atividade', area: null }),
    ];
    expect(aplicarFiltrosDeEvento(lista, { areas: ['trabalhista'] }).map(e => e.chave))
      .toEqual(['aud', 'prazo']);
  });

  it('busca alcança badge, cliente e atividade, sem acento atrapalhar', () => {
    const lista = [
      evento({ chave: 'e1', casoBadge: 'PREV 704', cliente: 'ADRIANA' }),
      evento({ chave: 'e2', casoBadge: 'CASO 341', cliente: 'Walter', atividade: 'Perícia médica' }),
    ];
    expect(aplicarFiltrosDeEvento(lista, { busca: 'prev 704' }).map(e => e.chave)).toEqual(['e1']);
    expect(aplicarFiltrosDeEvento(lista, { busca: 'pericia' }).map(e => e.chave)).toEqual(['e2']);
  });

  it('sem filtro, devolve tudo', () => {
    const lista = [evento({ chave: 'e1' }), evento({ chave: 'e2' })];
    expect(aplicarFiltrosDeEvento(lista, {})).toHaveLength(2);
  });
});

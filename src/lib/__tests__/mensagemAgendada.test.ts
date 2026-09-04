import { describe, it, expect } from 'vitest';
import {
  descreverAgendamento,
  faltaPara,
  listarProximosEnvios,
  proximoEnvio,
  validarAgendamento,
  REGRA_PADRAO,
  type RegraDeRepeticao,
} from '@/lib/mensagemAgendada';

const regra = (p: Partial<RegraDeRepeticao>): RegraDeRepeticao => ({ ...REGRA_PADRAO, ...p });

// 25/08/2026 é uma terça-feira.
const AGORA = new Date(2026, 7, 25, 9, 0, 0);

describe('proximoEnvio', () => {
  it('sem repetição não tem próximo', () => {
    const quando = new Date(2026, 7, 26, 8, 0);
    expect(proximoEnvio(quando, regra({ repeticao: 'nenhuma' }), AGORA)).toBeNull();
  });

  it('diária mantém a hora', () => {
    const p = proximoEnvio(new Date(2026, 7, 26, 8, 30), regra({ repeticao: 'diaria' }), AGORA);
    expect(p).toEqual(new Date(2026, 7, 27, 8, 30));
  });

  it('semanal sem dia escolhido cai no mesmo dia da semana', () => {
    const p = proximoEnvio(new Date(2026, 7, 26, 8, 0), regra({ repeticao: 'semanal' }), AGORA);
    expect(p).toEqual(new Date(2026, 8, 2, 8, 0));
  });

  it('semanal com dias escolhidos vai para o próximo dia marcado', () => {
    // Quarta 26/08, marcado segunda (1) e quinta (4) → quinta 27/08.
    const p = proximoEnvio(
      new Date(2026, 7, 26, 8, 0),
      regra({ repeticao: 'semanal', diasDaSemana: [1, 4] }),
      AGORA,
    );
    expect(p).toEqual(new Date(2026, 7, 27, 8, 0));
  });

  it('mensal encurta o dia em mês curto, igual ao Postgres', () => {
    const p = proximoEnvio(new Date(2026, 0, 31, 8, 0), regra({ repeticao: 'mensal' }), new Date(2026, 0, 1));
    expect(p).toEqual(new Date(2026, 1, 28, 8, 0));
  });

  it('personalizada anda de N em N', () => {
    const p = proximoEnvio(
      new Date(2026, 7, 26, 8, 0),
      regra({ repeticao: 'personalizada', intervalo: 3, unidade: 'semanas' }),
      AGORA,
    );
    expect(p).toEqual(new Date(2026, 8, 16, 8, 0));
  });

  it('disparo atrasado pula o que ficou para trás em vez de acumular', () => {
    // Diária que devia ter saído em 01/08; hoje é 25/08 → volta com 26/08, não 02/08.
    const p = proximoEnvio(new Date(2026, 7, 1, 8, 0), regra({ repeticao: 'diaria' }), AGORA);
    expect(p).toEqual(new Date(2026, 7, 26, 8, 0));
  });

  it('para quando passa da data-limite', () => {
    const p = proximoEnvio(
      new Date(2026, 7, 26, 8, 0),
      regra({ repeticao: 'diaria', repetirAte: new Date(2026, 7, 26) }),
      AGORA,
    );
    expect(p).toBeNull();
  });

  it('a data-limite vale o dia inteiro', () => {
    const p = proximoEnvio(
      new Date(2026, 7, 26, 8, 0),
      regra({ repeticao: 'diaria', repetirAte: new Date(2026, 7, 27) }),
      AGORA,
    );
    expect(p).toEqual(new Date(2026, 7, 27, 8, 0));
  });

  it('para quando bate o número de envios', () => {
    const r = regra({ repeticao: 'diaria', maxEnvios: 3 });
    expect(proximoEnvio(new Date(2026, 7, 26, 8, 0), r, AGORA, 2)).toEqual(new Date(2026, 7, 27, 8, 0));
    expect(proximoEnvio(new Date(2026, 7, 27, 8, 0), r, AGORA, 3)).toBeNull();
  });
});

describe('listarProximosEnvios', () => {
  it('mostra a sequência que a pessoa vai ver na tela', () => {
    const lista = listarProximosEnvios(
      new Date(2026, 7, 26, 8, 0),
      regra({ repeticao: 'semanal', diasDaSemana: [1, 4] }),
      AGORA,
      4,
    );
    expect(lista).toEqual([
      new Date(2026, 7, 26, 8, 0),
      new Date(2026, 7, 27, 8, 0),
      new Date(2026, 7, 31, 8, 0),
      new Date(2026, 8, 3, 8, 0),
    ]);
  });

  it('sem repetição a lista tem só o envio único', () => {
    const lista = listarProximosEnvios(new Date(2026, 7, 26, 8, 0), REGRA_PADRAO, AGORA);
    expect(lista).toHaveLength(1);
  });

  it('o limite de envios corta a lista', () => {
    const lista = listarProximosEnvios(
      new Date(2026, 7, 26, 8, 0),
      regra({ repeticao: 'diaria', maxEnvios: 2 }),
      AGORA,
      5,
    );
    expect(lista).toHaveLength(2);
  });
});

describe('descreverAgendamento', () => {
  const quando = new Date(2026, 7, 26, 8, 0);

  it('envio único diz a data', () => {
    expect(descreverAgendamento(quando, REGRA_PADRAO)).toBe('26 de agosto às 08:00');
  });

  it('diária', () => {
    expect(descreverAgendamento(quando, regra({ repeticao: 'diaria' }))).toBe('Todo dia às 08:00');
  });

  it('semanal lista os dias', () => {
    expect(descreverAgendamento(quando, regra({ repeticao: 'semanal', diasDaSemana: [1, 4] })))
      .toBe('Toda segunda e quinta às 08:00');
  });

  it('mensal diz o dia do mês', () => {
    expect(descreverAgendamento(quando, regra({ repeticao: 'mensal' }))).toBe('Todo dia 26 às 08:00');
  });

  it('personalizada diz o intervalo', () => {
    expect(descreverAgendamento(quando, regra({ repeticao: 'personalizada', intervalo: 3, unidade: 'dias' })))
      .toBe('A cada 3 dias às 08:00');
  });

  it('mostra o limite quando existe', () => {
    expect(descreverAgendamento(quando, regra({ repeticao: 'diaria', maxEnvios: 5 })))
      .toBe('Todo dia às 08:00, 5 vezes');
    expect(descreverAgendamento(quando, regra({ repeticao: 'diaria', repetirAte: new Date(2026, 8, 30) })))
      .toBe('Todo dia às 08:00, até 30/09/2026');
  });
});

describe('validarAgendamento', () => {
  const futuro = new Date(2026, 7, 26, 8, 0);

  it('aceita o caso normal', () => {
    expect(validarAgendamento('bom dia', futuro, REGRA_PADRAO, AGORA)).toBeNull();
  });

  it('não agenda mensagem vazia', () => {
    expect(validarAgendamento('   ', futuro, REGRA_PADRAO, AGORA)).toMatch(/Escreva a mensagem/);
  });

  it('não agenda para trás', () => {
    expect(validarAgendamento('oi', new Date(2026, 7, 24, 8, 0), REGRA_PADRAO, AGORA)).toMatch(/já passou/);
  });

  it('recusa intervalo fora da faixa', () => {
    const r = regra({ repeticao: 'personalizada', intervalo: 0 });
    expect(validarAgendamento('oi', futuro, r, AGORA)).toMatch(/intervalo/);
  });

  it('recusa limite antes do primeiro envio', () => {
    const r = regra({ repeticao: 'diaria', repetirAte: new Date(2026, 7, 25) });
    expect(validarAgendamento('oi', futuro, r, AGORA)).toMatch(/anterior ao primeiro envio/);
  });
});

describe('faltaPara — quanto tempo ainda dá para cancelar', () => {
  const agora = new Date('2026-09-04T15:00:00');

  it('conta em segundos no último minuto, que é quando a pessoa precisa decidir rápido', () => {
    expect(faltaPara(new Date('2026-09-04T15:00:42'), agora)).toBe('42s');
  });

  it('vira relógio minuto:segundo na janela de 5 minutos do atendente virtual', () => {
    expect(faltaPara(new Date('2026-09-04T15:04:32'), agora)).toBe('4:32');
    expect(faltaPara(new Date('2026-09-04T15:05:00'), agora)).toBe('5:00');
  });

  it('encurta para horas e dias quando o agendamento é longe', () => {
    expect(faltaPara(new Date('2026-09-04T17:30:00'), agora)).toBe('2h30');
    expect(faltaPara(new Date('2026-09-07T03:00:00'), agora)).toBe('2d12h');
  });

  it('devolve null depois da hora — quem manda aí é o disparo, não a contagem', () => {
    expect(faltaPara(new Date('2026-09-04T15:00:00'), agora)).toBeNull();
    expect(faltaPara(new Date('2026-09-04T14:59:00'), agora)).toBeNull();
  });

  it('não quebra com data inválida vinda do banco', () => {
    expect(faltaPara('nao-e-data', agora)).toBeNull();
  });
});

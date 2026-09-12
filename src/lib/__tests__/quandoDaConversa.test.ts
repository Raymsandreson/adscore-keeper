/**
 * O leitor de data da conversa.
 *
 * O caso que originou isto: o médico manda áudio "Tu pode mandar mensagem pra
 * mim na segunda, aí eu dou uma olhada na agenda". A janela de agendar tem que
 * abrir já marcada na segunda — sem ninguém reler a conversa e contar os dias.
 */
import { describe, it, expect } from 'vitest';
import { lerQuandoDaFala, lerQuandoDaConversa, HORA_PADRAO } from '../quandoDaConversa';

// Quinta-feira, 10/09/2026, 10h — base fixa para o teste não depender do dia.
const QUINTA_10H = new Date(2026, 8, 10, 10, 0, 0, 0);

describe('lerQuandoDaFala', () => {
  it('lê o dia da semana e usa a hora padrão', () => {
    const r = lerQuandoDaFala('Tu pode mandar mensagem pra mim na segunda', QUINTA_10H);
    expect(r?.quando).toEqual(new Date(2026, 8, 14, HORA_PADRAO, 0));
    expect(r?.rotulo).toBe('segunda-feira');
    expect(r?.horaExplicita).toBe(false);
  });

  it('dia da semana igual ao de hoje cai na semana que vem', () => {
    const r = lerQuandoDaFala('me chama na quinta', QUINTA_10H);
    expect(r?.quando).toEqual(new Date(2026, 8, 17, HORA_PADRAO, 0));
  });

  it('junta o dia com a hora dita na mesma fala', () => {
    const r = lerQuandoDaFala('me liga sexta às 14h30', QUINTA_10H);
    expect(r?.quando).toEqual(new Date(2026, 8, 11, 14, 30));
    expect(r?.horaExplicita).toBe(true);
  });

  it('amanhã e depois de amanhã não se confundem', () => {
    expect(lerQuandoDaFala('me manda amanhã', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 11, HORA_PADRAO, 0));
    expect(lerQuandoDaFala('fala comigo depois de amanhã', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 12, HORA_PADRAO, 0));
  });

  it('entende "semana que vem" como a segunda seguinte', () => {
    const r = lerQuandoDaFala('semana que vem a gente resolve', QUINTA_10H);
    expect(r?.quando).toEqual(new Date(2026, 8, 14, HORA_PADRAO, 0));
  });

  it('conta prazo em dias e em semanas', () => {
    expect(lerQuandoDaFala('me retorna daqui a 3 dias', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 13, HORA_PADRAO, 0));
    expect(lerQuandoDaFala('em 2 semanas eu te falo', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 24, HORA_PADRAO, 0));
  });

  it('lê data curta e joga para o ano que vem quando já passou', () => {
    expect(lerQuandoDaFala('pode ser 20/09', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 20, HORA_PADRAO, 0));
    expect(lerQuandoDaFala('marca pra 05/01', QUINTA_10H)?.quando)
      .toEqual(new Date(2027, 0, 5, HORA_PADRAO, 0));
  });

  it('"dia 15" é deste mês; dia já passado é do mês que vem', () => {
    expect(lerQuandoDaFala('no dia 15 eu vejo', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 15, HORA_PADRAO, 0));
    expect(lerQuandoDaFala('no dia 3 eu vejo', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 9, 3, HORA_PADRAO, 0));
  });

  it('"à tarde" corrige a hora de um número solto', () => {
    const r = lerQuandoDaFala('me liga amanhã às 3 da tarde', QUINTA_10H);
    expect(r?.quando).toEqual(new Date(2026, 8, 11, 15, 0));
  });

  it('hora sem dia é hoje se ainda couber, senão amanhã', () => {
    expect(lerQuandoDaFala('me manda às 15h', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 10, 15, 0));
    expect(lerQuandoDaFala('me manda às 9h', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 11, 9, 0));
  });

  it('"hoje" que já passou não vira agendamento', () => {
    expect(lerQuandoDaFala('era pra ser hoje às 8h', QUINTA_10H)).toBeNull();
  });

  it('fala sem marca de tempo não inventa data', () => {
    expect(lerQuandoDaFala('beleza, obrigado', QUINTA_10H)).toBeNull();
    expect(lerQuandoDaFala('', QUINTA_10H)).toBeNull();
  });

  it('não se perde com acento nem com caixa', () => {
    expect(lerQuandoDaFala('NA TERÇA-FEIRA, por favor', QUINTA_10H)?.quando)
      .toEqual(new Date(2026, 8, 15, HORA_PADRAO, 0));
  });
});

describe('lerQuandoDaConversa', () => {
  it('pega a fala mais recente que marca dia, ignorando o resto', () => {
    const r = lerQuandoDaConversa([
      'oi, tudo bem?',
      'me manda amanhã',
      'na verdade, melhor na segunda',
      'beleza então',
    ], QUINTA_10H);
    expect(r?.quando).toEqual(new Date(2026, 8, 14, HORA_PADRAO, 0));
    expect(r?.trecho).toBe('segunda-feira');
  });

  it('conversa sem marca de tempo devolve nada', () => {
    expect(lerQuandoDaConversa(['oi', 'tudo certo', 'obrigado'], QUINTA_10H)).toBeNull();
  });

  it('o caso do médico: áudio transcrito marcando a segunda', () => {
    const r = lerQuandoDaConversa([
      'Não, é, marca só com ela mesmo, não é comigo não. Mas peço desculpa, mas não vai ter essa semana não. '
      + 'Mas vou falar com ela aqui pra tentar ver pra próxima segunda. Tu pode mandar mensagem pra mim na segunda, '
      + 'aí eu dou uma olhada com ela lá pra gente ver a agenda como é que tá.',
    ], QUINTA_10H);
    expect(r?.quando).toEqual(new Date(2026, 8, 14, HORA_PADRAO, 0));
  });
});

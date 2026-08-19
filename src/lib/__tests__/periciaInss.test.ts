import { describe, it, expect } from 'vitest';
import {
  isBeneficioInssProcess,
  ehAtividadeDePericia,
  periciaInputValue,
  periciaPartesDoInput,
  formatPericia,
  periciaTom,
} from '../periciaInss';

describe('isBeneficioInssProcess', () => {
  it('reconhece o título como ele nasce no banco', () => {
    expect(isBeneficioInssProcess('Benefício INSS')).toBe(true);
  });

  it('ignora acento, caixa e espaço extra', () => {
    expect(isBeneficioInssProcess('  beneficio   inss ')).toBe(true);
    expect(isBeneficioInssProcess('BENEFÍCIO INSS')).toBe(true);
  });

  it('não pega processo que só menciona INSS', () => {
    // Sem isto, "Protocolar no INSS" ou o requerimento administrativo ganhariam
    // campos de perícia que aquele processo não tem.
    expect(isBeneficioInssProcess('INSS Administrativo — Req. 470045537 (BPC)')).toBe(false);
    expect(isBeneficioInssProcess('Auxílio maternidade')).toBe(false);
    expect(isBeneficioInssProcess('Onboarding')).toBe(false);
    expect(isBeneficioInssProcess(null)).toBe(false);
    expect(isBeneficioInssProcess('')).toBe(false);
  });
});

describe('ehAtividadeDePericia', () => {
  it('reconhece os títulos reais das atividades pendentes (19/08/2026)', () => {
    // Amostra literal do banco: são elas que precisam do chip e não têm
    // processo "Benefício INSS" para acioná-lo pela outra regra.
    for (const t of [
      'PREV 1469 INSTRUIR PERÍCIA MÉDICA- BPC/AUT',
      'INSTRUÇÃO DA PERÍCIA',
      'REMARCAR PERICIA - PREV 1707 - BPC/AUT',
      'REAGENDAR PERÍCIA - PREV 1431 - BPC/AUT',
      'Acompanhar pedido e agendar perícia médica',
      'Audiência Perícia Médica 14/08/2026 14:00',
      'REMARCAR PERÍCIAS',
      'Perícia designada — ✅ CASO 394 Manaus/AM',
    ]) {
      expect(ehAtividadeDePericia(t, null), t).toBe(true);
    }
  });

  it('avaliação social entra pelo nome que o BPC usa', () => {
    expect(ehAtividadeDePericia('Acompanhar avaliação social e perícia médica', null)).toBe(true);
    expect(ehAtividadeDePericia('Agendar avaliação social', null)).toBe(true);
  });

  it('trabalho SOBRE laudo pericial não vira chip de marcar data', () => {
    // "pericial" contém "pericia" — sem a fronteira de palavra, estas quatro
    // ganhariam um chip de convocação que não existe. São trabalho posterior à
    // perícia já realizada.
    expect(ehAtividadeDePericia('Peticionar cobrando a juntada do laudo pericial', null)).toBe(false);
    expect(ehAtividadeDePericia('(24/08) MANIFESTAR laudo pericial (cópia)', null)).toBe(false);
    expect(ehAtividadeDePericia('Impugnar laudo pericial', null)).toBe(false);
    expect(ehAtividadeDePericia('Honorários periciais', null)).toBe(false);
  });

  it('atividade comum não mostra o chip', () => {
    expect(ehAtividadeDePericia('Ligar para o cliente', null)).toBe(false);
    expect(ehAtividadeDePericia(null, null)).toBe(false);
    expect(ehAtividadeDePericia('', '')).toBe(false);
  });

  it('o tipo da atividade também aciona, não só o título', () => {
    expect(ehAtividadeDePericia('Tarefa do dia', 'Perícia Médica')).toBe(true);
    expect(ehAtividadeDePericia('Tarefa do dia', 'INSTRUÇÃO DE PERICIA')).toBe(true);
  });
});

describe('conversão datetime-local ↔ colunas de hearings', () => {
  it('ida e volta preserva o horário que a pessoa digitou', () => {
    // `hearings` guarda data e hora LOCAIS (hearing_time é time sem fuso), então
    // não há conversão UTC no caminho — era ali que a hora escorregava antes.
    const digitado = '2026-08-14T09:20';
    const partes = periciaPartesDoInput(digitado);
    expect(partes).toEqual({ data: '2026-08-14', hora: '09:20' });
    expect(periciaInputValue(partes!.data, partes!.hora)).toBe(digitado);
  });

  it('aceita o time com segundos que o Postgres devolve', () => {
    expect(periciaInputValue('2026-09-24', '08:00:00')).toBe('2026-09-24T08:00');
  });

  it('data sem hora abre o campo às 09:00 em vez de vazio', () => {
    expect(periciaInputValue('2026-09-24', null)).toBe('2026-09-24T09:00');
  });

  it('vazio e lixo viram null/string vazia em vez de data inválida', () => {
    expect(periciaPartesDoInput('')).toBeNull();
    expect(periciaPartesDoInput(null)).toBeNull();
    expect(periciaPartesDoInput('não é data')).toBeNull();
    // Meia data (sem hora) não grava: hearing_time nulo esconderia a hora da
    // convocação, que é o que decide o deslocamento do cliente.
    expect(periciaPartesDoInput('2026-08-14')).toBeNull();
    expect(periciaInputValue(null)).toBe('');
    expect(periciaInputValue('lixo')).toBe('');
    expect(formatPericia(null)).toBe('');
  });

  it('formata para leitura em pt-BR', () => {
    expect(formatPericia('2026-08-14', '09:20:00')).toBe('14/08/2026 09:20');
    expect(formatPericia('2026-08-14', null)).toBe('14/08/2026');
  });
});

describe('periciaTom', () => {
  const agora = new Date('2026-08-13T15:00:00');

  it('sem data é vazio', () => {
    expect(periciaTom(null, agora)).toBe('vazio');
    expect(periciaTom('lixo', agora)).toBe('vazio');
  });

  it('mesma data civil é hoje, mesmo já tendo passado a hora', () => {
    expect(periciaTom('2026-08-13', agora)).toBe('hoje');
  });

  it('separa futura de passada', () => {
    expect(periciaTom('2026-08-20', agora)).toBe('futura');
    expect(periciaTom('2026-07-30', agora)).toBe('passada');
  });

  it('vira do ano não confunde a comparação de string', () => {
    expect(periciaTom('2027-01-02', new Date('2026-12-31T23:00:00'))).toBe('futura');
    expect(periciaTom('2025-12-31', new Date('2026-01-01T01:00:00'))).toBe('passada');
  });
});

import { describe, it, expect } from 'vitest';
import {
  groupPhoneFromJid,
  kindLabel,
  isReportPending,
  buildLeadFromReport,
  type GroupCaseReport,
} from '../groupCaseReports';

const BOARD = '2dcd54b5-502b-413b-b795-5e24a20797d2';

function relato(over: Partial<GroupCaseReport> = {}) {
  return {
    headline: 'Marido da Cleide caiu de andaime em obra em Contagem',
    kind: 'acidente_trabalho' as const,
    victim_name: 'Marido da Cleide',
    city: 'Contagem',
    state: 'MG',
    accident_date: '2026-08-09',
    company: 'MRV',
    damage: 'Fratura na coluna',
    dynamics_summary: 'Queda de andaime de 6m',
    details: 'A Cleide contou no grupo que o marido caiu de um andaime na obra.',
    quote: 'gente meu marido caiu do andaime ontem na obra',
    group_name: 'Bairro Industrial',
    reporter_name: 'Cleide',
    reporter_phone: '5531999998888',
    ...over,
  };
}

describe('groupPhoneFromJid', () => {
  it('reduz o JID aos dígitos, que é como a mensagem de grupo é gravada', () => {
    expect(groupPhoneFromJid('120363012345678901@g.us')).toBe('120363012345678901');
  });

  it('aguenta JID já em dígitos e valor vazio', () => {
    expect(groupPhoneFromJid('120363012345678901')).toBe('120363012345678901');
    expect(groupPhoneFromJid('')).toBe('');
  });
});

describe('rótulos e fila', () => {
  it('traduz os tipos conhecidos e cai em "Outro" no desconhecido', () => {
    expect(kindLabel('acidente_trabalho')).toBe('Acidente de trabalho');
    expect(kindLabel('doenca_ocupacional')).toBe('Doença / INSS');
    expect(kindLabel('coisa_que_nao_existe')).toBe('Outro');
  });

  it('só o relato novo continua na fila', () => {
    expect(isReportPending('novo')).toBe(true);
    expect(isReportPending('aproveitado')).toBe(false);
    expect(isReportPending('descartado')).toBe(false);
  });
});

describe('buildLeadFromReport', () => {
  it('leva os campos do acidente para o lead e marca a origem', () => {
    const lead = buildLeadFromReport(relato(), BOARD, '2026-08-11T12:00:00.000Z');

    expect(lead.board_id).toBe(BOARD);
    expect(lead.lead_name).toBe('Marido da Cleide caiu de andaime em obra em Contagem');
    expect(lead.victim_name).toBe('Marido da Cleide');
    expect(lead.city).toBe('Contagem');
    expect(lead.state).toBe('MG');
    expect(lead.accident_date).toBe('2026-08-09');
    expect(lead.main_company).toBe('MRV');
    expect(lead.source).toBe('grupo_whatsapp');
  });

  it('nasce viável: o relato já foi triado por gente ao ser aproveitado', () => {
    const lead = buildLeadFromReport(relato(), BOARD);
    expect(lead.status).toBe('viavel');
  });

  it('marca news_enriched_at para a IA de manchete não reavaliar o caso', () => {
    const lead = buildLeadFromReport(relato(), BOARD, '2026-08-11T12:00:00.000Z');
    expect(lead.news_enriched_at).toBe('2026-08-11T12:00:00.000Z');
  });

  it('usa o telefone de quem contou — é por ele que se chega na vítima', () => {
    const lead = buildLeadFromReport(relato(), BOARD);
    expect(lead.lead_phone).toBe('5531999998888');
  });

  it('guarda grupo e frase original nas notas, que é a prova do relato', () => {
    const lead = buildLeadFromReport(relato(), BOARD);
    expect(lead.notes).toContain('Bairro Industrial');
    expect(lead.notes).toContain('Cleide');
    expect(lead.notes).toContain('meu marido caiu do andaime ontem na obra');
  });

  it('junta dano e dinâmica na descrição do caso', () => {
    const lead = buildLeadFromReport(relato(), BOARD);
    expect(lead.damage_description).toContain('Dano: Fratura na coluna.');
    expect(lead.damage_description).toContain('Dinâmica: Queda de andaime de 6m.');
  });

  it('sem detalhe nenhum, a descrição cai na manchete em vez de ficar vazia', () => {
    const lead = buildLeadFromReport(
      relato({ details: null, damage: null, dynamics_summary: null }),
      BOARD
    );
    expect(lead.damage_description).toBe('Marido da Cleide caiu de andaime em obra em Contagem');
  });

  it('traduz trânsito para o case_type do formulário de caso viável', () => {
    const transito = buildLeadFromReport(relato({ kind: 'acidente_transito' }), BOARD);
    expect(transito.case_type).toBe('Acidente de Trânsito');
    // Acidente de trabalho tem dinâmica variada (queda, máquina, choque): chutar
    // um case_type aqui erraria mais do que deixar o formulário perguntar.
    expect(buildLeadFromReport(relato(), BOARD).case_type).toBeNull();
  });
});

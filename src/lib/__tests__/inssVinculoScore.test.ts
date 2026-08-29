import { describe, it, expect } from 'vitest';
import { pontuarSugestao, familiaBeneficio } from '../inssVinculoScore';

describe('familiaBeneficio', () => {
  it('lê o benefit_type sujo que o parser do e-mail deixa', () => {
    expect(familiaBeneficio('ASSISTENCIAL À PESSOA COM DEFICIÊNCIA Data do Protocolo : 25/08/2026')).toBe('bpc');
    expect(familiaBeneficio('AUXÍLIO-ACIDENTE')).toBe('aux_acidente');
    expect(familiaBeneficio('POR INCAPACIDADE')).toBe('aux_doenca');
    expect(familiaBeneficio('SALÁRIO-MATERNIDADE RURAL')).toBe('maternidade');
  });

  it('lê o rótulo que a equipe escreve no nome do lead', () => {
    expect(familiaBeneficio('✅PREV 1630 - EVELYN/BERNARDO - (BPC - LOAS) - KAROLYNE')).toBe('bpc');
    expect(familiaBeneficio('✅PREV 1800 - Gilson - AUX. ACIDENTE')).toBe('aux_acidente');
    expect(familiaBeneficio('CASO 146 SÓ CRISTIANE')).toBeNull();
    expect(familiaBeneficio(null)).toBeNull();
  });
});

describe('pontuarSugestao', () => {
  const fraco = { pista: 'nome_fraco' as const };
  const forte = { pista: 'nome_forte' as const };

  it('a pista manda: nenhum bônus faz um palpite passar na frente de um CPF', () => {
    const palpitePerfeito = pontuarSugestao({
      ...fraco,
      beneficioProtocolo: 'ASSISTENCIAL À PESSOA COM DEFICIÊNCIA',
      beneficioCandidato: 'PREV 1 - (BPC/LOAS)',
      dataProtocolo: '2026-08-01', dataLead: '2026-08-02', temCaso: true,
    }).score;
    const cpfSemNada = pontuarSugestao({ pista: 'cpf' }).score;
    const requerimento = pontuarSugestao({ pista: 'requerimento' }).score;
    expect(palpitePerfeito).toBeLessThan(cpfSemNada);
    expect(cpfSemNada).toBeLessThan(requerimento);
  });

  it('benefício igual sobe, benefício diferente desce', () => {
    const igual = pontuarSugestao({ ...fraco, beneficioProtocolo: 'ASSISTENCIAL À PESSOA COM DEFICIÊNCIA', beneficioCandidato: 'PREV 9 (BPC/LOAS)' });
    const diferente = pontuarSugestao({ ...fraco, beneficioProtocolo: 'ASSISTENCIAL À PESSOA COM DEFICIÊNCIA', beneficioCandidato: 'PREV 9 - AUX. ACIDENTE' });
    expect(igual.score).toBeGreaterThan(diferente.score);
    expect(igual.motivos).toContain('mesmo benefício');
    expect(diferente.motivos).toContain('benefício diferente');
  });

  it('lead que entrou perto do protocolo ganha do lead antigo', () => {
    const perto = pontuarSugestao({ ...fraco, dataProtocolo: '2026-08-20', dataLead: '2026-08-01' });
    const antigo = pontuarSugestao({ ...fraco, dataProtocolo: '2026-08-20', dataLead: '2023-01-01' });
    expect(perto.score).toBeGreaterThan(antigo.score);
    expect(perto.motivos).toContain('lead entrou perto do protocolo');
    expect(antigo.motivos).toContain('lead é de outra época');
  });

  it('sem dado de desempate, não inventa motivo', () => {
    const r = pontuarSugestao(forte);
    expect(r.motivos).toEqual([]);
    expect(r.score).toBeGreaterThan(pontuarSugestao(fraco).score);
  });
});

import { describe, it, expect } from 'vitest';
import { conferirNomeDoSegurado, tokensDeNome } from '../../../railway-server/src/lib/inss-nome-confere';

// Todos os casos abaixo são reais, colhidos na varredura dos 687 protocolos
// vinculados em 27/08/2026.

describe('conferirNomeDoSegurado — vínculos errados que precisam travar', () => {
  it('pega o processo da ESTER pendurado no lead da ANA FLÁVIA', () => {
    const r = conferirNomeDoSegurado('ESTER MARIA DE ARRUDA MELLO RUIZ', {
      victimName: 'EVILLI RAILLEN GONÇALVES CANNO',
      leadName: 'ANA FLÁVIA DOS REIS',
    });
    expect(r.veredito).toBe('conflito');
    expect(r.motivo).toContain('EVILLI');
  });

  it('pega VALENTINA ARAUJO FRANCA casada com "Valentina Francavilla" — FRANCA é substring de FRANCAVILLA', () => {
    const r = conferirNomeDoSegurado('VALENTINA ARAUJO FRANCA', {
      victimName: 'Valentina Francavilla',
      leadName: 'Lembra de Valentina Francavilla? Ex-braço direito de Ratinho',
    });
    expect(r.veredito).toBe('conflito');
  });

  it('separa ELOA VITORIA de ELOANE, que só compartilham o sobrenome', () => {
    const r = conferirNomeDoSegurado('ELOA VITORIA VIEIRA FERREIRA', {
      victimName: 'ELOANE DE ALMEIDA FERREIRA',
      leadName: 'Lolo',
    });
    expect(r.veredito).toBe('conflito');
  });

  it('trava quando o rótulo tem gente, mas não o primeiro nome do segurado', () => {
    const r = conferirNomeDoSegurado('GABRIEL HENRIQUE OLIVEIRA DA SILVA', {
      leadName: 'PREV 993 /MARINALVA/ANUNCIO (BPC LOAS) - EDILAN',
    });
    expect(r.veredito).toBe('conflito');
    expect(r.fonte).toBe('rotulos');
  });
});

describe('conferirNomeDoSegurado — vínculos legítimos que precisam passar', () => {
  it('aceita nome completo igual ao victim_name (Ellena, PREV 1404)', () => {
    const r = conferirNomeDoSegurado('ELLENA DA SILVA MOREIRA', {
      victimName: 'ELLENA DA SILVA MOREIRA',
      leadName: '✅ PREV 1404 Naira - Ellena - BPC/LOAS',
    });
    expect(r.veredito).toBe('ok');
    expect(r.fonte).toBe('victim_name');
  });

  it('aceita rótulo que traz só o primeiro nome do beneficiário', () => {
    const r = conferirNomeDoSegurado('LAVINNYA DOS SANTOS ROCHA', {
      leadName: '✅ PREV 1193 RAIANE - LAVINNYA - BPC/LOAS',
    });
    expect(r.veredito).toBe('ok');
  });

  it('aceita victim_name de um token só, caindo para os rótulos (RYAN no lead da Gisele)', () => {
    const r = conferirNomeDoSegurado('RYAN GIL MACEDO DA MOTA', {
      victimName: 'Ryan',
      leadName: 'Gisele',
    });
    expect(r.veredito).toBe('ok');
  });

  it('aceita victim_name mais curto que o nome do INSS', () => {
    const r = conferirNomeDoSegurado('HEITOR GABRIEL DA SILVA', {
      victimName: 'Heitor Gabriel da Silva',
      leadName: 'Pamela Purcina Ferreira da Silva',
    });
    expect(r.veredito).toBe('ok');
  });
});

describe('conferirNomeDoSegurado — quando não dá para afirmar nada', () => {
  it('não acusa conflito quando o rótulo só tem palavra de processo', () => {
    const r = conferirNomeDoSegurado('RAVI GUILHERME SILVA DE MELLO', {
      leadName: '✅PREV 1144 - ( ) Acd- -',
    });
    expect(r.veredito).toBe('sem_base');
  });

  it('não acusa conflito quando o INSS manda nome inútil', () => {
    const r = conferirNomeDoSegurado('ANA', { victimName: 'Carlos Roberto da Costa Pereira' });
    expect(r.veredito).toBe('sem_base');
  });
});

describe('tokensDeNome', () => {
  it('descarta preposição, número e acento', () => {
    expect(tokensDeNome('✅ PREV 1404 José da Silva Júnior')).toEqual(['PREV', 'JOSE', 'SILVA']);
  });
});

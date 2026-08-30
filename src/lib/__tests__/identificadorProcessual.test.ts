import { describe, it, expect } from 'vitest';
import {
  cnjDvValido,
  classificarNumeroCadastrado,
  extrairIdentificadoresAdministrativos,
  chaveIdentificador,
} from '../../../supabase/functions/_shared/identificadorProcessual';

describe('cnjDvValido — módulo 97 (ISO 7064)', () => {
  // Os 5 processos de teste da tarefa, todos cadastrados na base real.
  const reais = [
    '1025462-91.2026.4.01.4000',
    '1021895-52.2026.4.01.4000',
    '0000970-49.2026.5.22.0002',
    '0011905-72.2025.5.15.0134',
    '1025676-82.2026.4.01.4000',
  ];
  it('valida CNJs reais da carteira', () => {
    for (const cnj of reais) {
      expect(cnjDvValido(cnj.replace(/\D/g, ''))).toBe(true);
    }
  });
  it('rejeita DV trocado', () => {
    expect(cnjDvValido('10254629220264014000')).toBe(false); // DV 91 → 92
  });
  it('rejeita comprimento errado', () => {
    expect(cnjDvValido('1362120725120235')).toBe(false); // SEI de 17 dígitos com 1 a menos
    expect(cnjDvValido('')).toBe(false);
  });
});

describe('classificarNumeroCadastrado — tipo pela máscara, nunca por faixa', () => {
  it('CNJ: exatamente 20 dígitos', () => {
    expect(classificarNumeroCadastrado('1025462-91.2026.4.01.4000'))
      .toEqual({ tipo: 'cnj', digitos: '10254629120264014000' });
  });
  it('SEI de 17 dígitos NÃO vira CNJ (o bug do balde por comprimento)', () => {
    expect(classificarNumeroCadastrado('13621.207251/2023-52'))
      .toEqual({ tipo: 'sei', digitos: '13621207251202352' });
  });
  it('demanda do SIT e ordem de serviço', () => {
    expect(classificarNumeroCadastrado('3747657-2')?.tipo).toBe('demanda_sit');
    expect(classificarNumeroCadastrado('11471427-4')?.tipo).toBe('ordem_servico');
  });
  it('protocolo INSS de 6 a 12 dígitos lisos (o de 12 ficava fora do índice)', () => {
    expect(classificarNumeroCadastrado('135734398')?.tipo).toBe('protocolo_inss');
    expect(classificarNumeroCadastrado('297696035235')?.tipo).toBe('protocolo_inss');
  });
  it('máscara desconhecida com dígito suficiente cai em outro — e só casa com outro', () => {
    expect(classificarNumeroCadastrado('002217.2025.03.000/2')?.tipo).toBe('outro');
    expect(classificarNumeroCadastrado('1505819-97.2025.8.26.03788')?.tipo).toBe('outro'); // 21 dígitos: CNJ com typo
  });
  it('vazio e curto demais não entram no índice', () => {
    expect(classificarNumeroCadastrado(null)).toBeNull();
    expect(classificarNumeroCadastrado('123')).toBeNull();
  });
});

describe('extrairIdentificadoresAdministrativos — âncora obrigatória', () => {
  it('SEI com âncora "requerimento SEI nº" (e-mail real do adm@)', () => {
    const ids = extrairIdentificadoresAdministrativos({
      assunto: 'Informações sobre o andamento do requerimento SEI nº 13068.204458/2026-41',
      corpo: 'Gostaria de solicitar informações sobre o andamento do requerimento *SEI nº\n13068.204458/2026-41*.',
    });
    expect(ids.some((i) => i.tipo === 'sei' && i.valorNormalizado === '13068204458202641')).toBe(true);
  });
  it('SEI com âncora "RELATÓRIO Nº" no assunto (e-mail real do MTE)', () => {
    const ids = extrairIdentificadoresAdministrativos({
      assunto: 'RE: INFORMAÇÕES RELATÓRIO Nº 13041.200223/2026-88',
      corpo: 'Prezado, não conseguimos ter acesso no SEI.',
    });
    expect(ids).toHaveLength(1);
    expect(ids[0].tipo).toBe('sei');
  });
  it('demanda e ordem de serviço exigem a palavra por perto; número solto é descartado', () => {
    const com = extrairIdentificadoresAdministrativos({
      assunto: null,
      corpo: 'Referente à demanda 3747657-2 e à ordem de serviço 11471427-4.',
    });
    expect(com.map((i) => i.tipo).sort()).toEqual(['demanda_sit', 'ordem_servico']);

    const sem = extrairIdentificadoresAdministrativos({
      assunto: null,
      corpo: 'Seu código de rastreio é 3747657-2 e o pedido 11471427-4.',
    });
    expect(sem).toHaveLength(0);
  });
  it('CNJ sem máscara: só com âncora processo/autos E DV válido', () => {
    const ok = extrairIdentificadoresAdministrativos({
      assunto: null,
      corpo: 'Trata-se do processo 10254629120264014000 em curso.',
    });
    expect(ok).toHaveLength(1);
    expect(ok[0].tipo).toBe('cnj');

    const dvErrado = extrairIdentificadoresAdministrativos({
      assunto: null,
      corpo: 'Trata-se do processo 10254629220264014000 em curso.',
    });
    expect(dvErrado).toHaveLength(0);
  });
  it('documento do SEI só entra como filho quando o e-mail tem um SEI pai', () => {
    const comPai = extrairIdentificadoresAdministrativos({
      assunto: 'Processo SEI nº 13621.207251/2023-52',
      corpo: 'Saudações, para ciência. Segue o Despacho_2688783 anexo.',
    });
    expect(comPai.some((i) => i.tipo === 'documento_sei' && i.valorNormalizado === '2688783')).toBe(true);

    const semPai = extrairIdentificadoresAdministrativos({
      assunto: 'Documento',
      corpo: 'Segue o Despacho_2688783 anexo.',
    });
    expect(semPai).toHaveLength(0);
  });
  it('procedimento do MPT (IC) entra como outro, com âncora', () => {
    const ids = extrairIdentificadoresAdministrativos({
      assunto: 'Pedido de vista deferido',
      corpo: 'Procedimento relacionado: IC 002217.2025.03.000/2',
    });
    expect(ids).toHaveLength(1);
    expect(ids[0].tipo).toBe('outro');
    expect(ids[0].valorNormalizado).toBe('0022172025030002');
  });
  it('o mesmo número repetido no reply é UMA ocorrência', () => {
    const ids = extrairIdentificadoresAdministrativos({
      assunto: 'Re: relatório nº 10260.224110/2025-14',
      corpo: 'Sobre o relatório nº 10260.224110/2025-14 já foi finalizado?\n> Sobre o relatório nº 10260.224110/2025-14 já foi finalizado?',
    });
    expect(ids).toHaveLength(1);
  });
});

describe('chaveIdentificador — tipo compõe a chave', () => {
  it('protocolo nunca colide com CNJ de mesmo dígito', () => {
    expect(chaveIdentificador('protocolo_inss', '123456'))
      .not.toBe(chaveIdentificador('cnj', '123456'));
  });
});

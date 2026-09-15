import { describe, it, expect } from 'vitest';
import { telefoneParaConsulta, camposParaGravar, hashChave, cpfDaResposta } from '../datastone-lead';

describe('telefoneParaConsulta', () => {
  // Os quatro formatos medidos na fila alvo em 15/09/2026.
  it('aceita 55 + DDD + 9 dígitos (91% da fila)', () => {
    const r = telefoneParaConsulta('558688054381');
    expect(r.tel).toEqual({ ddd: '86', numero: '88054381', e164: '558688054381' });
  });

  it('aceita telefone sem DDI', () => {
    const r = telefoneParaConsulta('86988054381');
    expect(r.tel?.ddd).toBe('86');
  });

  it('recusa ID de grupo do WhatsApp gravado no campo telefone', () => {
    const r = telefoneParaConsulta('120363019728479551');
    expect(r.tel).toBeNull();
    expect(r.motivo).toBe('id_de_grupo');
  });

  it('recusa DDD que não existe', () => {
    const r = telefoneParaConsulta('5520999998888');
    expect(r.tel).toBeNull();
    expect(r.motivo).toBe('ddd_desconhecido');
  });

  it('recusa vazio e lixo curto', () => {
    expect(telefoneParaConsulta('').tel).toBeNull();
    expect(telefoneParaConsulta('12345').tel).toBeNull();
    expect(telefoneParaConsulta(null).tel).toBeNull();
  });

  it('aceita formatação com pontuação', () => {
    const r = telefoneParaConsulta('+55 (86) 98805-4381');
    expect(r.tel?.e164).toBe('5586988054381');
  });
});

describe('camposParaGravar', () => {
  const pessoa = {
    cpf: '11144477735',
    name: 'FULANO DE TAL',
    birthday: '1980-05-02',
    rg: '1234567',
    addresses: [
      { type: 'RUA', street: 'SEGUNDA', number: '9', city: 'B', district: 'PI', postal_code: '64000000', priority: 2 },
      { type: 'AVENIDA', street: 'PRIMEIRA', number: '100', neighborhood: 'CENTRO', city: 'TERESINA', district: 'PI', postal_code: '64001000', priority: 1 },
    ],
  };

  it('preenche só o que está vazio no lead', () => {
    const { campos } = camposParaGravar({ cpf: null, city: 'TERESINA' }, pessoa);
    expect(campos.cpf).toBe('11144477735');
    expect(campos.birth_date).toBe('1980-05-02');
    expect(campos.city).toBeUndefined(); // já tinha valor igual
  });

  it('usa o endereço de priority 1, não o primeiro da lista', () => {
    const { campos } = camposParaGravar({}, pessoa);
    expect(campos.street).toBe('AVENIDA PRIMEIRA');
    expect(campos.street_number).toBe('100');
    expect(campos.cep).toBe('64001000');
    expect(campos.state).toBe('PI');
  });

  it('não sobrescreve dado do CRM: divergência vira aviso', () => {
    const { campos, divergentes } = camposParaGravar({ cpf: '99999999999' }, pessoa);
    expect(campos.cpf).toBeUndefined();
    expect(divergentes).toContain('cpf');
  });

  it('ignora diferença de pontuação ao comparar', () => {
    const { campos, divergentes } = camposParaGravar({ cpf: '111.444.777-35' }, pessoa);
    expect(campos.cpf).toBeUndefined();
    expect(divergentes).not.toContain('cpf');
  });
});

describe('hashChave', () => {
  it('ignora pontuação: mesma chave, mesmo hash', () => {
    expect(hashChave('telefone', '+55 86 98805-4381')).toBe(hashChave('telefone', '5586988054381'));
  });

  it('separa por tipo: telefone e cpf não colidem', () => {
    expect(hashChave('telefone', '11144477735')).not.toBe(hashChave('cpf', '11144477735'));
  });
});


describe('cpfDaResposta', () => {
  // A API devolve `cpf` como NÚMERO. 01234567890 chega como 1234567890.
  it('devolve o zero à esquerda que a serialização comeu', () => {
    expect(cpfDaResposta(1234567890)).toBe('01234567890');
    expect(cpfDaResposta(12345678)).toBe('00012345678');
  });

  it('aceita string com pontuação', () => {
    expect(cpfDaResposta('111.444.777-35')).toBe('11144477735');
  });

  it('recusa vazio e valor grande demais para ser CPF', () => {
    expect(cpfDaResposta(null)).toBe('');
    expect(cpfDaResposta('')).toBe('');
    expect(cpfDaResposta('123456789012')).toBe('');
  });
});

describe('camposParaGravar com o retorno real de /persons/search/', () => {
  // Shape medido em produção: resumo, sem addresses[], com cpf numérico.
  const resumo = {
    name: 'FULANO DE TAL',
    cpf: 1234567890,
    age: '45',
    city: 'TERESINA',
    district: 'PI',
    ddd: '86',
    number: '988054381',
    mother_name: null,
  };

  it('grava CPF com o zero recuperado', () => {
    const { campos } = camposParaGravar({}, resumo);
    expect(campos.cpf).toBe('01234567890');
  });

  it('usa cidade e UF do topo quando não há addresses[]', () => {
    const { campos } = camposParaGravar({}, resumo);
    expect(campos.city).toBe('TERESINA');
    expect(campos.state).toBe('PI');
    expect(campos.street).toBeUndefined();
  });

  it('não inventa campo a partir de mother_name null', () => {
    const { campos } = camposParaGravar({}, resumo);
    expect(campos.rg).toBeUndefined();
    expect(campos.birth_date).toBeUndefined();
  });
});

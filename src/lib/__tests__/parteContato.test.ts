import { describe, expect, it } from 'vitest';
import {
  notaDeCadastro,
  ordenarSugestoes,
  tipoDeDocumento,
  variantesDeTelefone,
  type SugestaoDeContato,
} from '@/lib/parteContato';

describe('tipoDeDocumento', () => {
  it('separa CPF de CNPJ pelo tamanho, com ou sem máscara', () => {
    expect(tipoDeDocumento('010.690.513-90')).toBe('cpf');
    expect(tipoDeDocumento('01069051390')).toBe('cpf');
    expect(tipoDeDocumento('12.255.352/0001-77')).toBe('cnpj');
  });

  it('descarta o que não é documento', () => {
    expect(tipoDeDocumento('123')).toBeNull();
    expect(tipoDeDocumento(null)).toBeNull();
    expect(tipoDeDocumento('')).toBeNull();
  });
});

describe('variantesDeTelefone', () => {
  it('cobre as grafias com e sem 55 e com e sem o nono dígito', () => {
    const v = variantesDeTelefone('(85) 99647-8999');
    expect(v.sort()).toEqual(
      ['85996478999', '5585996478999', '8596478999', '558596478999'].sort()
    );
  });

  it('parte de um número já em formato WhatsApp e chega nas mesmas grafias', () => {
    expect(variantesDeTelefone('558596478999').sort()).toEqual(
      ['8596478999', '558596478999', '85996478999', '5585996478999'].sort()
    );
  });

  it('ignora número curto demais para casar', () => {
    expect(variantesDeTelefone('96478999')).toEqual([]);
    expect(variantesDeTelefone(null)).toEqual([]);
  });
});

describe('ordenarSugestoes', () => {
  const base = { origem: 'contato', documento: null, leadId: null, score: 1 } as const;
  const s = (over: Partial<SugestaoDeContato>): SugestaoDeContato =>
    ({ ...base, id: 'x', nome: 'Fulano', telefone: null, motivo: 'nome-parecido', ...over } as SugestaoDeContato);

  it('põe documento na frente de nome idêntico, e nome idêntico na frente de parecido', () => {
    const ordenado = ordenarSugestoes([
      s({ id: 'c', motivo: 'nome-parecido' }),
      s({ id: 'a', motivo: 'documento' }),
      s({ id: 'b', motivo: 'nome-exato' }),
    ]);
    expect(ordenado.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('no empate, quem tem telefone vem antes — é o número que serve pro WhatsApp', () => {
    const ordenado = ordenarSugestoes([
      s({ id: 'sem', telefone: null }),
      s({ id: 'com', telefone: '85996478999' }),
    ]);
    expect(ordenado.map((x) => x.id)).toEqual(['com', 'sem']);
  });
});

describe('notaDeCadastro', () => {
  it('registra de onde o contato saiu', () => {
    expect(
      notaDeCadastro({ nome: 'Edivandro', polo: 'ATIVO', tipo: 'Autor', doc: '010.690.513-90' }, '0016320-73.2016.5.16.0009')
    ).toBe('Cadastrado via processo 0016320-73.2016.5.16.0009 | Participação: Autor | Polo: ATIVO | Doc: 010.690.513-90');
  });
});

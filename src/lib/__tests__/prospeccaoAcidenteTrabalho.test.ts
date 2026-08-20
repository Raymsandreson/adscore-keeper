import { describe, it, expect } from 'vitest';
import {
  normalizar,
  coletarAssuntos,
  isAssuntoAcidenteTrabalho,
  parseValorCausa,
  valorCausaDoProcesso,
  extrairAdvogadosPoloAtivo,
  filtrarCandidatos,
  itensDeResposta,
  proximaPaginaSegura,
} from '../../../supabase/functions/_shared/prospeccaoAcidenteTrabalho';

describe('normalizar', () => {
  it('tira acento e caixa', () => {
    expect(normalizar('Acidente de Trabalho')).toBe('acidente de trabalho');
    expect(normalizar('Doença Ocupacional')).toBe('doenca ocupacional');
    expect(normalizar('  ACIDENTE   DO  TRABALHO ')).toBe('acidente do trabalho');
  });

  it('aguenta null/undefined/vazio', () => {
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
    expect(normalizar('')).toBe('');
  });
});

describe('coletarAssuntos', () => {
  it('junta assunto, assunto_principal e assuntos[] em qualquer formato', () => {
    const capa = {
      assunto: 'Indenização por Dano Moral',
      assunto_principal: { nome: 'Acidente de Trabalho' },
      assuntos: [{ nome: 'Doença Ocupacional' }, 'Insalubridade'],
    };
    expect(coletarAssuntos(capa)).toEqual([
      'Indenização por Dano Moral',
      'Acidente de Trabalho',
      'Doença Ocupacional',
      'Insalubridade',
    ]);
  });

  it('capa vazia não quebra', () => {
    expect(coletarAssuntos(null)).toEqual([]);
    expect(coletarAssuntos({})).toEqual([]);
    expect(coletarAssuntos({ assuntos: null })).toEqual([]);
  });
});

describe('isAssuntoAcidenteTrabalho', () => {
  it('pega as variações de grafia', () => {
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Acidente de Trabalho' })).toBe(true);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Acidente do Trabalho' })).toBe(true);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'ACIDENTE DE TRAJETO' })).toBe(true);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Doença Ocupacional' })).toBe(true);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Doença Profissional' })).toBe(true);
  });

  it('pega quando o termo está aninhado em assuntos[]', () => {
    const capa = {
      assunto: 'Indenização por Dano Moral',
      assuntos: [{ nome: 'Acidente de Trabalho' }],
    };
    expect(isAssuntoAcidenteTrabalho(capa)).toBe(true);
  });

  it('não confunde com acidente de trânsito / DPVAT', () => {
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Acidente de Trânsito' })).toBe(false);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Seguro DPVAT' })).toBe(false);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Acidente de Veículo' })).toBe(false);
  });

  it('assunto genérico de trabalho não basta', () => {
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Horas Extras' })).toBe(false);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Verbas Rescisórias' })).toBe(false);
    expect(isAssuntoAcidenteTrabalho({ assunto: 'Adicional de Insalubridade' })).toBe(false);
  });

  it('sem assunto é false, não crash', () => {
    expect(isAssuntoAcidenteTrabalho(null)).toBe(false);
    expect(isAssuntoAcidenteTrabalho({})).toBe(false);
  });
});

describe('parseValorCausa', () => {
  // O bug que este bloco existe pra travar: "1500000.00" (ponto decimal, formato
  // cru da API) tratado como separador de milhar vira 150000000 — 100x maior —
  // e faz qualquer piso de valor passar.
  it('formato cru da API: ponto é decimal', () => {
    expect(parseValorCausa({ valor: '1500000.00' })).toBe(1500000);
    expect(parseValorCausa({ valor: '500000.00' })).toBe(500000);
    expect(parseValorCausa({ valor: '750.50' })).toBe(750.5);
  });

  it('formato pt-BR: ponto é milhar, vírgula é decimal', () => {
    expect(parseValorCausa({ valor_formatado: 'R$ 1.500.000,00' })).toBe(1500000);
    expect(parseValorCausa({ valor_formatado: 'R$ 500.000,00' })).toBe(500000);
    expect(parseValorCausa({ valor_formatado: '1.234,56' })).toBe(1234.56);
  });

  it('inteiro com separador de milhar e sem decimal', () => {
    expect(parseValorCausa({ valor: '1.500.000' })).toBe(1500000);
  });

  it('aceita número direto e string solta', () => {
    expect(parseValorCausa(1500000)).toBe(1500000);
    expect(parseValorCausa('1500000.00')).toBe(1500000);
  });

  it('prefere `valor` sobre `valor_formatado`', () => {
    expect(parseValorCausa({ valor: '900000.00', valor_formatado: 'R$ 1,00' })).toBe(900000);
  });

  it('cai pro formatado quando `valor` está ausente', () => {
    expect(parseValorCausa({ valor: null, valor_formatado: 'R$ 800.000,00' })).toBe(800000);
  });

  it('ausente/zero/lixo vira null — nunca 0', () => {
    expect(parseValorCausa(null)).toBeNull();
    expect(parseValorCausa(undefined)).toBeNull();
    expect(parseValorCausa({})).toBeNull();
    expect(parseValorCausa({ valor: '0.00' })).toBeNull();
    expect(parseValorCausa({ valor: '' })).toBeNull();
    expect(parseValorCausa({ valor: 'sigiloso' })).toBeNull();
    expect(parseValorCausa(0)).toBeNull();
  });
});

describe('valorCausaDoProcesso', () => {
  it('pega o maior valor entre as fontes', () => {
    const processo = {
      capa: { valor_causa: { valor: '400000.00' } },
      fontes: [
        { capa: { valor_causa: { valor: '650000.00' } } },
        { capa: { valor_causa: { valor: '120000.00' } } },
      ],
    };
    expect(valorCausaDoProcesso(processo)).toBe(650000);
  });

  it('null quando nenhuma fonte tem valor', () => {
    expect(valorCausaDoProcesso({ fontes: [{ capa: {} }] })).toBeNull();
    expect(valorCausaDoProcesso({})).toBeNull();
  });
});

describe('extrairAdvogadosPoloAtivo', () => {
  it('pega só os advogados do polo ativo, não os da ré', () => {
    const envolvidos = [
      {
        nome: 'João da Silva',
        polo: 'ATIVO',
        advogados: [
          { nome: 'Dra. Ana Prado', oabs: [{ uf: 'SP', tipo: 'ADVOGADO', numero: 123456 }] },
        ],
      },
      {
        nome: 'Construtora XYZ LTDA',
        polo: 'PASSIVO',
        advogados: [
          { nome: 'Dr. Carlos Réu', oabs: [{ uf: 'SP', tipo: 'ADVOGADO', numero: 999999 }] },
        ],
      },
    ];
    const advs = extrairAdvogadosPoloAtivo(envolvidos);
    expect(advs).toHaveLength(1);
    expect(advs[0].nome).toBe('Dra. Ana Prado');
    expect(advs[0].oab).toBe('123456/SP');
    expect(advs[0].oab_numero).toBe('123456');
    expect(advs[0].oab_uf).toBe('SP');
  });

  it('pega advogado que vem solto como envolvido de polo ativo', () => {
    const envolvidos = [
      { nome: 'Dra. Marta Lima', polo: 'ATIVO', oabs: [{ uf: 'BA', numero: 55555 }] },
    ];
    const advs = extrairAdvogadosPoloAtivo(envolvidos);
    expect(advs).toHaveLength(1);
    expect(advs[0].oab).toBe('55555/BA');
  });

  it('deduplica o mesmo advogado repetido em partes diferentes', () => {
    const adv = { nome: 'Dra. Ana Prado', oabs: [{ uf: 'SP', numero: 123456 }] };
    const envolvidos = [
      { nome: 'Autor 1', polo: 'ATIVO', advogados: [adv] },
      { nome: 'Autor 2', polo: 'ATIVO', advogados: [adv] },
    ];
    expect(extrairAdvogadosPoloAtivo(envolvidos)).toHaveLength(1);
  });

  it('lista vazia/null não quebra', () => {
    expect(extrairAdvogadosPoloAtivo(null)).toEqual([]);
    expect(extrairAdvogadosPoloAtivo([])).toEqual([]);
  });
});

describe('itensDeResposta', () => {
  it('aceita os tres formatos que a v2 mistura', () => {
    expect(itensDeResposta({ items: [1, 2] })).toEqual([1, 2]);
    expect(itensDeResposta({ data: [3] })).toEqual([3]);
    expect(itensDeResposta([4, 5])).toEqual([4, 5]);
  });

  it('lixo vira lista vazia, nunca throw', () => {
    expect(itensDeResposta(null)).toEqual([]);
    expect(itensDeResposta(undefined)).toEqual([]);
    expect(itensDeResposta({})).toEqual([]);
    expect(itensDeResposta('texto')).toEqual([]);
    expect(itensDeResposta({ items: 'nao e array' })).toEqual([]);
  });
});

describe('proximaPaginaSegura', () => {
  const BASE = 'https://api.escavador.com/api/v2';

  it('aceita link legitimo da propria API', () => {
    const next = `${BASE}/advogado/processos?cursor=abc&li=99`;
    expect(proximaPaginaSegura({ links: { next } }, BASE)).toBe(next);
  });

  // O ataque que esta funcao existe pra barrar: o link de paginacao vem DENTRO
  // da resposta, e o loop faz fetch nele mandando o Authorization junto. Seguir
  // host arbitrario vazaria o token do Escavador.
  it('recusa host parecido que so PREFIXA a base', () => {
    expect(
      proximaPaginaSegura(
        { links: { next: 'https://api.escavador.com.evil.test/api/v2/x' } },
        BASE,
      ),
    ).toBeNull();
  });

  it('recusa host totalmente outro', () => {
    expect(
      proximaPaginaSegura({ links: { next: 'https://evil.test/api/v2/x' } }, BASE),
    ).toBeNull();
  });

  it('recusa downgrade para http', () => {
    expect(
      proximaPaginaSegura({ links: { next: 'http://api.escavador.com/api/v2/x' } }, BASE),
    ).toBeNull();
  });

  it('recusa pulo para outra rota fora da base', () => {
    expect(
      proximaPaginaSegura({ links: { next: 'https://api.escavador.com/api/v1/busca' } }, BASE),
    ).toBeNull();
  });

  it('ausencia de next encerra a paginacao', () => {
    expect(proximaPaginaSegura({}, BASE)).toBeNull();
    expect(proximaPaginaSegura({ links: {} }, BASE)).toBeNull();
    expect(proximaPaginaSegura({ links: { next: null } }, BASE)).toBeNull();
    expect(proximaPaginaSegura(null, BASE)).toBeNull();
  });

  it('url malformada nao quebra o loop', () => {
    expect(proximaPaginaSegura({ links: { next: 'nao-e-url' } }, BASE)).toBeNull();
  });
});

describe('filtrarCandidatos', () => {
  const acidente = { valor_causa: { valor: '600000.00' }, assunto: 'Acidente de Trabalho' };

  it('mantém acidente de trabalho acima do piso', () => {
    const r = filtrarCandidatos(
      [{ numero_cnj: '0001', capa: acidente }],
      { valorMinimo: 500000 },
    );
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0].numero_cnj).toBe('0001');
    expect(r.candidatos[0].valor_causa).toBe(600000);
  });

  it('corta valor igual ou abaixo do piso', () => {
    const r = filtrarCandidatos(
      [
        { numero_cnj: 'a', capa: { valor_causa: { valor: '500000.00' }, assunto: 'Acidente de Trabalho' } },
        { numero_cnj: 'b', capa: { valor_causa: { valor: '499999.99' }, assunto: 'Acidente de Trabalho' } },
      ],
      { valorMinimo: 500000 },
    );
    expect(r.candidatos).toHaveLength(0);
  });

  it('corta assunto fora do recorte e conta', () => {
    const r = filtrarCandidatos(
      [{ numero_cnj: 'x', capa: { valor_causa: { valor: '900000.00' }, assunto: 'Horas Extras' } }],
      { valorMinimo: 500000 },
    );
    expect(r.candidatos).toHaveLength(0);
    expect(r.foraDoAssunto).toBe(1);
  });

  it('processo sem valor não entra e é contado em semValor', () => {
    const r = filtrarCandidatos(
      [{ numero_cnj: 'y', capa: { assunto: 'Acidente de Trabalho' } }],
      { valorMinimo: 500000 },
    );
    expect(r.candidatos).toHaveLength(0);
    expect(r.semValor).toBe(1);
  });

  it('lê a capa que está dentro de fontes[]', () => {
    const r = filtrarCandidatos(
      [{ numero_cnj: 'z', fontes: [{ capa: acidente, tribunal: { sigla: 'TRT2' } }] }],
      { valorMinimo: 500000 },
    );
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0].tribunal).toBe('TRT2');
  });

  it('entrada vazia devolve tudo zerado', () => {
    const r = filtrarCandidatos(null, { valorMinimo: 500000 });
    expect(r.candidatos).toEqual([]);
    expect(r.semValor).toBe(0);
    expect(r.foraDoAssunto).toBe(0);
  });
});

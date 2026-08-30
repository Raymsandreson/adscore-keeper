// Trava o que a ficha consegue preencher SEM gastar consulta no Escavador.
// O texto abaixo é a publicação real gravada em process_movements para o
// processo 0017007-20.2016.5.16.0019 (Airton de Sousa Carvalho) — o caso que
// motivou o botão: ficha vazia, "Nunca buscado", e o banco já sabendo tudo.
import { describe, it, expect } from 'vitest';
import {
  capitalizarNome, detectarNossoPolo, fichaDoBanco, lerNotas, lerPublicacao,
} from '@/lib/fichaDoBanco';

const PUBLICACAO_AIRTON =
  'Intimado(s)/Citado(s): - AIRTON DE SOUSA CARVALHO PODER JUDICIÁRIO FEDERAL JUSTIÇA DO ' +
  'TRABALHO TRIBUNAL REGIONAL DO TRABALHO 16 a REGIÃO Vara do Trabalho de Timon Avenida ' +
  'Jaime Rios, 536, Centro, TIMON - MA - CEP: 65630-370 DESTINATÁRIO: RAYMSANDRESON DE ' +
  'MORAIS PRUDENCIO PROCESSO: 0017007-20.2016.5.16.0019 CLASSE: AÇÃO TRABALHISTA - RITO ' +
  'ORDINÁRIO (985) CÓDIGO DE RASTREAMENTO: AUTOR: AIRTON DE SOUSA CARVALHO';

const NOTA_AIRTON =
  'Ficha criada em 18/08/2026 a partir do inventário por OAB no Escavador (doc ' +
  'jurimetria-fluxo-carteira §13.8). Protocolo: 10/10/2016. Polo passivo: B e Q Energia ' +
  'Ltda. Sem nº de caso e sem lead vinculado — vincular quando o caso for identificado.';

const entradaVazia = {
  publicacoes: [],
  notas: null,
  datajud: [],
  jurimetria: null,
  partesJurimetria: [],
};

describe('capitalizarNome', () => {
  it('desmaiúscula sem estragar as preposições', () => {
    expect(capitalizarNome('AIRTON DE SOUSA CARVALHO')).toBe('Airton de Sousa Carvalho');
    expect(capitalizarNome('B E Q ENERGIA LTDA')).toBe('B e Q Energia Ltda');
  });
});

describe('lerPublicacao', () => {
  const lido = lerPublicacao(PUBLICACAO_AIRTON);

  it('acha o autor sem engolir o resto do texto', () => {
    expect(lido.polo_ativo).toBe('Airton de Sousa Carvalho');
  });

  it('acha a classe e tira o código entre parênteses', () => {
    expect(lido.classe).toBe('Ação Trabalhista - Rito Ordinário');
  });

  it('acha o tribunal, a sigla e a área', () => {
    expect(lido.tribunal).toBe('Tribunal Regional do Trabalho da 16ª Região');
    expect(lido.tribunal_sigla).toBe('TRT16');
    expect(lido.area).toBe('Trabalhista');
  });

  it('acha a vara sem levar junto o endereço', () => {
    expect(lido.orgao_julgador).toBe('Vara do Trabalho de Timon');
  });

  it('acha cidade e UF pelo trecho do CEP', () => {
    expect(lido.unidade_origem_cidade).toBe('Timon');
    expect(lido.estado_origem_sigla).toBe('MA');
  });

  it('acha o advogado intimado', () => {
    expect(lido.destinatario).toBe('Raymsandreson de Morais Prudencio');
  });

  it('não inventa nada em texto vazio', () => {
    expect(lerPublicacao(null)).toEqual({});
    expect(lerPublicacao('Conclusos para julgamento')).toEqual({});
  });
});

describe('lerNotas', () => {
  it('tira polo passivo e protocolo da nota do inventário por OAB', () => {
    const lido = lerNotas(NOTA_AIRTON);
    expect(lido.polo_passivo).toBe('B e Q Energia Ltda');
    expect(lido.data_distribuicao).toBe('2016-10-10');
  });

  it('não corta a razão social no ponto da abreviação', () => {
    const nota =
      'Ficha criada em 18/08/2026 a partir do inventário por OAB no Escavador. ' +
      'Protocolo: 28/11/2024. Polo passivo: Copel Distribuicao S.A e outros. Sem nº de caso.';
    expect(lerNotas(nota).polo_passivo).toBe('Copel Distribuicao S.A e outros');
  });

  it('ignora parte anonimizada em iniciais em vez de gravar a primeira letra', () => {
    const nota = 'Protocolo: 10/10/2016. Polo passivo: R. G. M. P.. Sem nº de caso.';
    expect(lerNotas(nota).polo_passivo).toBeUndefined();
    expect(lerNotas(nota).data_distribuicao).toBe('2016-10-10');
  });

  it('lê o polo ativo quando a nota traz os dois polos separados por ponto e vírgula', () => {
    expect(lerNotas('Polo ativo: Fulano de Tal; Polo passivo: Beltrano SA').polo_ativo)
      .toBe('Fulano de Tal');
  });
});

describe('fichaDoBanco', () => {
  const campos = fichaDoBanco({
    ...entradaVazia,
    publicacoes: [{ descricao: PUBLICACAO_AIRTON, data_movimentacao: '2017-06-09 00:00:00+00', fonte: 'escavador_compromissos' }],
    notas: NOTA_AIRTON,
  });
  const valor = (campo: string) => campos.find(c => c.campo === campo)?.valor;
  const origem = (campo: string) => campos.find(c => c.campo === campo)?.origem;

  it('preenche o processo do Airton inteiro sem Escavador', () => {
    expect(valor('polo_ativo')).toBe('Airton de Sousa Carvalho');
    expect(valor('polo_passivo')).toBe('B e Q Energia Ltda');
    expect(valor('classe')).toBe('Ação Trabalhista - Rito Ordinário');
    expect(valor('orgao_julgador')).toBe('Vara do Trabalho de Timon');
    expect(valor('tribunal_sigla')).toBe('TRT16');
    expect(valor('data_distribuicao')).toBe('2016-10-10');
    expect(valor('ano_inicio')).toBe('2016');
    expect(valor('data_ultima_movimentacao')).toBe('2017-06-09');
  });

  it('diz de onde veio cada campo', () => {
    expect(origem('polo_ativo')).toBe('publicação de 09/06/2017');
    expect(origem('polo_passivo')).toBe('nota do cadastro');
  });

  it('a publicação mais antiga ganha da mais nova no mesmo campo', () => {
    const dois = fichaDoBanco({
      ...entradaVazia,
      publicacoes: [
        { descricao: 'AUTOR: MARIA DA SILVA', data_movimentacao: '2020-01-01', fonte: null },
        { descricao: 'AUTOR: MARIA S. (abreviado)', data_movimentacao: '2024-01-01', fonte: null },
      ],
    });
    expect(dois.find(c => c.campo === 'polo_ativo')?.valor).toBe('Maria da Silva');
  });

  it('DataJud e jurimetria só entram em campo que ninguém preencheu', () => {
    const misto = fichaDoBanco({
      ...entradaVazia,
      publicacoes: [{ descricao: PUBLICACAO_AIRTON, data_movimentacao: '2017-06-09', fonte: null }],
      datajud: [{ orgao_julgador: '2ª Vara do Trabalho', tribunal_alias: 'TRT16', grau: 'G2', data_hora: '2024-01-01' }],
      jurimetria: { uf_proc: 'MA', cidade_proc: 'Timon', empresa: 'Outra Empresa SA', natureza: null, causa: null, data_protocolo: '2016-10-10' },
    });
    const v = (c: string) => misto.find(x => x.campo === c)?.valor;
    expect(v('orgao_julgador')).toBe('Vara do Trabalho de Timon'); // publicação venceu
    expect(v('grau')).toBe('G2');                                   // só o DataJud tinha
    expect(v('polo_passivo')).toBe('Outra Empresa SA');             // só a jurimetria tinha
  });

  it('banco sem nada devolve lista vazia — nenhum campo chutado', () => {
    expect(fichaDoBanco(entradaVazia)).toEqual([]);
  });
});

describe('detectarNossoPolo', () => {
  const publicacoes = [{ descricao: PUBLICACAO_AIRTON, data_movimentacao: '2017-06-09', fonte: null }];

  it('reconhece o advogado do escritório como destinatário e crava o polo', () => {
    const r = detectarNossoPolo(publicacoes, ['Raymsandreson de Morais Prudêncio']);
    expect(r?.polo).toBe('ATIVO');
    expect(r?.parte).toBe('Airton de Sousa Carvalho');
  });

  it('advogado de fora não vira detecção', () => {
    expect(detectarNossoPolo(publicacoes, ['João Ninguém'])).toBeNull();
  });

  it('sem lista de advogados não afirma nada', () => {
    expect(detectarNossoPolo(publicacoes, [])).toBeNull();
  });
});

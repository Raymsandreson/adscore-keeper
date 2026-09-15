import { describe, it, expect } from 'vitest';
import {
  comAcessoCloudPadrao, ehInstanciaCloud, ehLinhaCloudPadrao, ehRegistroCloud, idDaLinhaCloudPadrao,
  linhaCloudPadrao, LINHA_CLOUD_PADRAO, membrosSemLinhaPadrao, nomesInstanciasCloud,
  operacoesDoPadraoApi, rotuloDaLinha, TOKEN_CLOUD_API,
} from '../cloudApiInstances';

describe('ehInstanciaCloud', () => {
  it('reconhece a linha renomeada', () => {
    // A razão de existir: depois do rename, comparar com 'cloud_gerencia'
    // deixaria de reconhecer a conversa como Cloud — e o envio iria pra UazAPI.
    expect(ehInstanciaCloud('abraci')).toBe(true);
  });

  it('não exige edição de código para linha criada pelo painel', () => {
    // Linha nova NÃO entra na semente — quem a ensina é o banco (e, do segundo
    // render em diante, o cache). Se alguém voltar a listar nomes novos aqui,
    // este teste falha e lembra que o caminho certo é o painel.
    expect(nomesInstanciasCloud()).not.toContain('quitepay');
    expect(nomesInstanciasCloud()).not.toContain('prudencio_advogados');
  });

  it('mantém o nome histórico enquanto houver mensagem antiga com ele', () => {
    expect(ehInstanciaCloud('cloud_gerencia')).toBe(true);
  });

  it('não confunde instância UazAPI com Cloud', () => {
    expect(ehInstanciaCloud('prudencio1')).toBe(false);
    expect(ehInstanciaCloud('Raym')).toBe(false);
    expect(ehInstanciaCloud('Atendimento Previdenciário')).toBe(false);
  });

  it('tolera caixa, espaço, vazio e nulo', () => {
    expect(ehInstanciaCloud(' ABRACI ')).toBe(true);
    expect(ehInstanciaCloud('')).toBe(false);
    expect(ehInstanciaCloud(null)).toBe(false);
    expect(ehInstanciaCloud(undefined)).toBe(false);
  });

  it('expõe o marcador usado em whatsapp_instances.instance_token', () => {
    expect(TOKEN_CLOUD_API).toBe('cloud_api_meta');
    expect(nomesInstanciasCloud()).toContain('abraci');
  });
});

describe('rotuloDaLinha', () => {
  it('troca underline por espaço e capitaliza', () => {
    expect(rotuloDaLinha('abraci')).toBe('Abraci');
    expect(rotuloDaLinha('prudencio_advogados')).toBe('Prudencio Advogados');
  });

  it('normaliza caixa vinda do banco', () => {
    expect(rotuloDaLinha('ABRACI')).toBe('Abraci');
  });

  it('tolera vazio e nulo', () => {
    expect(rotuloDaLinha('')).toBe('');
    expect(rotuloDaLinha(null)).toBe('');
    expect(rotuloDaLinha(undefined)).toBe('');
  });
});

describe('linhaCloudPadrao', () => {
  // Só a semente vale aqui (sem banco): 'abraci' e 'cloud_gerencia' são as
  // linhas que o módulo reconhece sem carregar nada.
  const abraci = { id: 'id-abraci', instance_name: 'abraci' };
  const gerencia = { id: 'id-gerencia', instance_name: 'cloud_gerencia' };
  const uazapi = { id: 'id-raym', instance_name: 'Raym' };

  it('abre na linha do nome travado, e não em "todas"', () => {
    expect(linhaCloudPadrao([uazapi, gerencia, abraci], 'abraci')).toBe('id-abraci');
  });

  it('ignora caixa e espaço do nome travado', () => {
    expect(linhaCloudPadrao([gerencia, abraci], '  ABRACI ')).toBe('id-abraci');
  });

  it('cai em "todas" quando a linha do nome não está disponível', () => {
    // Renomeada, desativada ou fora do acesso do usuário: melhor mostrar as
    // outras linhas do que uma caixa vazia sem explicação.
    expect(linhaCloudPadrao([gerencia, abraci], 'quitepay')).toBe('all');
  });

  it('com uma única linha Cloud, abre nela mesmo sem casar o nome', () => {
    expect(linhaCloudPadrao([uazapi, gerencia], 'abraci')).toBe('id-gerencia');
  });

  it('não considera instância UazAPI', () => {
    expect(linhaCloudPadrao([uazapi], 'abraci')).toBe('all');
  });
});

describe('acesso padrão do canal WhatsApp API', () => {
  const abraci = { id: 'id-abraci', instance_name: 'abraci' };
  const prudencio = { id: 'id-prudencio', instance_name: 'cloud_gerencia' };
  const uazapi = { id: 'id-raym', instance_name: 'Raym' };
  const todas = [uazapi, prudencio, abraci];

  it('a linha padrão é a Abraci', () => {
    expect(LINHA_CLOUD_PADRAO).toBe('abraci');
    expect(ehLinhaCloudPadrao(' ABRACI ')).toBe(true);
    expect(ehLinhaCloudPadrao('cloud_gerencia')).toBe(false);
    expect(idDaLinhaCloudPadrao(todas)).toBe('id-abraci');
    expect(idDaLinhaCloudPadrao([uazapi, prudencio])).toBeNull();
  });

  it('escolha sem nenhuma linha Cloud recebe a Abraci', () => {
    // O caso do usuário novo: perfil só com instância UazAPI abria a caixa
    // /whatsapp-api vazia no primeiro dia.
    expect(comAcessoCloudPadrao(['id-raym'], todas)).toEqual(['id-raym', 'id-abraci']);
    expect(comAcessoCloudPadrao([], todas)).toEqual(['id-abraci']);
  });

  it('escolha que já tem linha Cloud passa intacta', () => {
    // Quem marcou outra linha da API sabia o que estava fazendo — o padrão não
    // se impõe por cima da decisão do admin.
    expect(comAcessoCloudPadrao(['id-prudencio'], todas)).toEqual(['id-prudencio']);
    expect(comAcessoCloudPadrao(['id-abraci', 'id-raym'], todas)).toEqual(['id-abraci', 'id-raym']);
  });

  it('sem a linha padrão cadastrada, não inventa id', () => {
    expect(comAcessoCloudPadrao(['id-raym'], [uazapi])).toEqual(['id-raym']);
  });

  it('descarta id repetido e vazio', () => {
    expect(comAcessoCloudPadrao(['id-raym', 'id-raym', ''], todas)).toEqual(['id-raym', 'id-abraci']);
  });
});

describe('ehRegistroCloud', () => {
  it('reconhece pelo token mesmo com nome que o módulo não conhece', () => {
    // O caso real: `quitepay` não está na semente. Quem seleciona só
    // `id, instance_name` depende do nome; quem traz o token acerta sempre.
    expect(ehRegistroCloud({ id: 'x', instance_name: 'quitepay', instance_token: TOKEN_CLOUD_API })).toBe(true);
    expect(ehRegistroCloud({ id: 'x', instance_name: 'quitepay' })).toBe(false);
  });

  it('não promove instância UazAPI a linha da API', () => {
    expect(ehRegistroCloud({ id: 'x', instance_name: 'Raym', instance_token: 'tok-uaz' })).toBe(false);
    expect(ehRegistroCloud(null)).toBe(false);
  });

  it('a escolha com linha da API reconhecida pelo token não ganha a Abraci', () => {
    const quitepay = { id: 'id-quitepay', instance_name: 'quitepay', instance_token: TOKEN_CLOUD_API };
    const abraci = { id: 'id-abraci', instance_name: 'abraci', instance_token: TOKEN_CLOUD_API };
    expect(comAcessoCloudPadrao(['id-quitepay'], [quitepay, abraci])).toEqual(['id-quitepay']);
  });
});

describe('operacoesDoPadraoApi', () => {
  const abraci = { id: 'id-abraci', instance_name: 'abraci', instance_token: TOKEN_CLOUD_API };
  const quitepay = { id: 'id-quitepay', instance_name: 'quitepay', instance_token: TOKEN_CLOUD_API };
  const linhasApi = [abraci, quitepay];
  const ana = { user_id: 'u-ana', role: 'member' };
  const chefe = { user_id: 'u-chefe', role: 'admin' };

  it('concede a Abraci e revoga a outra linha da API', () => {
    const vinculos = [{ user_id: 'u-ana', instance_id: 'id-quitepay' }];
    expect(operacoesDoPadraoApi([ana], linhasApi, vinculos)).toEqual([
      { user_id: 'u-ana', instance_id: 'id-abraci', grant: true },
      { user_id: 'u-ana', instance_id: 'id-quitepay', grant: false },
    ]);
  });

  it('não revoga o que a pessoa não tem', () => {
    expect(operacoesDoPadraoApi([ana], linhasApi, [])).toEqual([
      { user_id: 'u-ana', instance_id: 'id-abraci', grant: true },
    ]);
  });

  it('reaplica a concessão de quem já tem — é assim que o espelho se acerta', () => {
    const vinculos = [{ user_id: 'u-ana', instance_id: 'id-abraci' }];
    expect(operacoesDoPadraoApi([ana], linhasApi, vinculos)).toEqual([
      { user_id: 'u-ana', instance_id: 'id-abraci', grant: true },
    ]);
    // ...mas o contador do que muda não conta essa pessoa.
    expect(membrosSemLinhaPadrao([ana], linhasApi, vinculos)).toEqual([]);
    expect(membrosSemLinhaPadrao([ana], linhasApi, [])).toEqual([ana]);
  });

  it('nunca toca em instância UazAPI', () => {
    // O risco real do botão: revogar em lote a inbox de trabalho de 55 pessoas.
    const vinculos = [
      { user_id: 'u-ana', instance_id: 'id-raym' },
      { user_id: 'u-ana', instance_id: 'id-quitepay' },
    ];
    const ops = operacoesDoPadraoApi([ana], linhasApi, vinculos);
    expect(ops.some(o => o.instance_id === 'id-raym')).toBe(false);
  });

  it('pula admin — ele enxerga todas as linhas pelo papel', () => {
    const vinculos = [{ user_id: 'u-chefe', instance_id: 'id-quitepay' }];
    expect(operacoesDoPadraoApi([chefe], linhasApi, vinculos)).toEqual([]);
    expect(membrosSemLinhaPadrao([chefe], linhasApi, [])).toEqual([]);
  });

  it('sem a linha padrão cadastrada, não faz nada', () => {
    expect(operacoesDoPadraoApi([ana], [quitepay], [])).toEqual([]);
  });
});

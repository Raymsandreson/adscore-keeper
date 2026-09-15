import { describe, it, expect } from 'vitest';
import { ehInstanciaCloud, linhaCloudPadrao, nomesInstanciasCloud, rotuloDaLinha, TOKEN_CLOUD_API } from '../cloudApiInstances';

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

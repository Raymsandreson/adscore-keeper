import { describe, it, expect } from 'vitest';
import { ehInstanciaCloud, nomesInstanciasCloud, rotuloDaLinha, TOKEN_CLOUD_API } from '../cloudApiInstances';

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

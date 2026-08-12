// Casos tirados do banco em 12/08/2026 — os 25 padrões mais frequentes dos 30
// dias anteriores. Se um dia o feed mudar de formato, é aqui que aparece.
import { describe, it, expect } from 'vitest';
import { resumoMovimentacao } from '../resumoMovimentacao';

describe('resumoMovimentacao', () => {
  describe('teor de verdade vira assunto', () => {
    it.each([
      'Distribuído por sorteio',
      'Recebido pelo Distribuidor',
      'Autos incluídos no Juízo 100% Digital',
      'Proferido despacho de mero expediente',
      'Encerrada a conclusão',
      'Expedição de Outros documentos.',
    ])('mantém "%s"', (descricao) => {
      const { assunto, origem } = resumoMovimentacao(descricao);
      expect(assunto).toBe(descricao.replace(/\.$/, ''));
      expect(origem).toBeNull();
    });

    it('colapsa a repetição do separador, ficando com a parte mais específica', () => {
      expect(resumoMovimentacao('Intimação | Intimação (RESTRITO)').assunto)
        .toBe('Intimação (RESTRITO)');
    });

    it('mantém partes distintas separadas por ·', () => {
      expect(resumoMovimentacao('Certidão de Distribuição | Certidão (RESTRITO)').assunto)
        .toBe('Certidão de Distribuição · Certidão (RESTRITO)');
    });
  });

  describe('ruído de e-mail push vira origem', () => {
    it('extrai o tribunal do prefixo da caixa', () => {
      const r = resumoMovimentacao('[TRT15] [PUSH] Atualizações de Informações Processuais do Processo 0011351-63.2022.5.15.0031');
      expect(r.assunto).toBeNull();
      expect(r.origem).toBe('aviso por e-mail · TRT15');
    });

    it('normaliza o zero à esquerda, para TRT02 e TRT2 não virarem duas origens', () => {
      expect(resumoMovimentacao('[TRT02] [PUSH] Atualizações de Informações Processuais do Processo 0001018-05.2026.5.10.0014').origem)
        .toBe(resumoMovimentacao('[TRT2] [PUSH] Atualizações de Informações Processuais do Processo 0001018-05.2026.5.10.0014').origem);
    });

    it('reconhece o push sem sigla de tribunal', () => {
      expect(resumoMovimentacao('[Push] Movimentação processual do processo 5003115-23.2026.4.03.6301').origem)
        .toBe('aviso por e-mail');
    });

    it('usa o nome do sistema quando é o que existe', () => {
      expect(resumoMovimentacao('Movimentações Processuais - EPROC Seção Judiciária do Paraná').origem)
        .toBe('aviso por e-mail · EPROC Seção Judiciária do Paraná');
    });

    it('não deixa passar a descrição que é só o número do processo', () => {
      const r = resumoMovimentacao('3001016-44.2025.8.06.0122');
      expect(r.assunto).toBeNull();
      expect(r.origem).toBe('sem detalhe do tribunal');
    });

    it('trata a movimentação genérica sem prefixo', () => {
      expect(resumoMovimentacao('Movimentação processual do processo 1084937-32.2026.4.01.3400').origem)
        .toBe('sem detalhe do tribunal');
    });
  });

  it('sem descrição não inventa nada', () => {
    for (const vazio of [null, undefined, '', '   ']) {
      expect(resumoMovimentacao(vazio)).toEqual({ assunto: null, origem: null });
    }
  });
});

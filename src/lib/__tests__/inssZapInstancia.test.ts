import { describe, it, expect } from 'vitest';
import { escolherCandidatas, jidDeGrupo, descreverErro } from '../../../railway-server/src/lib/inss-zap-destino';

const dia = (n: number) => new Date(Date.parse('2026-08-26T12:00:00Z') - n * 86400000).toISOString();

describe('escolherCandidatas', () => {
  it('põe a instância da firma na frente, mesmo com espelho mais antigo', () => {
    const out = escolherCandidatas([
      { instance_name: 'Luiz Abraci', created_at: dia(0) },
      { instance_name: 'Atendimento Previdenciário', created_at: dia(2) },
      { instance_name: 'Raym', created_at: dia(1) },
    ]);
    expect(out[0]).toBe('Atendimento Previdenciário');
    expect(out).toContain('Luiz Abraci');
  });

  it('descarta quem parou de espelhar há mais de 7 dias (saiu do grupo)', () => {
    const out = escolherCandidatas([
      { instance_name: 'Dom', created_at: dia(0) },
      { instance_name: 'Atendimento Processual', created_at: dia(30) },
    ]);
    expect(out).toEqual(['Dom']);
  });

  it('não repete a mesma instância escrita de formas diferentes', () => {
    const out = escolherCandidatas([
      { instance_name: 'Atendimento Previdenciário', created_at: dia(0) },
      { instance_name: 'atendimento previdenciario', created_at: dia(1) },
    ]);
    expect(out).toHaveLength(1);
  });

  it('sem histórico, devolve lista vazia em vez de chutar', () => {
    expect(escolherCandidatas([])).toEqual([]);
  });
});

describe('jidDeGrupo', () => {
  it('completa o sufixo quando o jid foi gravado só com dígitos', () => {
    // 945 dos 2.235 vínculos estão assim no banco (26/08/2026).
    expect(jidDeGrupo('120363410706558190')).toBe('120363410706558190@g.us');
  });

  it('não mexe no que já tem sufixo', () => {
    expect(jidDeGrupo('120363408774025928@g.us')).toBe('120363408774025928@g.us');
  });

  it('número curto não vira grupo', () => {
    expect(jidDeGrupo('5586999998888')).toBe('5586999998888');
  });
});

describe('descreverErro', () => {
  it('mostra o corpo do erro em vez de [object Object]', () => {
    const txt = descreverErro({ status: 503, body: { error: 'instance disconnected' } });
    expect(txt).toContain('503');
    expect(txt).toContain('instance disconnected');
    expect(txt).not.toContain('[object Object]');
  });

  it('aguenta corpo em texto puro e corpo vazio', () => {
    expect(descreverErro({ status: 500, body: 'boom' })).toBe('uazapi 500: boom');
    expect(descreverErro({ status: 0 })).toContain('uazapi 0');
  });
});

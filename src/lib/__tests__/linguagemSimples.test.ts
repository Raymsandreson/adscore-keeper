import { describe, it, expect } from 'vitest';
import { traduzirTermos, blocoTextoDoTribunal, EXPLICACAO, ASSUNTO_SIMPLES } from '../linguagemSimples';

/**
 * Os textos abaixo são movimentações reais do feed do sino (11/08/2026) — é
 * exatamente esse vocabulário que chegava cru no grupo do cliente.
 */
describe('traduzirTermos', () => {
  it('explica o jargão de uma movimentação de rotina', () => {
    const t = traduzirTermos('Incluídos os autos no Juízo 100% Digital');
    expect(t.map((x) => x.termo)).toContain('autos');
    expect(t.map((x) => x.termo)).toContain('juízo 100% digital');
  });

  it('não devolve mais de 3 termos, pra não virar parede de texto', () => {
    const texto = 'Sentença homologada, com trânsito em julgado, conclusos os autos para execução e expedição de precatório';
    expect(traduzirTermos(texto).length).toBeLessThanOrEqual(3);
  });

  it('trânsito em julgado ganha explicação própria, não cai em "julgado"', () => {
    const t = traduzirTermos('Certifico o trânsito em julgado da sentença');
    expect(t[0].termo).toBe('trânsito em julgado');
    expect(t[0].explicacao).toMatch(/não cabe mais recurso/i);
  });

  it('texto sem jargão não inventa glossário', () => {
    expect(traduzirTermos('Aguardando providências da parte')).toEqual([]);
    expect(traduzirTermos(null)).toEqual([]);
  });
});

describe('blocoTextoDoTribunal', () => {
  it('mostra o texto do tribunal e explica os termos embaixo', () => {
    const bloco = blocoTextoDoTribunal('Distribuído por sorteio, conclusos os autos ao juiz');
    expect(bloco).toContain('Distribuído por sorteio');
    expect(bloco).toContain('📖 Explicando os termos');
    expect(bloco).toContain('*conclusos*');
  });

  it('movimentação sem texto não deixa a mensagem vazia', () => {
    expect(blocoTextoDoTribunal('')).toContain('Acompanhamos o andamento');
    expect(blocoTextoDoTribunal(null)).not.toContain('""');
  });
});

describe('textos por categoria', () => {
  it('toda categoria diz ao cliente o que ele precisa (ou não) fazer', () => {
    for (const [categoria, texto] of Object.entries(EXPLICACAO)) {
      expect(texto.proximo.length, categoria).toBeGreaterThan(40);
      // A promessa de resultado é o que não pode aparecer em nenhuma delas.
      expect(texto.comoEsta + texto.proximo).not.toMatch(/vamos ganhar|com certeza|garantid/i);
    }
  });

  it('assunto não usa jargão de categoria', () => {
    expect(ASSUNTO_SIMPLES.decisao_merito).toBe('Decisão do juiz');
    expect(ASSUNTO_SIMPLES.movimentacao).not.toMatch(/movimenta/i);
  });
});

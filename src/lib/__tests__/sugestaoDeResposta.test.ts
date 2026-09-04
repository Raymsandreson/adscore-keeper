import { describe, it, expect } from 'vitest';
import { montarPromptDeSugestao } from '../sugestaoDeResposta';

/**
 * O caso real que motivou estes testes: conversa em que o escritório COBRA o
 * cliente (empréstimo adiantado, parcelas atrasadas). O cliente manda áudio
 * dizendo que vai mandar "a documentação do pagamento" e a IA sugeria
 * "assim que recebermos a documentação, daremos andamento ao pagamento" —
 * invertendo quem deve a quem.
 */
describe('montarPromptDeSugestao', () => {
  it('não fixa o assunto da conversa como previdenciário', () => {
    const p = montarPromptDeSugestao({ contexto: 'Cliente: oi' });
    expect(p).not.toMatch(/previdenciári/i);
  });

  it('manda ler da conversa quem cobra quem, em vez de presumir', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Cliente: oi',
      contextoDaRelacao: ['RELACIONAMENTO DESTA PESSOA COM O ESCRITÓRIO: Cliente.'],
    });
    expect(p).toMatch(/quem está cobrando quem/i);
    expect(p).toMatch(/nunca de suposição/i);
  });

  /**
   * O segundo caso real: conversa com a esposa. A sugestão saía "Entendi, Wana.
   * Você gostaria de mudar de assunto e falar sobre Jeri? Posso ajudar com algo
   * relacionado?" — porque o prompt afirmava, sempre, que quem escreve é o
   * atendente de um escritório respondendo um cliente.
   */
  it('sem nenhum dado do escritório, não afirma que é atendimento', () => {
    const p = montarPromptDeSugestao({ contexto: 'Wana: Amor' });
    expect(p).not.toMatch(/Esta conversa É de trabalho/);
    expect(p).not.toMatch(/Você é o atendente/);
    expect(p).toMatch(/NO LUGAR do dono desta conta/);
  });

  it('manda identificar a relação e o registro antes de escrever', () => {
    const p = montarPromptDeSugestao({ contexto: 'Wana: Amor' });
    expect(p).toMatch(/cônjuge ou familiar/);
    expect(p).toMatch(/íntimo e afetuoso/);
    expect(p).toMatch(/PROIBIDO soar como atendimento/);
    expect(p).toMatch(/posso ajudar/);
  });

  it('com dado do escritório, as regras de trabalho voltam', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Cliente: e o meu processo?',
      contextoDaRelacao: ['RELACIONAMENTO DESTA PESSOA COM O ESCRITÓRIO: Cliente.'],
    });
    expect(p).toMatch(/Esta conversa É de trabalho/);
    expect(p).toMatch(/Não invente fatos jurídicos/);
  });

  it('lê o bloco de mensagens sem resposta como uma fala só', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Eu: a gente vai pra Lagoa do Portinho\nWana: Amor',
      ultimaDoInterlocutor: 'Amor\nVamos pra outro lugar\nPrea\nJeri',
    });
    expect(p).toContain('"Amor" → "Vamos pra outro lugar" → "Prea" → "Jeri"');
    expect(p).toMatch(/UMA fala só, quebrada em várias mensagens/);
    expect(p).toMatch(/NUNCA a trate como assunto novo/);
  });

  it('leva os exemplos de como a pessoa escreve', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Wana: Amor',
      comoEuEscrevo: ['COMO EU ESCREVO: "chama tua mãe".'],
    });
    expect(p).toContain('"chama tua mãe"');
  });

  it('avisa que a pendência é do cliente quando há compromisso em aberto', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Cliente: tô mandando a documentação do pagamento',
      pendenciasDoCliente: ['Pagar as parcelas atrasadas — prazo 05/09/2026 (ATRASADA)'],
    });
    expect(p).toContain('"Pagar as parcelas atrasadas — prazo 05/09/2026 (ATRASADA)"');
    expect(p).toMatch(/é ELE quem deve cumprir, não nós/);
  });

  it('sem pendência, não inventa bloco de relação', () => {
    const p = montarPromptDeSugestao({ contexto: 'Cliente: oi' });
    expect(p).not.toMatch(/CONTEXTO DA RELAÇÃO/);
  });

  it('ignora pendência vazia ou só espaço', () => {
    const p = montarPromptDeSugestao({ contexto: 'Cliente: oi', pendenciasDoCliente: ['', '   '] });
    expect(p).not.toMatch(/CONTEXTO DA RELAÇÃO/);
  });

  it('não aplica o bloco de pendência no chat interno da equipe', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Colega: e aí',
      modo: 'team',
      pendenciasDoCliente: ['Pagar as parcelas atrasadas'],
    });
    expect(p).not.toMatch(/CONTEXTO DA RELAÇÃO/);
    expect(p).toMatch(/chat interno da equipe/);
  });

  it('põe o relacionamento e o dinheiro antes da conversa', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Cliente: tô mandando a documentação do pagamento',
      contextoDaRelacao: [
        'RELACIONAMENTO DESTA PESSOA COM O ESCRITÓRIO: Cliente.',
        'DINHEIRO REGISTRADO ENTRE O ESCRITÓRIO E ESTA PESSOA: o escritório ADIANTOU R$ 4.500,00 a esta pessoa.',
      ],
      pendenciasDoCliente: ['Pagar as parcelas atrasadas'],
    });
    expect(p).toMatch(/vem do cadastro do escritório, não da conversa/);
    expect(p).toContain('ADIANTOU R$ 4.500,00');
    // O cadastro entra antes da pendência, e as duas antes da âncora da conversa.
    expect(p.indexOf('RELACIONAMENTO DESTA PESSOA')).toBeLessThan(p.indexOf('CONTEXTO DA RELAÇÃO'));
  });

  it('não manda relacionamento para o chat interno da equipe', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Colega: e aí',
      modo: 'team',
      contextoDaRelacao: ['RELACIONAMENTO DESTA PESSOA COM O ESCRITÓRIO: Cliente.'],
    });
    expect(p).not.toMatch(/RELACIONAMENTO DESTA PESSOA/);
  });

  it('sem relacionamento conhecido, não abre bloco de cadastro', () => {
    const p = montarPromptDeSugestao({ contexto: 'Cliente: oi', contextoDaRelacao: ['', '  '] });
    expect(p).not.toMatch(/vem do cadastro do escritório/);
  });

  it('leva o andamento do processo para o prompt', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Cliente: e tem o número do processo já ou não?',
      andamentoDoProcesso: [
        'ANDAMENTO DO PROCESSO (vem do sistema do escritório...): processo judicial nº 6010694-13.2026.4.06.3814.',
        'COMO USAR O ANDAMENTO: responda com o que está acima.',
      ],
    });
    expect(p).toContain('6010694-13.2026.4.06.3814');
    expect(p).toContain('COMO USAR O ANDAMENTO');
  });

  it('no chat interno, andamento do processo não entra', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Colega: e aí',
      modo: 'team',
      andamentoDoProcesso: ['ANDAMENTO DO PROCESSO: processo judicial nº 6010694-13.2026.4.06.3814.'],
    });
    expect(p).not.toMatch(/ANDAMENTO DO PROCESSO/);
  });

  it('sem andamento, não abre o bloco', () => {
    const p = montarPromptDeSugestao({ contexto: 'Cliente: oi', andamentoDoProcesso: ['', '  '] });
    expect(p).not.toMatch(/ANDAMENTO DO PROCESSO/);
  });

  it('mantém a âncora na última fala do cliente', () => {
    const p = montarPromptDeSugestao({
      contexto: 'Cliente: bom dia',
      ultimaDoInterlocutor: 'tô mandando a documentação',
      jaEnviado: 'Tá certo',
    });
    expect(p).toContain('"tô mandando a documentação"');
    expect(p).toContain('"Tá certo"');
  });
});

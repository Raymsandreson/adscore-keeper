import { describe, it, expect } from 'vitest';
import { blocoDoInterlocutor, montarLinhasDoEstilo } from '../tomDaConversa';

/**
 * O caso real que motivou estes testes: conversa pessoal (a esposa do dono da
 * conta). Ela mandou quatro mensagens seguidas — "Amor" / "Vamos pra outro
 * lugar" / "Prea" / "Jeri" — e a sugestão, que só via a última, respondeu
 * "Entendi, Wana. Você gostaria de mudar de assunto e falar sobre Jeri?".
 */
const conversaDaViagem = [
  { direction: 'outbound', message_text: 'É amor, se arruma aí que a gente vai pra Lagoa do Portinho' },
  { direction: 'outbound', message_text: 'Não vai ficar final de semana nesse feriado não, que aí é triste' },
  { direction: 'inbound', message_text: 'Amor' },
  { direction: 'inbound', message_text: 'Vamos pra outro lugar' },
  { direction: 'inbound', message_text: 'Prea' },
  { direction: 'inbound', message_text: 'Jeri' },
];

describe('blocoDoInterlocutor', () => {
  it('junta todas as falas seguidas sem resposta, não só a última', () => {
    expect(blocoDoInterlocutor(conversaDaViagem)).toBe('Amor\nVamos pra outro lugar\nPrea\nJeri');
  });

  it('para na última mensagem minha — o que já respondi não volta', () => {
    const msgs = [
      { direction: 'inbound', message_text: 'e aí?' },
      { direction: 'outbound', message_text: 'tudo certo' },
      { direction: 'inbound', message_text: 'beleza' },
    ];
    expect(blocoDoInterlocutor(msgs)).toBe('beleza');
  });

  it('devolve vazio quando o último a falar fui eu', () => {
    const msgs = [
      { direction: 'inbound', message_text: 'oi' },
      { direction: 'outbound', message_text: 'oi, tudo bem?' },
    ];
    expect(blocoDoInterlocutor(msgs)).toBe('');
  });

  it('ignora mensagem sem texto (mídia sem legenda)', () => {
    const msgs = [
      { direction: 'outbound', message_text: 'olha isso' },
      { direction: 'inbound', message_text: '   ' },
      { direction: 'inbound', message_text: 'kkkk' },
    ];
    expect(blocoDoInterlocutor(msgs)).toBe('kkkk');
  });

  it('não deixa o bloco crescer sem limite', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ direction: 'inbound', message_text: `m${i}` }));
    expect(blocoDoInterlocutor(msgs).split('\n')).toHaveLength(12);
  });
});

describe('montarLinhasDoEstilo', () => {
  it('leva exemplos reais das minhas mensagens, não adjetivos', () => {
    const [linha] = montarLinhasDoEstilo(conversaDaViagem);
    expect(linha).toContain('COMO EU ESCREVO');
    expect(linha).toContain('se arruma aí que a gente vai pra Lagoa do Portinho');
    expect(linha).toContain('copie o jeito, nunca o conteúdo');
  });

  it('não usa as mensagens da outra pessoa como exemplo do meu estilo', () => {
    const [linha] = montarLinhasDoEstilo(conversaDaViagem);
    expect(linha).not.toContain('Vamos pra outro lugar');
  });

  it('cala quando não há exemplo suficiente — melhor nada que estilo inventado', () => {
    expect(montarLinhasDoEstilo([{ direction: 'outbound', message_text: 'oi' }])).toEqual([]);
    expect(montarLinhasDoEstilo([])).toEqual([]);
  });

  it('descarta link solto e texto longo, que não ensinam estilo', () => {
    const msgs = [
      { direction: 'outbound', message_text: 'https://www.mercadolivre.com.br/p/MLB42189941' },
      { direction: 'outbound', message_text: 'x'.repeat(300) },
      { direction: 'outbound', message_text: 'bora' },
      { direction: 'outbound', message_text: 'chama tua mãe' },
    ];
    const [linha] = montarLinhasDoEstilo(msgs);
    expect(linha).toContain('bora');
    expect(linha).toContain('chama tua mãe');
    expect(linha).not.toContain('mercadolivre');
    expect(linha).not.toContain('xxxxx');
  });
});

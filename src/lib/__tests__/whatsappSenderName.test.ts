import { describe, it, expect } from 'vitest';
import { extractSenderName, lastSenderName, matchMemberByName, prefixarRemetente } from '@/lib/whatsappSenderName';

describe('extractSenderName', () => {
  it('lê o prefixo que o envio com "Identificar remetente" coloca', () => {
    expect(extractSenderName('*Raym Andreson:*\nBom dia, tudo certo?')).toBe('Raym Andreson');
  });

  it('tira o título de tratamento', () => {
    expect(extractSenderName('*Dra. Ana Souza:*\nSegue o documento')).toBe('Ana Souza');
    expect(extractSenderName('*Dr. João Manoel:*\noi')).toBe('João Manoel');
  });

  it('mensagem sem prefixo não inventa autor', () => {
    expect(extractSenderName('Bom dia, tudo certo?')).toBeNull();
    expect(extractSenderName('')).toBeNull();
    expect(extractSenderName(null)).toBeNull();
  });

  it('negrito no meio do texto não vira nome', () => {
    expect(extractSenderName('olha o *prazo:* é amanhã')).toBeNull();
  });

  it('só a primeira linha conta', () => {
    expect(extractSenderName('oi\n*Raym:*\ntudo bem')).toBeNull();
  });
});

describe('lastSenderName', () => {
  const msgs = [
    { direction: 'outbound', message_text: '*Ana Souza:*\nprimeira' },
    { direction: 'inbound', message_text: '*Cliente:*\nresposta do cliente' },
    { direction: 'outbound', message_text: '*João Manoel:*\núltima da equipe' },
    { direction: 'inbound', message_text: 'ok' },
  ];

  it('pega quem falou por último pela equipe', () => {
    expect(lastSenderName(msgs)).toBe('João Manoel');
  });

  it('ignora mensagem recebida — prefixo do cliente não é da equipe', () => {
    expect(lastSenderName([{ direction: 'inbound', message_text: '*Fulano:*\noi' }])).toBeNull();
  });

  it('pula envio anônimo e continua procurando', () => {
    expect(lastSenderName([
      { direction: 'outbound', message_text: '*Ana Souza:*\ncom prefixo' },
      { direction: 'outbound', message_text: 'sem prefixo' },
    ])).toBe('Ana Souza');
  });

  it('conversa sem nenhum envio identificado devolve null', () => {
    expect(lastSenderName([{ direction: 'outbound', message_text: 'oi' }])).toBeNull();
  });
});

describe('matchMemberByName', () => {
  const members = [
    { user_id: '1', full_name: 'Ana Carolina Moreira Souza' },
    { user_id: '2', full_name: 'João Manoel Cavalcante Santana' },
    { user_id: '3', full_name: 'Maria Lydia Ribeiro' },
  ];

  it('casa o formato abreviado que o envio usa (primeiro + último)', () => {
    expect(matchMemberByName('Ana Souza', members)?.user_id).toBe('1');
    expect(matchMemberByName('João Santana', members)?.user_id).toBe('2');
  });

  it('casa nome completo e ignora acento e caixa', () => {
    expect(matchMemberByName('MARIA LYDIA RIBEIRO', members)?.user_id).toBe('3');
    expect(matchMemberByName('Joao Manoel Cavalcante Santana', members)?.user_id).toBe('2');
  });

  it('nome que não é de ninguém não casa', () => {
    expect(matchMemberByName('Fulano de Tal', members)).toBeNull();
    expect(matchMemberByName(null, members)).toBeNull();
  });

  it('ambiguidade não casa — melhor perguntar que chutar', () => {
    const ambiguos = [
      { user_id: '1', full_name: 'Ana Beatriz Souza' },
      { user_id: '2', full_name: 'Ana Carolina Souza' },
    ];
    expect(matchMemberByName('Ana Souza', ambiguos)).toBeNull();
  });
});

describe('prefixarRemetente', () => {
  it('assina com primeiro e último nome (padrão da barra do chat)', () => {
    expect(prefixarRemetente('Bom dia', { fullName: 'Ana Carolina Moreira Souza' }))
      .toBe('*Ana Souza:*\nBom dia');
  });

  it('respeita o formato escolhido', () => {
    const quem = { fullName: 'Ana Carolina Moreira Souza' };
    expect(prefixarRemetente('oi', { ...quem, nameFormat: 'full' })).toBe('*Ana Carolina Moreira Souza:*\noi');
    expect(prefixarRemetente('oi', { ...quem, nameFormat: 'first' })).toBe('*Ana:*\noi');
  });

  it('põe o título de tratamento na frente', () => {
    expect(prefixarRemetente('oi', { fullName: 'Ana Souza', treatmentTitle: 'Dra.' }))
      .toBe('*Dra. Ana Souza:*\noi');
  });

  it('apelido não leva título', () => {
    expect(prefixarRemetente('oi', { fullName: 'Ana Souza', nameFormat: 'nickname', nickname: 'Financeiro', treatmentTitle: 'Dra.' }))
      .toBe('*Financeiro:*\noi');
  });

  it('sem nome para assinar, o texto sai intacto', () => {
    expect(prefixarRemetente('oi', { fullName: null })).toBe('oi');
    expect(prefixarRemetente('oi', { fullName: 'Ana Souza', nameFormat: 'nickname', nickname: '  ' })).toBe('oi');
  });

  it('o que ele escreve, extractSenderName lê de volta', () => {
    const texto = prefixarRemetente('Segue o documento', { fullName: 'Ana Carolina Souza', treatmentTitle: 'Dra.' });
    expect(extractSenderName(texto)).toBe('Ana Souza');
  });
});

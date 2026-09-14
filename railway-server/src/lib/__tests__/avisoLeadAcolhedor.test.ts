/**
 * O aviso que vai para o WhatsApp do acolhedor.
 *
 * O que estes testes protegem, em ordem de dano:
 *   1. Nunca mandar "Oi, é a mamãe do {crianca}?" — marcador cru na cara do
 *      cliente é o pior desfecho possível desta feature.
 *   2. Nunca inventar nome de criança nem DDD. Metade dos leads chega sem o
 *      nome (medido: planilha traz em 12%, API em 94%), e completar DDD manda
 *      mensagem de cliente para o celular de outra pessoa.
 *   3. O link precisa abrir a conversa CERTA, com o texto certo.
 */
import { describe, it, expect } from 'vitest';
import {
  respostasDoLead,
  nomeDaCrianca,
  primeiroNome,
  montarMensagemInicial,
  telefoneParaLink,
  telefoneLegivel,
  linkWaMe,
  montarAviso,
  dentroDoHorario,
  TEMPLATE_PADRAO_SEM_CRIANCA,
} from '../avisoLeadAcolhedor';

// Formato real gravado por meta-leads-sync (functions/meta-leads-sync.ts).
const NOTES_DA_API = [
  'Lido direto da Meta — formulário BPC - AUTISMO - ISRAEL',
  'Cidade: Teresina',
  'facebook_lead_id: 1009263962139850',
  '',
  'Respostas do formulário:',
  '• qual o nome da criança: JOÃO PEDRO DA SILVA',
  '• seu filho recebe o bpc: Não',
  '• possui laudo médico ou relatório escolar: Sim',
  '• qual a renda da família: Até 1 salário mínimo',
  '• você tem cad único: Sim',
  '• você tem advogado: Não',
  '• quantas pessoas moram na casa: 4',
].join('\n');

// Formato real gravado por bpc-sheet-sync: sem as respostas de qualificação.
const NOTES_DA_PLANILHA = [
  'Importado da planilha do board — aba LEADS ISRAEL',
  'Campanha: BPC Autismo',
  'facebook_lead_id: 1009263962139850',
].join('\n');

describe('respostasDoLead', () => {
  it('lê as respostas do bloco que o meta-leads-sync grava', () => {
    const r = respostasDoLead(NOTES_DA_API);
    expect(r['qual o nome da crianca']).toBe('JOÃO PEDRO DA SILVA');
    expect(r['voce tem cad unico']).toBe('Sim');
    expect(r['quantas pessoas moram na casa']).toBe('4');
  });

  it('devolve vazio para o lead da planilha, que não traz respostas', () => {
    expect(respostasDoLead(NOTES_DA_PLANILHA)).toEqual({});
    expect(respostasDoLead(null)).toEqual({});
  });

  it('não confunde linha comum com resposta', () => {
    const r = respostasDoLead('Cidade: Teresina\nfacebook_lead_id: 123');
    expect(r).toEqual({});
  });
});

describe('nomeDaCrianca', () => {
  it('acha o nome por pedaço, em qualquer redação do formulário', () => {
    expect(nomeDaCrianca({ 'qual o nome da crianca': 'Maria Clara' })).toBe('Maria');
    expect(nomeDaCrianca({ 'nome do seu filho': 'pedro henrique' })).toBe('Pedro');
    expect(nomeDaCrianca({ 'qual o nome do beneficiario': 'ANA' })).toBe('Ana');
  });

  it('não confunde o nome da MÃE com o da criança', () => {
    // O formulário também pergunta o nome do responsável. Casar frouxo aqui
    // faria o acolhedor chamar a mãe pelo próprio nome como se fosse o filho.
    expect(nomeDaCrianca({ 'nome completo': 'Fernanda Souza' })).toBe('');
    expect(nomeDaCrianca({ 'qual o seu nome': 'Fernanda Souza' })).toBe('');
  });

  it('devolve vazio quando a resposta não é nome de gente', () => {
    expect(nomeDaCrianca({ 'nome da crianca': '4' })).toBe('');
    expect(nomeDaCrianca({ 'nome da crianca': '-' })).toBe('');
    expect(nomeDaCrianca({})).toBe('');
  });
});

describe('primeiroNome', () => {
  it('reduz ao primeiro nome, com inicial maiúscula', () => {
    expect(primeiroNome('JOÃO PEDRO DA SILVA SANTOS')).toBe('João');
    expect(primeiroNome('  maria   clara ')).toBe('Maria');
  });
});

describe('montarMensagemInicial', () => {
  it('usa o nome da criança quando ele existe', () => {
    expect(montarMensagemInicial({ crianca: 'João Pedro' })).toBe('Oi, é a mamãe do João?');
  });

  it('SEM nome, cai no texto sem nome — nunca deixa o marcador vazar', () => {
    const msg = montarMensagemInicial({ crianca: '' });
    expect(msg).toBe(TEMPLATE_PADRAO_SEM_CRIANCA);
    expect(msg).not.toContain('{crianca}');
  });

  it('template personalizado sem nome também não vaza o marcador', () => {
    const msg = montarMensagemInicial({
      crianca: null,
      templateComCrianca: 'Oi! É a mãe do {crianca}?',
      templateSemCrianca: 'Oi! Tudo bem? {crianca}',
    });
    expect(msg).not.toContain('{crianca}');
    expect(msg).toBe('Oi! Tudo bem?');
  });

  it('respeita o template configurado no banco', () => {
    expect(
      montarMensagemInicial({ crianca: 'Ana', templateComCrianca: 'Oi, falo com a mãe da {crianca}?' }),
    ).toBe('Oi, falo com a mãe da Ana?');
  });
});

describe('telefoneParaLink', () => {
  it('aceita o número já com DDI', () => {
    expect(telefoneParaLink('5586999998888')).toBe('5586999998888');
    expect(telefoneParaLink('(86) 99999-8888')).toBe('5586999998888');
  });

  it('completa o 55 quando veio DDD + número', () => {
    expect(telefoneParaLink('86999998888')).toBe('5586999998888');
    expect(telefoneParaLink('8633334444')).toBe('558633334444');
  });

  it('NÃO inventa DDD — número sem DDD não vira link', () => {
    // Completar por conta própria manda mensagem de cliente para o celular de
    // outra pessoa. 45 leads por mês chegam assim (doc planilhas-lead-ads.md).
    expect(telefoneParaLink('999998888')).toBe('');
    expect(telefoneParaLink('')).toBe('');
    expect(telefoneParaLink(null)).toBe('');
  });
});

describe('linkWaMe', () => {
  it('abre a conversa certa com o texto pronto e codificado', () => {
    const link = linkWaMe('86999998888', 'Oi, é a mamãe do João?');
    expect(link).toBe('https://wa.me/5586999998888?text=Oi%2C%20%C3%A9%20a%20mam%C3%A3e%20do%20Jo%C3%A3o%3F');
  });

  it('sem telefone utilizável não devolve link quebrado', () => {
    expect(linkWaMe('123', 'oi')).toBe('');
  });
});

describe('telefoneLegivel', () => {
  it('formata para leitura humana', () => {
    expect(telefoneLegivel('5586999998888')).toBe('(86) 99999-8888');
    expect(telefoneLegivel('558633334444')).toBe('(86) 3333-4444');
  });
});

describe('montarAviso', () => {
  const lead = {
    lead_id: 'abc',
    nome: 'Fernanda Souza',
    telefone: '5586999998888',
    criado_em: '2026-09-14T12:30:00.000Z',
    campanha: 'BPC Autismo — Setembro',
    notes: NOTES_DA_API,
  };

  it('traz quem é, o telefone, a qualificação e o link pronto', () => {
    const a = montarAviso(lead);
    expect(a.crianca).toBe('João');
    expect(a.mensagem_inicial).toBe('Oi, é a mamãe do João?');
    expect(a.texto).toContain('Fernanda Souza');
    expect(a.texto).toContain('(86) 99999-8888');
    expect(a.texto).toContain('Já recebe BPC: Não');
    expect(a.texto).toContain('Renda da família: Até 1 salário mínimo');
    expect(a.texto).toContain('CadÚnico: Sim');
    expect(a.texto).toContain('https://wa.me/5586999998888?text=');
    expect(a.falta_telefone).toBe(false);
    expect(a.texto).not.toContain('{crianca}');
  });

  it('lead da planilha (sem respostas) ainda vira aviso, dizendo o que falta', () => {
    const a = montarAviso({ ...lead, notes: NOTES_DA_PLANILHA });
    expect(a.crianca).toBe('');
    expect(a.mensagem_inicial).toBe(TEMPLATE_PADRAO_SEM_CRIANCA);
    expect(a.texto).toContain('o formulário não trouxe o nome');
    expect(a.texto).toContain('https://wa.me/');
  });

  it('sem telefone utilizável o aviso SAI, com o alerta no lugar do link', () => {
    // Engolir o aviso aqui transformaria um lead problemático em lead que
    // ninguém sabe que existe.
    const a = montarAviso({ ...lead, telefone: '99999' });
    expect(a.falta_telefone).toBe(true);
    expect(a.link).toBe('');
    expect(a.texto).toContain('Sem telefone utilizável');
  });
});

describe('dentroDoHorario', () => {
  it('deixa passar dentro da janela e barra de madrugada (Brasília)', () => {
    // 2026-09-14T13:00Z = 10h em Brasília; 2026-09-14T06:00Z = 3h.
    expect(dentroDoHorario(new Date('2026-09-14T13:00:00Z'), 7, 21)).toBe(true);
    expect(dentroDoHorario(new Date('2026-09-14T06:00:00Z'), 7, 21)).toBe(false);
    // 2026-09-15T00:30Z = 21h30 em Brasília — já fora.
    expect(dentroDoHorario(new Date('2026-09-15T00:30:00Z'), 7, 21)).toBe(false);
  });
});

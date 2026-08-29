import { describe, it, expect } from 'vitest';
import { detectClassificationFromName } from '../detectClassificationFromName';

// Nomes reais da lista de contatos (25/08/2026) — o relacionamento estava
// escrito no nome e o campo mostrava "Sem status".
const TODOS = [
  'client', 'non_client', 'prospect', 'partner', 'supplier', 'ponte', 'ex_cliente',
  'advogado_interno', 'advogado_externo', 'advogado_adverso', 'parte_contraria',
  'prestador_servico', 'equipe_interna',
];

const slugs = (nome: string, disponiveis: string[] = TODOS) =>
  detectClassificationFromName(nome, disponiveis).map((h) => h.slug);

describe('detectClassificationFromName', () => {
  it('lê o papel escrito no nome, com ou sem acento e no feminino', () => {
    expect(slugs('Alex motorista parceiro Ibirarema/SP')).toEqual(['partner']);
    expect(slugs('Elaine uber parceira Itatiba/SP')).toEqual(['partner']);
    expect(slugs('Cristiano - Encarregado LT - Parceiro - Timon/MA')).toEqual(['partner']);
    expect(slugs('Fornecedora de brindes')).toEqual(['supplier']);
  });

  it('devolve mais de um papel quando o nome traz mais de um', () => {
    expect(slugs('Yuban cliente parceiro Manaus/AM').sort()).toEqual(['client', 'partner']);
  });

  it('ex-cliente e não-cliente não viram cliente', () => {
    expect(slugs('João ex-cliente 2024')).toEqual(['ex_cliente']);
    expect(slugs('Maria ex cliente')).toEqual(['ex_cliente']);
    expect(slugs('Pedro não-cliente')).toEqual(['non_client']);
    expect(slugs('Ana nao cliente')).toEqual(['non_client']);
  });

  it('separa os tipos de advogado antes de cair no genérico', () => {
    expect(slugs('Dr. Silva adv adverso')).toEqual(['advogado_adverso']);
    expect(slugs('Dra. Paula advogada interna')).toEqual(['advogado_interno']);
    expect(slugs('Dr. Rocha advogado externo')).toEqual(['advogado_externo']);
    expect(slugs('Carlos parte contrária processo 123')).toEqual(['parte_contraria']);
  });

  // O que é ambíguo fica para a IA — chute aqui vira status errado em massa.
  it('não chuta em nome de cidade, sobrenome ou papel genérico', () => {
    expect(slugs('Marcos Ponte Nova/MG')).toEqual([]);
    expect(slugs('Dr. João Advogado')).toEqual([]);
    expect(slugs('Roberto Clientelismo')).toEqual([]);
    expect(slugs('Fernanda Silva')).toEqual([]);
    expect(slugs('')).toEqual([]);
  });

  it('só devolve status que existe no workspace', () => {
    expect(slugs('Alex parceiro', ['client', 'prospect'])).toEqual([]);
    expect(slugs('Alex parceiro', ['partner'])).toEqual(['partner']);
  });

  it('mostra o trecho que denunciou o papel', () => {
    expect(detectClassificationFromName('Alex motorista parceiro Ibirarema/SP', TODOS))
      .toEqual([{ slug: 'partner', matched: 'parceiro' }]);
  });
});

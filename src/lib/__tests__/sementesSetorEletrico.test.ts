import { describe, it, expect } from 'vitest';
import {
  SEMENTES_SETOR_ELETRICO,
  sementesPorPrioridade,
  acharSemente,
} from '../../../supabase/functions/_shared/sementesSetorEletrico';

const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]);

describe('integridade da lista de sementes', () => {
  it('não tem nome duplicado', () => {
    const nomes = SEMENTES_SETOR_ELETRICO.map((s) => s.nome.toLowerCase());
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it('toda UF declarada existe de verdade', () => {
    const invalidas = SEMENTES_SETOR_ELETRICO.flatMap((s) =>
      s.ufs.filter((uf) => !UFS_VALIDAS.has(uf)).map((uf) => `${s.nome}: ${uf}`),
    );
    expect(invalidas).toEqual([]);
  });

  it('toda semente tem pelo menos uma UF', () => {
    const semUf = SEMENTES_SETOR_ELETRICO.filter((s) => !s.ufs.length).map((s) => s.nome);
    expect(semUf).toEqual([]);
  });

  // O CNPJ é o campo que torna a busca exata. Enquanto for null, a varredura
  // cai em busca por nome, que casa por similaridade. Este teste não exige
  // CNPJ — registra que hoje NENHUM está preenchido, para que o dia em que
  // alguém preencher o primeiro seja uma mudança consciente.
  it('nenhum CNPJ preenchido ainda (nada foi verificado na Receita)', () => {
    const comCnpj = SEMENTES_SETOR_ELETRICO.filter((s) => s.cnpj !== null);
    expect(comCnpj.map((s) => s.nome)).toEqual([]);
  });

  it('CNPJ, quando existir, tem 14 dígitos', () => {
    for (const s of SEMENTES_SETOR_ELETRICO) {
      if (s.cnpj !== null) expect(s.cnpj.replace(/\D/g, '')).toHaveLength(14);
    }
  });
});

describe('sementesPorPrioridade', () => {
  it('prioridade 1 vem antes de 2 e 3', () => {
    const ordem = sementesPorPrioridade().map((s) => s.prioridade);
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
  });

  it('dentro da mesma prioridade, quem cobre mais UF vem primeiro', () => {
    const p1 = sementesPorPrioridade({ prioridadeMaxima: 1 });
    const larguras = p1.map((s) => s.ufs.length);
    expect(larguras).toEqual([...larguras].sort((a, b) => b - a));
  });

  it('filtra por UF', () => {
    const naBahia = sementesPorPrioridade({ uf: 'BA' });
    expect(naBahia.length).toBeGreaterThan(0);
    expect(naBahia.every((s) => s.ufs.includes('BA'))).toBe(true);
  });

  it('filtra por UF sem depender de caixa', () => {
    expect(sementesPorPrioridade({ uf: 'ba' }).length)
      .toBe(sementesPorPrioridade({ uf: 'BA' }).length);
  });

  it('filtra por tipo', () => {
    const terc = sementesPorPrioridade({ tipo: 'terceirizada' });
    expect(terc.every((s) => s.tipo === 'terceirizada')).toBe(true);
    expect(terc.length).toBeGreaterThan(0);
  });

  it('UF inexistente devolve lista vazia, não quebra', () => {
    expect(sementesPorPrioridade({ uf: 'ZZ' })).toEqual([]);
  });

  // As terceirizadas são o alvo primário: elas são a empregadora, então
  // figuram como ré principal na ação do acidentado. Concessionária entra por
  // subsidiária e traz muito processo que não é acidente.
  it('as de prioridade 1 são todas terceirizadas', () => {
    const p1 = sementesPorPrioridade({ prioridadeMaxima: 1 });
    expect(p1.every((s) => s.tipo === 'terceirizada')).toBe(true);
  });
});

describe('acharSemente', () => {
  it('acha sem depender de caixa', () => {
    expect(acharSemente('sirtec sistemas eletricos')?.prioridade).toBe(1);
    expect(acharSemente('SIRTEC SISTEMAS ELETRICOS')?.prioridade).toBe(1);
  });

  it('acha mesmo se quem digitou usou acento', () => {
    expect(acharSemente('Sirtec Sistemas Elétricos')?.nome).toBe('Sirtec Sistemas Eletricos');
  });

  it('nome desconhecido devolve null', () => {
    expect(acharSemente('Empresa Que Nao Existe')).toBeNull();
  });
});

// Responsável é do PROCESSO (lead_processes.responsible_user_id) e cada processo
// do caso pode ter o seu. Só ~10% dos processos têm esse campo preenchido hoje —
// o resto herda o responsável processual do lead, e isso precisa ficar explícito.
import { describe, it, expect, vi } from 'vitest';

// remapToCloudSync sem cache carregado devolve o próprio uuid (caso de identidade).
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  ensureRemapCache: vi.fn(),
  remapToCloudSync: (ext: string) => ext,
}));
vi.mock('@/integrations/supabase', () => ({ db: {}, ensureExternalSession: vi.fn() }));

import { buildCaseOwners, RawOwners, CaseOwnerPerson } from '../useCaseOwners';

const people: CaseOwnerPerson[] = [
  { user_id: 'jp', full_name: 'João Pedro Alvarenga Pereira de Sá', email: 'jp@x.com' },
  { user_id: 'lydia', full_name: 'Maria Lydia Ribeiro', email: 'lydia@x.com' },
  { user_id: 'israel', full_name: 'Israel de Jesus Carvalho Filho', email: 'israel@x.com' },
];

const base: RawOwners = {
  leadId: 'lead-1',
  leadName: 'Caso 35- Rozália SP',
  leadResponsibleExtId: null,
  processes: [],
  namesByExtId: {},
  acolhedorText: null,
};

describe('buildCaseOwners', () => {
  it('lista um responsável por processo quando eles diferem', () => {
    const owners = buildCaseOwners({
      ...base,
      leadResponsibleExtId: 'jp',
      processes: [
        { processId: 'p1', processLabel: 'CUMPRIMENTO DE SENTENÇA', responsibleExtId: 'jp', inherited: false },
        { processId: 'p2', processLabel: 'SEGURO DE VIDA JUDICIAL', responsibleExtId: 'lydia', inherited: false },
      ],
      namesByExtId: { jp: 'João Pedro Alvarenga Pereira de Sá', lydia: 'Maria Lydia Ribeiro' },
    }, people);

    expect(owners.map(o => o.name)).toEqual([
      'João Pedro Alvarenga Pereira de Sá',
      'Maria Lydia Ribeiro',
    ]);
    expect(owners[0].detail).toBe('CUMPRIMENTO DE SENTENÇA');
    expect(owners[1].detail).toBe('SEGURO DE VIDA JUDICIAL');
    expect(owners.every(o => o.roles.includes('responsavel'))).toBe(true);
  });

  it('agrupa num item só quando os processos são da mesma pessoa e marca herdado', () => {
    // Exatamente o Caso 35 da base: 3 processos, nenhum com responsável próprio.
    const owners = buildCaseOwners({
      ...base,
      leadResponsibleExtId: 'jp',
      processes: [
        { processId: 'p1', processLabel: 'CUMPRIMENTO DE SENTENÇA', responsibleExtId: 'jp', inherited: true },
        { processId: 'p2', processLabel: 'Procedimento Comum Cível', responsibleExtId: 'jp', inherited: true },
        { processId: 'p3', processLabel: 'SEGURO DE VIDA JUDICIAL', responsibleExtId: 'jp', inherited: true },
      ],
      namesByExtId: { jp: 'João Pedro Alvarenga Pereira de Sá' },
    }, people);

    expect(owners).toHaveLength(1);
    expect(owners[0].detail).toBe('3 processos · herdado do caso');
  });

  it('caso sem processo cadastrado cai no responsável do lead', () => {
    const owners = buildCaseOwners({
      ...base,
      leadResponsibleExtId: 'lydia',
      namesByExtId: { lydia: 'Maria Lydia Ribeiro' },
    }, people);

    expect(owners).toHaveLength(1);
    expect(owners[0].detail).toBe('responsável do caso');
    expect(owners[0].userId).toBe('lydia');
  });

  it('acolhedor vem depois dos responsáveis e funde papéis se for a mesma pessoa', () => {
    const doisPapeis = buildCaseOwners({
      ...base,
      leadResponsibleExtId: 'israel',
      namesByExtId: { israel: 'Israel de Jesus Carvalho Filho' },
      acolhedorText: 'Israel',
    }, people);
    expect(doisPapeis).toHaveLength(1);
    expect(doisPapeis[0].roles).toEqual(['responsavel', 'acolhedor']);

    const separados = buildCaseOwners({
      ...base,
      leadResponsibleExtId: 'jp',
      namesByExtId: { jp: 'João Pedro Alvarenga Pereira de Sá' },
      acolhedorText: 'Atendimento Previdenciário',
    }, people);
    expect(separados.map(o => o.roles[0])).toEqual(['responsavel', 'acolhedor']);
    // apelido genérico não vira menção
    expect(separados[1].userId).toBeNull();
    expect(separados[1].name).toBe('Atendimento Previdenciário');
  });

  it('processo sem responsável e lead sem responsável não inventa ninguém', () => {
    expect(buildCaseOwners(base, people)).toEqual([]);
  });
});

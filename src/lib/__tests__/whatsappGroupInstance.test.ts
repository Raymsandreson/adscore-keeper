/**
 * Incidente 17/08/2026 — áudio do grupo morria com "WhatsApp instance is
 * disconnected".
 *
 * O grupo "Família 293 | Edison x Injeplast" (`120363420845065913@g.us`) é
 * espelhado por 8 instâncias. A escolhida foi a **Atendimento Previdenciário**,
 * por três motivos somados:
 *  1. era a primeira da lista fixa de preferidas;
 *  2. estava DESCONECTADA — e nada checava isso;
 *  3. tinha parado de espelhar o grupo 6 dias antes, passando raspando pela
 *     trava de 7 dias.
 * A **Atendimento Processual** estava conectada e espelhando o grupo no mesmo
 * minuto, e o lead tem processo na Justiça do Trabalho (`…2025.5.05.0195`).
 *
 * Os dados abaixo são os reais medidos no Externo naquele dia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeClient, setTabela, setStatus, resetTudo, chamadas } = vi.hoisted(() => {
  const tabelas: Record<string, unknown[]> = {};
  let status: unknown[] = [];
  const chamadas = { status: 0 };

  const chain = (table: string): any => {
    const p: any = Promise.resolve({ data: tabelas[table] ?? [], error: null });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        return () => chain(table);
      },
      apply: () => chain(table),
    });
  };

  return {
    chamadas,
    resetTudo: () => {
      for (const k of Object.keys(tabelas)) delete tabelas[k];
      status = [];
      chamadas.status = 0;
    },
    setTabela: (t: string, linhas: unknown[]) => { tabelas[t] = linhas; },
    setStatus: (linhas: unknown[]) => { status = linhas; },
    fakeClient: {
      from: (t: string) => chain(t),
      invoke: async () => { chamadas.status += 1; return { data: status, error: null }; },
    },
  };
});

vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/lib/functionRouter', () => ({
  cloudFunctions: { invoke: (...a: unknown[]) => fakeClient.invoke(...(a as [])) },
}));

const GRUPO = '120363420845065913@g.us';

/** Espelhos reais do grupo, do mais recente para o mais antigo. */
const ESPELHOS = [
  { instance_name: 'Analyne Oliveira', created_at: '2026-08-17T16:04:00-03:00' },
  { instance_name: 'Atendimento Processual', created_at: '2026-08-17T16:04:00-03:00' },
  { instance_name: 'Raym', created_at: '2026-08-17T16:04:00-03:00' },
  { instance_name: 'João Manoel- Acolhedor', created_at: '2026-08-17T16:04:00-03:00' },
  { instance_name: 'Luiz Abraci', created_at: '2026-08-17T16:04:00-03:00' },
  { instance_name: 'Atendimento Previdenciário', created_at: '2026-08-11T16:18:00-03:00' },
  { instance_name: 'Dom', created_at: '2026-06-22T11:42:00-03:00' },
  { instance_name: 'Luana Gerente', created_at: '2026-06-02T16:27:00-03:00' },
];

/** Status real medido: das membros, só a Previdenciário estava fora. */
const STATUS_REAL = [
  { instance_name: 'Analyne Oliveira', connected: true },
  { instance_name: 'Atendimento Processual', connected: true },
  { instance_name: 'Raym', connected: true },
  { instance_name: 'João Manoel- Acolhedor', connected: true },
  { instance_name: 'Luiz Abraci', connected: true },
  { instance_name: 'Atendimento Previdenciário', connected: false },
  { instance_name: 'Atendimento Previdenciário 2', connected: true },
  { instance_name: 'Dom', connected: false },
  { instance_name: 'Luana Gerente', connected: false },
];

const PROC_TRABALHISTA = { process_number: '0001026-93.2025.5.05.0195' };
const PROC_ESTADUAL = { process_number: '8001830-75.2025.8.05.0064' };

async function resolver() {
  // Import dinâmico: o módulo guarda cache de status entre chamadas.
  vi.resetModules();
  const mod = await import('../whatsappGroupInstance');
  return mod.resolveGroupSenderInstanceName(GRUPO);
}

describe('resolveGroupSenderInstanceName', () => {
  beforeEach(() => {
    resetTudo();
    setTabela('whatsapp_messages', ESPELHOS);
    setTabela('lead_whatsapp_groups', [{ lead_id: 'lead-293' }]);
    setTabela('lead_processes', [PROC_TRABALHISTA, PROC_ESTADUAL]);
    setStatus(STATUS_REAL);
  });

  it('grupo trabalhista sai pela Processual, não pela Previdenciário desconectada', async () => {
    await expect(resolver()).resolves.toBe('Atendimento Processual');
  });

  it('nunca escolhe instância desconectada', async () => {
    // Sem a Processual no grupo, a Previdenciário (offline) não pode ganhar:
    // sobra o espelho mais recente entre as conectadas.
    setTabela('whatsapp_messages', ESPELHOS.filter(e => e.instance_name !== 'Atendimento Processual'));

    const escolhida = await resolver();

    expect(escolhida).not.toBe('Atendimento Previdenciário');
    expect(['Analyne Oliveira', 'Raym', 'João Manoel- Acolhedor', 'Luiz Abraci']).toContain(escolhida);
  });

  it('sem processo trabalhista, mantém a ordem antiga (Previdenciário primeiro)', async () => {
    setTabela('lead_processes', [PROC_ESTADUAL]);
    // Previdenciário 2 é membro e está conectada; a 1 segue offline.
    setTabela('whatsapp_messages', [
      { instance_name: 'Atendimento Processual', created_at: '2026-08-17T16:04:00-03:00' },
      { instance_name: 'Atendimento Previdenciário 2', created_at: '2026-08-17T16:00:00-03:00' },
    ]);

    await expect(resolver()).resolves.toBe('Atendimento Previdenciário 2');
  });

  it('trabalhista inverte o desempate entre as duas institucionais', async () => {
    setTabela('whatsapp_messages', [
      { instance_name: 'Atendimento Processual', created_at: '2026-08-17T16:04:00-03:00' },
      { instance_name: 'Atendimento Previdenciário 2', created_at: '2026-08-17T16:00:00-03:00' },
    ]);

    await expect(resolver()).resolves.toBe('Atendimento Processual');
  });

  it('instância que sumiu do grupo há mais de 7 dias não é escolhida', async () => {
    setTabela('lead_processes', [PROC_ESTADUAL]);
    setTabela('whatsapp_messages', [
      { instance_name: 'Raym', created_at: '2026-08-17T16:04:00-03:00' },
      // Conectada, preferida na ordem padrão, mas fora do grupo há ~2 meses.
      { instance_name: 'Atendimento Previdenciário 2', created_at: '2026-06-10T09:00:00-03:00' },
    ]);

    await expect(resolver()).resolves.toBe('Raym');
  });

  it('se a checagem de status não responder, não filtra ninguém (não trava o envio)', async () => {
    setStatus([]);

    // Sem status utilizável, volta ao critério antigo: preferida da área.
    await expect(resolver()).resolves.toBe('Atendimento Processual');
  });

  it('sem histórico do grupo devolve undefined e deixa a edge decidir', async () => {
    setTabela('whatsapp_messages', []);

    await expect(resolver()).resolves.toBeUndefined();
  });
});

describe('ehCnjTrabalhista', () => {
  it('reconhece o 5º campo do CNJ como ramo da Justiça', async () => {
    const { ehCnjTrabalhista } = await import('../whatsappGroupInstance');
    expect(ehCnjTrabalhista('0001026-93.2025.5.05.0195')).toBe(true);   // Trabalho
    expect(ehCnjTrabalhista('8001830-75.2025.8.05.0064')).toBe(false);  // Estadual
    expect(ehCnjTrabalhista('1234567-89.2025.4.01.0000')).toBe(false);  // Federal
    expect(ehCnjTrabalhista('00010269320255050195')).toBe(true);        // só dígitos
    expect(ehCnjTrabalhista('123456')).toBe(false);                     // NB/NUP, não CNJ
    expect(ehCnjTrabalhista(null)).toBe(false);
  });
});

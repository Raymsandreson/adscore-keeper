import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * O caso que motivou o reparo (09/09/2026): o advogado da reclamada mandou no
 * WhatsApp "0000846-69-2025-5-08-00009" — traço no lugar do ponto e um zero a
 * mais na unidade de origem, 21 dígitos. O casamento por número desistia, a
 * atividade caía no vínculo por nome de parte e nascia no lead certo SEM o
 * processo. Sem processo, a mensagem ao cliente saiu com a etapa do funil do
 * lead ("Pós Visita Parceiro · 0%") em vez do POP do processo.
 */

/** Tabelas do Externo que o teste finge ter. Cada caso monta as suas. */
const TABELAS: Record<string, Record<string, unknown>[]> = { lead_processes: [], legal_cases: [], leads: [] };

/** Query builder de mentirinha: só o que o vinculoDaAtividade usa. */
function criarQuery(tabela: string) {
  const filtros: ((r: Record<string, unknown>) => boolean)[] = [];
  let limite = Infinity;
  const linhas = () => (TABELAS[tabela] || []).filter((r) => filtros.every((f) => f(r))).slice(0, limite);
  const q: Record<string, unknown> = {
    select: () => q,
    in: (col: string, vals: unknown[]) => { filtros.push((r) => vals.includes(r[col])); return q; },
    eq: (col: string, val: unknown) => { filtros.push((r) => r[col] === val); return q; },
    is: (col: string, val: unknown) => { filtros.push((r) => (r[col] ?? null) === val); return q; },
    ilike: (col: string, padrao: string) => {
      const alvo = padrao.replace(/%/g, '').toLowerCase();
      filtros.push((r) => String(r[col] ?? '').toLowerCase().includes(alvo));
      return q;
    },
    or: (expr: string) => {
      const alvo = (expr.match(/%(.+?)%/)?.[1] || '').toLowerCase();
      filtros.push((r) => ['polo_ativo', 'polo_passivo']
        .some((c) => String(r[c] ?? '').toLowerCase().includes(alvo)));
      return q;
    },
    limit: (n: number) => { limite = n; return q; },
    maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve({ data: linhas(), error: null }).then(ok, falha),
  };
  return q;
}

vi.mock('@/integrations/supabase', () => ({
  db: { from: (t: string) => criarQuery(t) },
  ensureExternalSession: vi.fn(async () => {}),
}));

const { acharVinculoDaAtividade } = await import('../vinculoDaAtividade');

const PROCESSO = {
  id: 'proc-307',
  title: 'Ação de Indenização',
  process_number: '0000846-69.2025.5.08.0009',
  case_id: 'caso-307',
  lead_id: 'lead-307',
  workflow_id: 'pop-trabalhista',
  polo_ativo: 'R. W. S.',
  polo_passivo: 'E. S. E.',
  deleted_at: null,
};
const CASO = { id: 'caso-307', title: 'CASO 307', case_number: '307' };
const LEAD = { id: 'lead-307', lead_name: 'FAMILIA 307 | Belem/PA| Ronald x Engbel Engenharia' };

beforeEach(() => {
  TABELAS.lead_processes = [{ ...PROCESSO }];
  TABELAS.legal_cases = [{ ...CASO }];
  TABELAS.leads = [{ ...LEAD }];
});

describe('acharVinculoDaAtividade', () => {
  it('vincula direto quando o número veio certo', async () => {
    const v = await acharVinculoDaAtividade({ processNumber: '0000846-69.2025.5.08.0009' });
    expect(v?.origem).toBe('numero');
    expect(v?.process_id).toBe('proc-307');
    expect(v?.case_id).toBe('caso-307');
    expect(v?.workflow_id).toBe('pop-trabalhista');
    expect(v?.precisaConfirmar).toBeFalsy();
  });

  it('acha o processo do número torto, mas pede confirmação em vez de vincular', async () => {
    const v = await acharVinculoDaAtividade({
      processNumber: '0000846-69-2025-5-08-00009',
      partyNames: ['Engbel Engenharia'],
    });
    expect(v?.origem).toBe('numero-corrigido');
    expect(v?.precisaConfirmar).toBe(true);
    expect(v?.numeroLido).toBe('0000846-69-2025-5-08-00009');
    expect(v?.numeroAchado).toBe('0000846-69.2025.5.08.0009');
    expect(v?.process_id).toBe('proc-307');
    // O caso e o lead vêm junto — é o pacote que o assessor confirma de uma vez.
    expect(v?.case_title).toBe('CASO 307');
    expect(v?.lead_id).toBe('lead-307');
  });

  it('número torto sem processo correspondente não vira processo por parte errada', async () => {
    TABELAS.lead_processes = [];
    const v = await acharVinculoDaAtividade({
      processNumber: '0000846-69-2025-5-08-00009',
      partyNames: ['Engbel Engenharia'],
    });
    // Sobra o lead, que é o fallback antigo — e nenhum processo inventado.
    expect(v?.process_id).toBeUndefined();
    expect(v?.lead_id).toBe('lead-307');
    expect(v?.origem).toBe('parte');
  });

  it('não sugere nada quando nenhum candidato fecha o dígito verificador', async () => {
    const v = await acharVinculoDaAtividade({ processNumber: '123456789012345678901' });
    expect(v).toBeNull();
  });

  it('ficha gravada sem máscara também casa pelo número torto', async () => {
    TABELAS.lead_processes = [{ ...PROCESSO, process_number: '00008466920255080009' }];
    const v = await acharVinculoDaAtividade({ processNumber: '0000846-69-2025-5-08-00009' });
    expect(v?.precisaConfirmar).toBe(true);
    expect(v?.numeroAchado).toBe('00008466920255080009');
  });
});

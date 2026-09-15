// O adiar do app pergunta aqui antes de gravar pelo cliente. Duas coisas
// precisam ficar presas: quem não manda lista pergunta por si mesmo (é o caso
// comum — a pessoa adiando a própria atividade), e uma consulta que falhou
// jamais pode chegar ao app como "não há ausência".
import { describe, it, expect, vi, beforeEach } from 'vitest';

const estado = {
  ausencias: { conflitos: [] as unknown[], verificado: true },
  autor: { cloudUserId: 'cloud-autor', extUserId: 'ext-autor' } as { cloudUserId: string; extUserId: string } | null,
  perguntou: null as { ids: unknown; data: unknown } | null,
};

vi.mock('../../lib/ausencias', () => ({
  consultarAusencias: async (ids: unknown, data: unknown) => {
    estado.perguntou = { ids, data };
    return estado.ausencias;
  },
}));

vi.mock('../../lib/identidadeDoApp', () => ({
  autorDaRequisicao: async () => estado.autor,
  paraExterno: async (id: string | null) => id,
}));

import { handler } from '../check-time-off';

async function chamar(body: Record<string, unknown>) {
  let corpo: any = null;
  let status = 0;
  const res: any = { status: (s: number) => { status = s; return res; }, json: (b: any) => { corpo = b; return res; } };
  await handler({ headers: { authorization: 'Bearer x' }, body } as any, res, (() => {}) as any);
  return { corpo, status };
}

beforeEach(() => {
  estado.ausencias = { conflitos: [], verificado: true };
  estado.autor = { cloudUserId: 'cloud-autor', extUserId: 'ext-autor' };
  estado.perguntou = null;
});

describe('check-time-off', () => {
  it('lista vazia pergunta pelo autor do JWT', async () => {
    await chamar({ date: '2026-09-25' });
    expect(estado.perguntou?.ids).toEqual(['cloud-autor']);
  });

  it('lista informada é respeitada', async () => {
    await chamar({ user_ids: ['c1', 'c2'], date: '2026-09-25' });
    expect(estado.perguntou?.ids).toEqual(['c1', 'c2']);
  });

  it('devolve os conflitos como vieram da regra', async () => {
    estado.ausencias = { conflitos: [{ user_name: 'Fulana', descricao: 'Férias de 20/09/2026 a 30/09/2026' }], verificado: true };
    const { corpo, status } = await chamar({ date: '2026-09-25' });
    expect(status).toBe(200);
    expect(corpo.success).toBe(true);
    expect(corpo.conflicts).toHaveLength(1);
    expect(corpo).not.toHaveProperty('ausencia_nao_verificada');
  });

  it('consulta falhada avisa, e não se disfarça de "não há ausência"', async () => {
    estado.ausencias = { conflitos: [], verificado: false };
    const { corpo } = await chamar({ date: '2026-09-25' });
    expect(corpo).toEqual({ success: true, conflicts: [], ausencia_nao_verificada: true });
  });

  it('sem JWT válido não responde conflito nenhum', async () => {
    estado.autor = null;
    const { corpo } = await chamar({ date: '2026-09-25' });
    expect(corpo).toEqual({ success: false, error: 'nao_autenticado' });
    expect(estado.perguntou).toBeNull();
  });
});

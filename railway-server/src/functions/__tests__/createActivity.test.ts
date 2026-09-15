// O endpoint existe porque o cliente NÃO consegue resolver dois casos: a
// resposta que se perde (o insert chegou, a confirmação não voltou) e dois
// aparelhos criando a mesma coisa. Estes testes prendem as decisões que
// respondem a isso — e a ordem entre elas, que é onde é fácil errar sem que
// apareça: um retry barrado por dedup ou por férias seria a duplicata voltando
// como erro.
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Linha { id: string; title: string; activity_type: string; lead_id: string | null; case_id: string | null; process_id: string | null }

/** Estado que cada teste ajusta antes de chamar o handler. */
const estado = {
  porClientRequestId: null as string | null,
  recentes: [] as Linha[],
  erroDoInsert: null as { code?: string; message: string } | null,
  idCriado: 'nova-1',
  inserido: null as Record<string, unknown> | null,
  ausencias: { conflitos: [] as unknown[], verificado: true },
  autor: { cloudUserId: 'cloud-autor', extUserId: 'ext-autor' } as { cloudUserId: string; extUserId: string } | null,
};

vi.mock('../../lib/supabase', () => {
  const tabela = (nome: string) => ({
    select: () => {
      const q: any = {
        eq: (col: string, _v: unknown) => {
          if (nome === 'lead_activities' && col === 'client_request_id') {
            return { maybeSingle: async () => ({ data: estado.porClientRequestId ? { id: estado.porClientRequestId } : null }) };
          }
          if (nome === 'profiles') return { maybeSingle: async () => ({ data: { full_name: 'Nome do Perfil' } }) };
          return q;
        },
        is: () => q,
        gte: async () => ({ data: estado.recentes, error: null }),
      };
      return q;
    },
    insert: (linha: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          estado.inserido = linha;
          if (estado.erroDoInsert) return { data: null, error: estado.erroDoInsert };
          return { data: { id: estado.idCriado }, error: null };
        },
      }),
    }),
  });
  return { supabase: { from: (nome: string) => tabela(nome) } };
});

vi.mock('../../lib/ausencias', () => ({
  consultarAusencias: async () => estado.ausencias,
}));

vi.mock('../../lib/identidadeDoApp', () => ({
  autorDaRequisicao: async () => estado.autor,
  paraExterno: async (id: string | null) => (id ? `ext-de-${id}` : null),
}));

import { handler } from '../create-activity';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_LEAD = '22222222-2222-4222-8222-222222222222';

/** Chama o handler e devolve o corpo — o formato da casa é sempre HTTP 200. */
async function chamar(body: Record<string, unknown>) {
  let corpo: any = null;
  let status = 0;
  const res: any = { status: (s: number) => { status = s; return res; }, json: (b: any) => { corpo = b; return res; } };
  await handler({ headers: { authorization: 'Bearer x' }, body } as any, res, (() => {}) as any);
  return { corpo, status };
}

beforeEach(() => {
  estado.porClientRequestId = null;
  estado.recentes = [];
  estado.erroDoInsert = null;
  estado.idCriado = 'nova-1';
  estado.inserido = null;
  estado.ausencias = { conflitos: [], verificado: true };
  estado.autor = { cloudUserId: 'cloud-autor', extUserId: 'ext-autor' };
});

describe('porta de entrada', () => {
  it('responde sempre 200, com o resultado no corpo', async () => {
    const { status, corpo } = await chamar({ title: 'Ligar', is_management: true });
    expect(status).toBe(200);
    expect(corpo.success).toBe(true);
  });

  it('sem JWT válido não grava nada', async () => {
    estado.autor = null;
    const { corpo } = await chamar({ title: 'Ligar', is_management: true });
    expect(corpo).toEqual({ success: false, error: 'nao_autenticado' });
    expect(estado.inserido).toBeNull();
  });

  it('título só de espaço é título vazio', async () => {
    const { corpo } = await chamar({ title: '   ', is_management: true });
    expect(corpo).toEqual({ success: false, error: 'titulo_obrigatorio' });
  });

  it('sem vínculo e sem marca, recusa em vez de gravar órfã', async () => {
    const { corpo } = await chamar({ title: 'Ligar' });
    expect(corpo).toEqual({ success: false, error: 'sem_vinculo' });
    expect(estado.inserido).toBeNull();
  });

  it('vínculo por lead dispensa a marca de gestão', async () => {
    const { corpo } = await chamar({ title: 'Ligar', lead_id: UUID_LEAD });
    expect(corpo.success).toBe(true);
  });
});

describe('idempotência — a resposta que se perde', () => {
  it('o retry devolve a atividade que já existe, sem gravar de novo', async () => {
    estado.porClientRequestId = 'ja-existe';
    const { corpo } = await chamar({ title: 'Ligar', is_management: true, client_request_id: UUID_A });
    expect(corpo).toEqual({ success: true, id: 'ja-existe', duplicated: true });
    expect(estado.inserido).toBeNull();
  });

  it('o retry não é barrado por férias — a atividade dele já existe', async () => {
    estado.porClientRequestId = 'ja-existe';
    estado.ausencias = { conflitos: [{ user_name: 'Fulana' }], verificado: true };
    const { corpo } = await chamar({ title: 'Ligar', is_management: true, deadline: '2026-09-25', client_request_id: UUID_A });
    expect(corpo.duplicated).toBe(true);
    expect(corpo.success).toBe(true);
  });

  it('carimba o client_request_id na linha, senão o próximo retry não acha', async () => {
    await chamar({ title: 'Ligar', is_management: true, client_request_id: UUID_A });
    expect(estado.inserido?.client_request_id).toBe(UUID_A);
  });

  it('client_request_id que não é uuid é ignorado, e a criação segue', async () => {
    const { corpo } = await chamar({ title: 'Ligar', is_management: true, client_request_id: 'nao-e-uuid' });
    expect(corpo.success).toBe(true);
    expect(estado.inserido).not.toHaveProperty('client_request_id');
  });
});

describe('dedup por conteúdo — dois aparelhos', () => {
  const gemea = { id: 'gemea-1', title: 'Ligar para o cliente', activity_type: 'tarefa', lead_id: null, case_id: null, process_id: null };

  it('gêmea de 5 segundos volta como duplicada, não como erro', async () => {
    estado.recentes = [gemea];
    const { corpo } = await chamar({ title: 'Ligar para o cliente', is_management: true });
    expect(corpo).toEqual({ success: true, id: 'gemea-1', duplicated: true });
    expect(estado.inserido).toBeNull();
  });

  it('compara título como o índice: sem caixa e sem espaço nas pontas', async () => {
    estado.recentes = [gemea];
    const { corpo } = await chamar({ title: '  LIGAR PARA O CLIENTE ', is_management: true });
    expect(corpo.duplicated).toBe(true);
  });

  it('mesmo título com vínculo diferente não é gêmea', async () => {
    estado.recentes = [gemea];
    const { corpo } = await chamar({ title: 'Ligar para o cliente', lead_id: UUID_LEAD });
    expect(corpo.duplicated).toBe(false);
  });

  it('mesmo título com tipo diferente não é gêmea', async () => {
    estado.recentes = [gemea];
    const { corpo } = await chamar({ title: 'Ligar para o cliente', is_management: true, activity_type: 'reuniao' });
    expect(corpo.duplicated).toBe(false);
  });
});

describe('ausência registrada', () => {
  it('recusa com os conflitos estruturados, não com a frase pronta', async () => {
    estado.ausencias = {
      conflitos: [{ user_id: 'c1', user_name: 'Fulana', type: 'ferias', start_date: '2026-09-20', end_date: '2026-09-30', descricao: 'Férias de 20/09/2026 a 30/09/2026' }],
      verificado: true,
    };
    const { corpo } = await chamar({ title: 'Ligar', is_management: true, deadline: '2026-09-25' });
    expect(corpo.success).toBe(false);
    expect(corpo.error).toBe('ausencia_registrada');
    expect(corpo.conflicts[0].user_name).toBe('Fulana');
    expect(estado.inserido).toBeNull();
  });

  it('consulta que falhou GRAVA e avisa — falha aberto', async () => {
    estado.ausencias = { conflitos: [], verificado: false };
    const { corpo } = await chamar({ title: 'Ligar', is_management: true, deadline: '2026-09-25' });
    expect(corpo.success).toBe(true);
    expect(corpo.ausencia_nao_verificada).toBe(true);
    expect(estado.inserido).not.toBeNull();
  });

  it('quando conferiu, a flag NÃO aparece — ausência dela é "conferido"', async () => {
    const { corpo } = await chamar({ title: 'Ligar', is_management: true, deadline: '2026-09-25' });
    expect(corpo).not.toHaveProperty('ausencia_nao_verificada');
  });
});

describe('a linha que vai para o banco', () => {
  it('a autoria é do JWT, nunca do corpo', async () => {
    await chamar({ title: 'Ligar', is_management: true, created_by: 'outra-pessoa' });
    expect(estado.inserido?.created_by).toBe('ext-autor');
  });

  it('o responsável default é quem chamou, já traduzido para o Externo', async () => {
    await chamar({ title: 'Ligar', is_management: true });
    expect(estado.inserido?.assigned_to).toBe('ext-de-cloud-autor');
  });

  it('responsável informado entra no espaço do Cloud e é traduzido', async () => {
    await chamar({ title: 'Ligar', is_management: true, assigned_to: UUID_A });
    expect(estado.inserido?.assigned_to).toBe(`ext-de-${UUID_A}`);
  });

  it('nasce pendente e com os defaults do app', async () => {
    await chamar({ title: 'Ligar', is_management: true });
    expect(estado.inserido).toMatchObject({ status: 'pendente', activity_type: 'tarefa', priority: 'normal', action_source: 'manual' });
  });

  it('sem nome do responsável, busca no perfil em vez de gravar nulo', async () => {
    await chamar({ title: 'Ligar', is_management: true });
    expect(estado.inserido?.assigned_to_name).toBe('Nome do Perfil');
  });

  it('guarda o próximo passo e o aviso que o app manda', async () => {
    await chamar({ title: 'Ligar', is_management: true, next_steps: 'Cobrar o laudo', notification_date: '2026-09-25' });
    expect(estado.inserido).toMatchObject({ next_steps: 'Cobrar o laudo', notification_date: '2026-09-25' });
  });
});

describe('23505 — a corrida que a consulta não pega', () => {
  it('dois retries simultâneos: o perdedor devolve a linha do vencedor', async () => {
    estado.erroDoInsert = { code: '23505', message: 'duplicate key' };
    estado.porClientRequestId = null;
    const { corpo } = await chamar({ title: 'Ligar', is_management: true, client_request_id: UUID_A });
    // Na primeira consulta não havia linha; depois do 23505 ela existe.
    expect(corpo.success).toBe(false); // sem linha para achar, o erro é honesto
    estado.porClientRequestId = 'do-vencedor';
    const segunda = await chamar({ title: 'Ligar', is_management: true, client_request_id: UUID_A });
    expect(segunda.corpo).toEqual({ success: true, id: 'do-vencedor', duplicated: true });
  });

  it('23505 do índice de dedup vira duplicated com o id da gêmea', async () => {
    estado.erroDoInsert = { code: '23505', message: 'duplicate key' };
    estado.recentes = [];
    const primeira = await chamar({ title: 'Ligar', lead_id: UUID_LEAD });
    expect(primeira.corpo.success).toBe(false);
    estado.recentes = [{ id: 'gemea-2', title: 'Ligar', activity_type: 'tarefa', lead_id: UUID_LEAD, case_id: null, process_id: null }];
    const segunda = await chamar({ title: 'Ligar', lead_id: UUID_LEAD });
    expect(segunda.corpo).toEqual({ success: true, id: 'gemea-2', duplicated: true });
  });

  it('erro que não é 23505 volta como falha, e não como duplicata', async () => {
    estado.erroDoInsert = { code: '42501', message: 'permission denied' };
    const { corpo } = await chamar({ title: 'Ligar', is_management: true });
    expect(corpo.success).toBe(false);
    expect(corpo.error).toBe('permission denied');
  });
});

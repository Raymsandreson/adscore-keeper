// A sincronia de leitura falha em silêncio nas duas direções: marcar demais
// apaga a fila de quem precisa responder, e marcar de menos não aparece para
// ninguém. Estes testes prendem as regras que não podem afrouxar.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ehGrupoChat,
  emLotes,
  leituraSyncLigada,
  sincronizarLeituraDoChat,
  telefoneDoChat,
  variantesDeTelefone,
} from '../whatsapp-leitura';

interface Chamada { metodo: string; args: any[] }

/** Cadeia do PostgREST: todo método devolve a si mesmo e o fim é aguardável. */
function cadeia(resultado: any, registro: Chamada[]) {
  const obj: any = new Proxy({}, {
    get(_alvo, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return (ok: any, erro: any) => Promise.resolve(resultado).then(ok, erro);
      return (...args: any[]) => { registro.push({ metodo: prop, args }); return obj; };
    },
  });
  return obj;
}

function fakeExt(opcoes: { instancia: any; naoLidas: number }) {
  const registro: Chamada[] = [];
  const estado = { updates: 0 };
  const ext: any = {
    from(tabela: string) {
      if (tabela === 'whatsapp_instances') {
        return { select: () => cadeia({ data: opcoes.instancia, error: null }, registro) };
      }
      return {
        select: (...args: any[]) => {
          registro.push({ metodo: 'select', args });
          return cadeia({ count: opcoes.naoLidas, error: null }, registro);
        },
        update: (...args: any[]) => {
          estado.updates++;
          registro.push({ metodo: 'update', args });
          return cadeia({ count: opcoes.naoLidas, error: null }, registro);
        },
      };
    },
  };
  return { ext, registro, estado };
}

const INSTANCIA = { instance_name: 'Cris', instance_token: 'tok', base_url: null, is_paused: false };

function evento(unread: number | undefined, chatid = '5585999998888@s.whatsapp.net') {
  const chat: any = { wa_chatid: chatid };
  if (unread !== undefined) chat.wa_unreadCount = unread;
  return { EventType: 'chats', instanceName: 'CRIS', token: 'tok', chat };
}

describe('telefoneDoChat — a mesma normalização do webhook', () => {
  it('tira o sufixo do JID de pessoa, de grupo e de @lid', () => {
    expect(telefoneDoChat('5585999998888@s.whatsapp.net')).toBe('5585999998888');
    expect(telefoneDoChat('120363123456789012@g.us')).toBe('120363123456789012');
    expect(telefoneDoChat('5585999998888@lid')).toBe('5585999998888');
  });

  it('come o zero à esquerda, como o webhook faz antes de gravar', () => {
    expect(telefoneDoChat('05585999998888')).toBe('5585999998888');
  });

  it('devolve vazio para lixo, em vez de uma string que casaria com qualquer coisa', () => {
    expect(telefoneDoChat('')).toBe('');
    expect(telefoneDoChat(null)).toBe('');
    expect(telefoneDoChat('@g.us')).toBe('');
  });
});

describe('ehGrupoChat', () => {
  it('reconhece grupo pelo sufixo e pelo comprimento quando ele já foi tirado', () => {
    expect(ehGrupoChat('120363123456789012@g.us')).toBe(true);
    expect(ehGrupoChat('120363123456789012')).toBe(true);
    expect(ehGrupoChat('5585999998888')).toBe(false);
  });

  it('acredita na flag da UazAPI quando ela vem', () => {
    expect(ehGrupoChat('5585999998888', true)).toBe(true);
  });
});

describe('variantesDeTelefone', () => {
  it('cobre as grafias sob as quais a coluna phone pode estar gravada', () => {
    expect(variantesDeTelefone('5585999998888')).toEqual([
      '5585999998888', '5585999998888@g.us', '5585999998888@s.whatsapp.net',
    ]);
  });

  it('não devolve filtro vazio (que casaria com a tabela inteira)', () => {
    expect(variantesDeTelefone('')).toEqual([]);
  });
});

describe('sincronizarLeituraDoChat', () => {
  beforeEach(() => { delete process.env.WHATSAPP_READ_SYNC; vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { delete process.env.WHATSAPP_READ_SYNC; vi.restoreAllMocks(); });

  it('com o gate ligado e contador zerado, marca as não lidas', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, estado } = fakeExt({ instancia: INSTANCIA, naoLidas: 3 });
    const r = await sincronizarLeituraDoChat(ext, evento(0), null);
    expect(r).toMatchObject({ aplicado: true, instancia: 'Cris', telefone: '5585999998888', marcadas: 3 });
    expect(estado.updates).toBe(1);
  });

  it('NUNCA desmarca: contador maior que zero não toca no banco', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, estado, registro } = fakeExt({ instancia: INSTANCIA, naoLidas: 3 });
    const r = await sincronizarLeituraDoChat(ext, evento(4), null);
    expect(r).toEqual({ aplicado: false, motivo: 'chat_ainda_nao_lido' });
    expect(estado.updates).toBe(0);
    expect(registro).toHaveLength(0);
  });

  it('campo ausente não vale por zero — silêncio não é leitura', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, estado } = fakeExt({ instancia: INSTANCIA, naoLidas: 3 });
    const r = await sincronizarLeituraDoChat(ext, evento(undefined), null);
    expect(r.motivo).toBe('payload_sem_unread_count');
    expect(estado.updates).toBe(0);
  });

  it('com o gate desligado, conta e não escreve', async () => {
    const { ext, estado } = fakeExt({ instancia: INSTANCIA, naoLidas: 5 });
    const r = await sincronizarLeituraDoChat(ext, evento(0), null);
    expect(r).toMatchObject({ aplicado: false, motivo: 'gate_desligado', nao_lidas: 5 });
    expect(estado.updates).toBe(0);
    expect(leituraSyncLigada()).toBe(false);
  });

  it('conversa sem pendência nossa não vira UPDATE', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, estado } = fakeExt({ instancia: INSTANCIA, naoLidas: 0 });
    const r = await sincronizarLeituraDoChat(ext, evento(0), null);
    expect(r.motivo).toBe('nada_a_marcar');
    expect(estado.updates).toBe(0);
  });

  it('instância fora do cadastro não marca nada (o UPDATE casaria zero e "daria certo")', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, estado } = fakeExt({ instancia: null, naoLidas: 3 });
    const r = await sincronizarLeituraDoChat(ext, evento(0), null);
    expect(r.motivo).toBe('instancia_desconhecida');
    expect(estado.updates).toBe(0);
  });

  it('instância pausada não escreve', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, estado } = fakeExt({ instancia: { ...INSTANCIA, is_paused: true }, naoLidas: 3 });
    const r = await sincronizarLeituraDoChat(ext, evento(0), null);
    expect(r.motivo).toBe('instancia_pausada');
    expect(estado.updates).toBe(0);
  });

  it('grupo carimba as cópias de TODAS as instâncias — sem filtro de instance_name', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, registro } = fakeExt({ instancia: INSTANCIA, naoLidas: 2 });
    const r = await sincronizarLeituraDoChat(ext, evento(0, '120363123456789012@g.us'), null);
    expect(r).toMatchObject({ aplicado: true, grupo: true });
    const filtrosDeInstancia = registro.filter((c) => c.metodo === 'in' && c.args[0] === 'instance_name');
    expect(filtrosDeInstancia).toHaveLength(0);
  });

  it('conversa de pessoa continua presa à instância dela', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, registro } = fakeExt({ instancia: INSTANCIA, naoLidas: 2 });
    await sincronizarLeituraDoChat(ext, evento(0), null);
    const filtros = registro.filter((c) => c.metodo === 'in' && c.args[0] === 'instance_name');
    expect(filtros.length).toBeGreaterThan(0);
    expect(filtros[0].args[1]).toEqual(['Cris', 'CRIS', 'cris']);
  });

  it('o UPDATE só toca inbound ainda sem read_at, e nada depois do corte', async () => {
    process.env.WHATSAPP_READ_SYNC = 'on';
    const { ext, registro } = fakeExt({ instancia: INSTANCIA, naoLidas: 1 });
    await sincronizarLeituraDoChat(ext, evento(0), null);
    expect(registro.some((c) => c.metodo === 'eq' && c.args[0] === 'direction' && c.args[1] === 'inbound')).toBe(true);
    expect(registro.some((c) => c.metodo === 'is' && c.args[0] === 'read_at' && c.args[1] === null)).toBe(true);
    expect(registro.some((c) => c.metodo === 'lte' && c.args[0] === 'created_at')).toBe(true);
  });
});

describe('emLotes — o teto duplo do retroativo', () => {
  const p = (telefone: string, naoLidas: number) => ({ telefone, naoLidas, grupo: false });

  it('fecha o lote no número de chats', () => {
    const lotes = emLotes([p('1', 1), p('2', 1), p('3', 1)], 2, 1000);
    expect(lotes.map((l) => l.length)).toEqual([2, 1]);
  });

  it('fecha o lote no número de linhas, antes de estourar a transação', () => {
    const lotes = emLotes([p('1', 800), p('2', 800), p('3', 800)], 25, 2000);
    expect(lotes.map((l) => l.length)).toEqual([2, 1]);
  });

  it('chat maior que o teto vai sozinho, em vez de sumir da varredura', () => {
    const lotes = emLotes([p('1', 50_000), p('2', 10)], 25, 2000);
    expect(lotes).toHaveLength(2);
    expect(lotes[0]).toHaveLength(1);
  });

  it('lista vazia não gera lote vazio (que viraria UPDATE sem filtro)', () => {
    expect(emLotes([], 25, 2000)).toEqual([]);
  });
});

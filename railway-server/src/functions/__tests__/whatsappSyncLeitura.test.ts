// A orquestração do retroativo: quem ele pergunta, em que ordem, e o que ele
// escreve. Os helpers puros já estão presos em `lib/__tests__/whatsappLeitura`;
// o que falta prender aqui é o que só aparece quando as três peças se juntam —
// banco, UazAPI e o laço das instâncias.
//
// O fake do PostgREST responde pelos FILTROS que recebeu, e não por um valor
// fixo: é a única forma de um teste notar que o filtro de instância sumiu, que
// é justamente o erro que ninguém vê em produção.
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Update { tabela: string; filtros: Record<string, any> }

const banco = vi.hoisted(() => ({
  instancias: [] as any[],
  /** instância (minúscula) -> linhas de `conversations` */
  conversas: {} as Record<string, Array<{ phone: string; unread_count: number }>>,
  /** telefone -> quantas inbound sem read_at */
  naoLidas: {} as Record<string, number>,
  updates: [] as Update[],
}));

vi.mock('../../lib/supabase', () => {
  function construir(tabela: string, escrita: boolean) {
    const filtros: Record<string, any> = {};
    const alvo: any = new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') {
          return (ok: any, erro: any) => Promise.resolve(resolver(tabela, escrita, filtros)).then(ok, erro);
        }
        return (...args: any[]) => {
          if (typeof args[0] === 'string') filtros[args[0]] = args[1];
          if (prop === 'range') filtros.__range = args;
          return alvo;
        };
      },
    });
    return alvo;
  }

  function resolver(tabela: string, escrita: boolean, filtros: Record<string, any>) {
    if (tabela === 'whatsapp_instances') return { data: banco.instancias, error: null };

    if (tabela === 'conversations') {
      const [inicio] = filtros.__range || [0];
      if (inicio > 0) return { data: [], error: null }; // só uma página nos testes
      const nomes: string[] = (filtros.instance_name || []).map((n: string) => n.toLowerCase());
      const linhas = Object.entries(banco.conversas)
        .filter(([nome]) => nomes.includes(nome.toLowerCase()))
        .flatMap(([, ls]) => ls);
      return { data: linhas, error: null };
    }

    // whatsapp_messages: a contagem sai dos telefones que o filtro pediu.
    const telefones: string[] = filtros.phone || [];
    const count = telefones.reduce((s, t) => s + (banco.naoLidas[t] || 0), 0);
    if (escrita) {
      banco.updates.push({ tabela, filtros: { ...filtros } });
      for (const t of telefones) delete banco.naoLidas[t];
    }
    return { count, error: null };
  }

  return {
    supabase: {
      from: (tabela: string) => ({
        select: () => construir(tabela, false),
        update: () => construir(tabela, true),
      }),
    },
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  };
});

const { handler } = await import('../whatsapp-sync-leitura');

/** O que a UazAPI vai responder em /chat/find nesta rodada. */
let chatsDaUazapi: Array<{ wa_chatid: string; wa_unreadCount: number; wa_isGroup?: boolean }> = [];
let chamadasDeRede: string[] = [];

function responder(corpo: any) {
  return { ok: true, status: 200, text: async () => JSON.stringify(corpo) } as any;
}

async function rodar(body: any = {}) {
  let capturado: any = null;
  const res: any = { json: (x: any) => { capturado = x; return x; } };
  await handler({ body } as any, res, (() => {}) as any);
  return capturado;
}

beforeEach(() => {
  banco.instancias = [{ instance_name: 'Cris', instance_token: 'tok-cris', base_url: 'https://x.uazapi.com' }];
  banco.conversas = {};
  banco.naoLidas = {};
  banco.updates = [];
  chatsDaUazapi = [];
  chamadasDeRede = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    chamadasDeRede.push(String(url));
    if (String(url).endsWith('/chat/find')) return responder({ chats: chatsDaUazapi });
    return responder({});
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reconciliar — a varredura', () => {
  it('instância sem pendência nossa NÃO gasta uma chamada de rede', async () => {
    banco.conversas = { Cris: [] };
    const r = await rodar({ dry_run: false });
    expect(r.success).toBe(true);
    expect(chamadasDeRede).toEqual([]);
    expect(banco.updates).toEqual([]);
  });

  it('marca o chat que o celular deu por lido e deixa o que ainda tem não lida', async () => {
    banco.conversas = { Cris: [{ phone: '5585111', unread_count: 3 }, { phone: '5585222', unread_count: 2 }] };
    banco.naoLidas = { '5585111': 3, '5585222': 2 };
    chatsDaUazapi = [
      { wa_chatid: '5585111@s.whatsapp.net', wa_unreadCount: 0 }, // lido no celular
      { wa_chatid: '5585222@s.whatsapp.net', wa_unreadCount: 2 }, // ainda por ler
    ];

    const r = await rodar({ dry_run: false });

    expect(r.resumo).toMatchObject({ conversas_pendentes: 2, chats_lidos_no_celular: 1 });
    expect(banco.updates).toHaveLength(1);
    expect(banco.updates[0].filtros.phone).toContain('5585111');
    expect(banco.updates[0].filtros.phone).not.toContain('5585222');
  });

  it('dry-run é o padrão: conta e não escreve', async () => {
    banco.conversas = { Cris: [{ phone: '5585111', unread_count: 3 }] };
    banco.naoLidas = { '5585111': 3 };
    chatsDaUazapi = [{ wa_chatid: '5585111@s.whatsapp.net', wa_unreadCount: 0 }];

    const r = await rodar();

    expect(r.dry_run).toBe(true);
    expect(r.resumo.mensagens).toBe('3 seriam marcadas');
    expect(banco.updates).toEqual([]);
  });

  it('grupo é limpo UMA vez para todas as instâncias, sem filtro de instance_name', async () => {
    const grupo = '120363123456789012';
    banco.instancias.push({ instance_name: 'Ana', instance_token: 'tok-ana', base_url: 'https://x.uazapi.com' });
    banco.conversas = {
      Cris: [{ phone: grupo, unread_count: 4 }],
      Ana: [{ phone: grupo, unread_count: 4 }],
    };
    banco.naoLidas = { [grupo]: 8 }; // as cópias das duas instâncias
    chatsDaUazapi = [{ wa_chatid: `${grupo}@g.us`, wa_unreadCount: 0, wa_isGroup: true }];

    await rodar({ dry_run: false });

    expect(banco.updates).toHaveLength(1);
    expect(banco.updates[0].filtros.instance_name).toBeUndefined();
    expect(banco.updates[0].filtros.phone).toContain(grupo);
  });

  it('pendência nossa + nenhum chat lido no celular = veredito de suspeita, não "tudo em dia"', async () => {
    banco.conversas = { Cris: [{ phone: '5585111', unread_count: 3 }] };
    banco.naoLidas = { '5585111': 3 };
    chatsDaUazapi = [{ wa_chatid: '5585111@s.whatsapp.net', wa_unreadCount: 3 }];

    const r = await rodar();

    expect(r.resumo.chats_lidos_no_celular).toBe(0);
    expect(r.veredito).toMatch(/suspeitar do wa_unreadCount/);
  });

  it('campo ausente na UazAPI não vale por zero', async () => {
    banco.conversas = { Cris: [{ phone: '5585111', unread_count: 3 }] };
    banco.naoLidas = { '5585111': 3 };
    chatsDaUazapi = [{ wa_chatid: '5585111@s.whatsapp.net' } as any];

    const r = await rodar({ dry_run: false });

    expect(r.resumo.chats_lidos_no_celular).toBe(0);
    expect(banco.updates).toEqual([]);
  });

  it('limite_chats corta a rodada em vez de varrer tudo', async () => {
    banco.conversas = { Cris: [
      { phone: '5585111', unread_count: 1 },
      { phone: '5585222', unread_count: 1 },
      { phone: '5585333', unread_count: 1 },
    ] };
    banco.naoLidas = { '5585111': 1, '5585222': 1, '5585333': 1 };
    chatsDaUazapi = [
      { wa_chatid: '5585111@s.whatsapp.net', wa_unreadCount: 0 },
      { wa_chatid: '5585222@s.whatsapp.net', wa_unreadCount: 0 },
      { wa_chatid: '5585333@s.whatsapp.net', wa_unreadCount: 0 },
    ];

    const r = await rodar({ dry_run: false, limite_chats: 2 });

    expect(r.resumo.chats_lidos_no_celular).toBe(2);
  });

  it('a linha da API oficial da Meta fica fora da varredura', async () => {
    // `cloud_api_meta` é token de mentira: não há UazAPI atrás dele.
    banco.instancias = [{ instance_name: 'abraci', instance_token: 'cloud_api_meta', base_url: null }];
    banco.conversas = { abraci: [{ phone: '5585111', unread_count: 3 }] };
    banco.naoLidas = { '5585111': 3 };

    const r = await rodar({ dry_run: false });

    // O filtro é do PostgREST (`neq`), que o fake não aplica — o que este teste
    // prende é que o pedido SAIU com ele. Sem isso a rodada bateria num host
    // que não existe e a instância inteira viraria erro.
    expect(r.success).toBe(true);
    expect(chamadasDeRede.filter((u) => u.includes('/chat/find'))).toHaveLength(1);
  });

  it('instância que falha na UazAPI não derruba as outras', async () => {
    banco.instancias.push({ instance_name: 'Ana', instance_token: 'tok-ana', base_url: 'https://y.uazapi.com' });
    banco.conversas = { Cris: [{ phone: '5585111', unread_count: 1 }], Ana: [{ phone: '5585999', unread_count: 1 }] };
    banco.naoLidas = { '5585111': 1, '5585999': 1 };
    chatsDaUazapi = [
      { wa_chatid: '5585111@s.whatsapp.net', wa_unreadCount: 0 },
      { wa_chatid: '5585999@s.whatsapp.net', wa_unreadCount: 0 },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://y.')) return { ok: false, status: 401, text: async () => 'no session' } as any;
      return responder({ chats: chatsDaUazapi });
    }));

    const r = await rodar({ dry_run: false });

    const ana = r.instancias.find((i: any) => i.instancia === 'Ana');
    const cris = r.instancias.find((i: any) => i.instancia === 'Cris');
    expect(ana.erro).toMatch(/INSTANCE_DISCONNECTED/);
    expect(cris.chats_lidos_no_celular).toBe(1);
  });
});

describe('webhook — o diagnóstico do evento', () => {
  function comWebhooks(lista: any[]) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      chamadasDeRede.push(`${init?.method || 'GET'} ${url}`);
      return responder(lista);
    }));
  }

  it('sem `aplicar`, só relata — não escreve na UazAPI', async () => {
    comWebhooks([{ id: 'w1', url: 'https://railway/webhooks/uazapi/Cris', enabled: true, events: ['messages'] }]);
    const r = await rodar({ acao: 'webhook' });

    expect(r.webhooks[0]).toMatchObject({ nosso: true, tem_chats: false });
    expect(chamadasDeRede.every((c) => c.startsWith('GET'))).toBe(true);
  });

  it('lista de eventos VAZIA não é tocada — vazio costuma valer por "todos"', async () => {
    comWebhooks([{ id: 'w1', url: 'https://railway/webhooks/uazapi/Cris', enabled: true, events: [] }]);
    const r = await rodar({ acao: 'webhook', aplicar: true });

    expect(r.webhooks[0].aviso).toMatch(/vazia/);
    expect(chamadasDeRede.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('webhook de terceiro não é mexido, mesmo com aplicar', async () => {
    comWebhooks([{ id: 'w9', url: 'https://n8n.terceiro/hook', enabled: true, events: ['messages'] }]);
    const r = await rodar({ acao: 'webhook', aplicar: true });

    expect(r.webhooks[0].nosso).toBe(false);
    expect(chamadasDeRede.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('com `aplicar`, acrescenta `chats` preservando os eventos que já existiam', async () => {
    comWebhooks([{ id: 'w1', url: 'https://railway/webhooks/uazapi/Cris', enabled: true, events: ['messages', 'labels'] }]);
    const r = await rodar({ acao: 'webhook', aplicar: true });

    const post = (globalThis.fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'POST');
    expect(post).toBeTruthy();
    const enviado = JSON.parse(post[1].body);
    expect(enviado.events).toEqual(['messages', 'labels', 'chats']);
    expect(enviado).toMatchObject({ action: 'update', id: 'w1' });
    expect(r.webhooks[0].aplicado).toBe(true);
  });
});

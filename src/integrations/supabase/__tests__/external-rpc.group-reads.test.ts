/**
 * Leitura de conversa de GRUPO não filtra por instância.
 *
 * Cada instância-membro grava a sua cópia das mensagens do grupo e entrou nele
 * num momento diferente, então cada uma tem um pedaço do histórico. Medido em
 * 750 grupos (11–18/08/2026): na metade, a instância mais pobre enxerga 56% ou
 * menos; no grupo do PREV 1428, a "Luiz Abraci" tem 8 das 25 mensagens (33%)
 * enquanto a "Dom" tem 24. Ler só a instância da conversa escondia da pessoa
 * mensagens que o colega ao lado via na tela dele.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { fakeClient, chamadas, resetChamadas } = vi.hoisted(() => {
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const chain = (): any =>
    new Proxy(function () {} as any, {
      get(_t, prop) {
        const p: any = Promise.resolve({ data: [], error: null });
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        return (...args: unknown[]) => {
          chamadas.push({ metodo: String(prop), args });
          return chain();
        };
      },
      apply: () => chain(),
    });
  return {
    chamadas,
    resetChamadas: () => { chamadas.length = 0; },
    fakeClient: { from: (t: string) => { chamadas.push({ metodo: 'from', args: [t] }); return chain(); } },
  };
});

vi.mock('../external-client', () => ({ externalSupabase: fakeClient, ensureExternalSession: async () => {} }));
vi.mock('../group-lead-links', () => ({ attachGroupLeadIds: async (r: unknown) => r }));

import { getConversationMessages, markMessagesAsRead, linkMessagesToLead, linkMessagesToContact } from '../external-rpc';

const GRUPO = '120363425114615351';
const PESSOA = '554195769554';

/** Filtro de instância aplicado na query (undefined = não filtrou). */
const filtroDeInstancia = () =>
  chamadas.find(c => c.metodo === 'in' && c.args[0] === 'instance_name');
const limitePedido = () => chamadas.find(c => c.metodo === 'limit')?.args[0];

beforeEach(resetChamadas);

describe('getConversationMessages', () => {
  it('em grupo, lê todas as instâncias-membro', async () => {
    await getConversationMessages(GRUPO, 'Luiz Abraci', 300);
    expect(filtroDeInstancia()).toBeUndefined();
  });

  it('em conversa 1:1, continua restrito à instância', async () => {
    await getConversationMessages(PESSOA, 'Luiz Abraci', 300);
    expect(filtroDeInstancia()?.args[1]).toEqual(['Luiz Abraci', 'LUIZ ABRACI', 'luiz abraci']);
  });

  // O limite é de LINHAS: em grupo, 300 linhas rendem ~115 mensagens (2,6
  // espelhos cada). Triplicar a página levaria a abertura do FAMILIA 374 de
  // 1,5MB para 4,2MB de egress — quem rola até o topo puxa a próxima página.
  it('não infla a página em grupo', async () => {
    await getConversationMessages(GRUPO, 'Luiz Abraci', 300);
    expect(limitePedido()).toBe(300);
  });

  it('reconhece o grupo pelo JID com sufixo', async () => {
    await getConversationMessages(`${GRUPO}@g.us`, 'Luiz Abraci', 50);
    expect(filtroDeInstancia()).toBeUndefined();
  });
});

describe('markMessagesAsRead', () => {
  it('em grupo, marca a mensagem lida em todas as instâncias-membro', async () => {
    await markMessagesAsRead(GRUPO, 'Luiz Abraci');
    expect(filtroDeInstancia()).toBeUndefined();
    // continua restrito ao que faz sentido marcar
    expect(chamadas.some(c => c.metodo === 'eq' && c.args[0] === 'direction' && c.args[1] === 'inbound')).toBe(true);
  });

  it('em conversa 1:1, marca só a da instância', async () => {
    await markMessagesAsRead(PESSOA, 'Luiz Abraci');
    expect(filtroDeInstancia()?.args[1]).toEqual(['Luiz Abraci', 'LUIZ ABRACI', 'luiz abraci']);
  });
});

describe('vínculo da conversa (lead/contato)', () => {
  it('em grupo, carimba o lead na conversa inteira', async () => {
    await linkMessagesToLead(GRUPO, 'Luiz Abraci', 'lead-1');
    expect(filtroDeInstancia()).toBeUndefined();
    expect(chamadas.some(c => c.metodo === 'update' && (c.args[0] as any).lead_id === 'lead-1')).toBe(true);
  });

  it('em conversa 1:1, o vínculo continua restrito à instância', async () => {
    await linkMessagesToLead(PESSOA, 'Luiz Abraci', 'lead-1');
    expect(filtroDeInstancia()?.args[1]).toEqual(['Luiz Abraci', 'LUIZ ABRACI', 'luiz abraci']);
  });

  it('o contato segue o mesmo critério', async () => {
    await linkMessagesToContact(GRUPO, 'Luiz Abraci', 'contato-1');
    expect(filtroDeInstancia()).toBeUndefined();
    await new Promise(r => setTimeout(r, 0));
    resetChamadas();
    await linkMessagesToContact(PESSOA, 'Luiz Abraci', 'contato-1');
    expect(filtroDeInstancia()?.args[1]).toEqual(['Luiz Abraci', 'LUIZ ABRACI', 'luiz abraci']);
  });
});

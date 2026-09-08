// Saída de cliente do grupo — o que o webhook precisa reconhecer, e o que ele
// NUNCA pode confundir com saída.
//
// Contexto (08/09/2026): `whatsapp_group_exits` estava com zero linhas desde
// que foi criada, com 28 instâncias ativas. O tratamento existia inteiro; o que
// faltava era o evento chegar nele — a UazAPI chama uma URL só por instância, e
// o evento `groups` morria no filtro de "não é mensagem" do webhook principal.
//
// Estes testes protegem os dois lados da mesma porta: reconhecer o evento de
// participante, e não deixar conversa de grupo entrar por ela.
import { describe, it, expect, vi } from 'vitest';

// O módulo cria o client do Supabase no import, e aqui não há env de produção
// (nem deve haver: estes testes são de lógica pura, não tocam banco).
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import {
  isGroupParticipantEvent,
  extractAction,
  extractGroup,
  extractPhones,
} from '../whatsapp-group-exit';

describe('isGroupParticipantEvent', () => {
  it('reconhece o EventType `groups` da UazAPI', () => {
    expect(isGroupParticipantEvent('groups', { EventType: 'groups' })).toBe(true);
  });

  it('reconhece o nome longo group-participants-update', () => {
    expect(isGroupParticipantEvent('', { event: 'group-participants-update' })).toBe(true);
  });

  it('reconhece o payload cru do whatsmeow, que não tem rótulo nenhum', () => {
    // Só os arrays Leave/Join denunciam o que é. Sem este caso, o evento
    // passaria batido justamente na forma mais comum.
    expect(isGroupParticipantEvent('', { event: { JID: '120363@g.us', Leave: ['5511999999999@s.whatsapp.net'] } })).toBe(true);
    expect(isGroupParticipantEvent('', { Join: ['5511999999999@s.whatsapp.net'] })).toBe(true);
  });

  it('NÃO confunde mensagem de grupo com saída de grupo', () => {
    // O erro que ninguém perceberia: toda conversa de grupo caindo no gravador
    // de saída. Mensagem chega como `messages` e não tem Leave/Join.
    const mensagemEmGrupo = {
      EventType: 'messages',
      chat: { wa_chatid: '120363421011952033@g.us', name: 'Caso 341' },
      message: { text: 'bom dia, como está o processo?' },
    };
    expect(isGroupParticipantEvent('messages', mensagemEmGrupo)).toBe(false);
  });

  it('NÃO casa evento de chamada nem de etiqueta', () => {
    expect(isGroupParticipantEvent('call', { EventType: 'call' })).toBe(false);
    expect(isGroupParticipantEvent('chat_labels', { EventType: 'chat_labels' })).toBe(false);
  });
});

describe('quem saiu, e se saiu sozinho', () => {
  it('saiu por conta própria: quem executou é o próprio que saiu', () => {
    const body = {
      event: {
        JID: '120363421011952033@g.us',
        Sender: '5511999999999@s.whatsapp.net',
        Leave: ['5511999999999@s.whatsapp.net'],
      },
    };
    expect(extractAction(body)).toBe('leave');
  });

  it('foi tirado: quem executou é outra pessoa', () => {
    // A diferença importa: cliente que sai sozinho é sinal de insatisfação;
    // cliente removido pela equipe é rotina de encerramento.
    const body = {
      event: {
        JID: '120363421011952033@g.us',
        Sender: '5511888888888@s.whatsapp.net',
        Leave: ['5511999999999@s.whatsapp.net'],
      },
    };
    expect(extractAction(body)).toBe('remove');
  });

  it('respeita a ação declarada quando o payload traz o rótulo', () => {
    expect(extractAction({ action: 'remove', participants: ['5511999999999'] })).toBe('remove');
    expect(extractAction({ action: 'leave', participants: ['5511999999999'] })).toBe('leave');
  });

  it('normaliza o telefone com DDI e tira o sufixo do JID', () => {
    expect(extractPhones({ Leave: ['5511999999999@s.whatsapp.net'] })).toEqual(['5511999999999']);
    // Sem DDI, o 55 entra: é assim que o número casa com o que está em contacts.
    expect(extractPhones({ participants: ['11999999999'] })).toEqual(['5511999999999']);
  });

  it('não repete o mesmo telefone que veio em dois campos do payload', () => {
    const body = { participants: ['5511999999999@s.whatsapp.net'], Leave: ['5511999999999@s.whatsapp.net'] };
    expect(extractPhones(body)).toEqual(['5511999999999']);
  });

  it('acha o grupo tanto no formato UazAPI quanto no cru do whatsmeow', () => {
    expect(extractGroup({ groupJid: '120363@g.us', groupName: 'Caso 341' }))
      .toEqual({ jid: '120363@g.us', name: 'Caso 341' });
    expect(extractGroup({ event: { JID: '120363@g.us', Name: 'Caso 341' } }))
      .toEqual({ jid: '120363@g.us', name: 'Caso 341' });
  });
});

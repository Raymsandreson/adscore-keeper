import { describe, expect, it } from 'vitest';
import { parsePushTarget } from '../PushNotificationBridge';

const ORIGIN = 'https://whatsjud.com.br';

describe('parsePushTarget', () => {
  it('manda mensagem de WhatsApp para a folha da conversa, com a instância', () => {
    // Formato exato do payload montado em railway-server/src/lib/whatsapp-push.ts.
    const target = parsePushTarget('/whatsapp?openChat=558681595991&instance=Raym', ORIGIN);
    expect(target).toEqual({ kind: 'whatsapp', phone: '558681595991', instanceName: 'Raym' });
  });

  it('aceita JID de grupo escapado', () => {
    const target = parsePushTarget(
      `/whatsapp?openChat=${encodeURIComponent('120363043211234567@g.us')}&instance=${encodeURIComponent('João Manoel- Acolhedor')}`,
      ORIGIN
    );
    expect(target).toEqual({
      kind: 'whatsapp',
      phone: '120363043211234567@g.us',
      instanceName: 'João Manoel- Acolhedor',
    });
  });

  it('sem instância, o telefone sozinho basta', () => {
    expect(parsePushTarget('/whatsapp?openChat=558699999999', ORIGIN)).toEqual({
      kind: 'whatsapp',
      phone: '558699999999',
      instanceName: null,
    });
  });

  it('push de chat de equipe navega — também estava morto pelo mesmo motivo', () => {
    expect(parsePushTarget('/?openTeamChat=abc-123', ORIGIN)).toEqual({
      kind: 'route',
      to: '/?openTeamChat=abc-123',
    });
  });

  it('URL absoluta do próprio site cai na mesma regra', () => {
    expect(parsePushTarget(`${ORIGIN}/whatsapp?openChat=5586123`, ORIGIN)).toEqual({
      kind: 'whatsapp',
      phone: '5586123',
      instanceName: null,
    });
  });

  it('sem URL ou com URL quebrada, não faz nada', () => {
    expect(parsePushTarget(undefined, ORIGIN)).toBeNull();
    expect(parsePushTarget('', ORIGIN)).toBeNull();
    expect(parsePushTarget('http://', ORIGIN)).toBeNull();
  });
});

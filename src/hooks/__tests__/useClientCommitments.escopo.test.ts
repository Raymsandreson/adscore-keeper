import { describe, it, expect } from 'vitest';
import { commitmentScanKey } from '../useClientCommitments';
import { leadBelongsToConversation } from '@/lib/clientCommitments';

/**
 * Os dois guardas que impedem pendência de um cliente de nascer na ficha de
 * outro. O caso real: em 15/09/2026 a perícia da Nilzete (grupo
 * 120363428635762184) estava gravada com o lead da Monique, porque o front
 * mandou o lead da conversa anterior enquanto resolvia o desta.
 */
const GRUPO_NILZETE = '120363428635762184';
const GRUPO_MONIQUE = '120363430054264368';
const LEAD_MONIQUE = '3babfcdd-7b44-44bb-af50-b4817e1144c3';
const LEAD_NILZETE = '5af7efbe-d248-4aac-900a-70ab1cc7bc52';

describe('commitmentScanKey', () => {
  it('lead diferente na mesma conversa dá chave diferente — é o que destrava a revarredura', () => {
    const comLeadVelho = commitmentScanKey(GRUPO_NILZETE, 'Raym', LEAD_MONIQUE, null);
    const comLeadCerto = commitmentScanKey(GRUPO_NILZETE, 'Raym', LEAD_NILZETE, null);
    expect(comLeadVelho).not.toBe(comLeadCerto);
  });

  it('lead ainda não resolvido (null) não conta como já varrido com lead', () => {
    expect(commitmentScanKey(GRUPO_NILZETE, 'Raym', null, null))
      .not.toBe(commitmentScanKey(GRUPO_NILZETE, 'Raym', LEAD_NILZETE, null));
  });

  it('contato também entra — ele vinha errado junto com o lead', () => {
    expect(commitmentScanKey(GRUPO_NILZETE, 'Raym', LEAD_NILZETE, 'contato-a'))
      .not.toBe(commitmentScanKey(GRUPO_NILZETE, 'Raym', LEAD_NILZETE, 'contato-b'));
  });

  it('mesma conversa com o mesmo estado não varre duas vezes', () => {
    expect(commitmentScanKey(GRUPO_NILZETE, 'Raym', LEAD_NILZETE, 'c1'))
      .toBe(commitmentScanKey(GRUPO_NILZETE, 'Raym', LEAD_NILZETE, 'c1'));
  });
});

describe('leadBelongsToConversation', () => {
  it('recusa o lead cujo grupo declarado é OUTRO — o caso Monique × Nilzete', () => {
    expect(leadBelongsToConversation(GRUPO_NILZETE, [`${GRUPO_MONIQUE}@g.us`])).toBe(false);
  });

  it('aceita o lead do próprio grupo, com ou sem @g.us', () => {
    expect(leadBelongsToConversation(GRUPO_MONIQUE, [`${GRUPO_MONIQUE}@g.us`])).toBe(true);
    expect(leadBelongsToConversation(`${GRUPO_MONIQUE}@g.us`, [GRUPO_MONIQUE])).toBe(true);
  });

  it('aceita quando o lead tem vários grupos e um deles é este', () => {
    expect(leadBelongsToConversation(GRUPO_NILZETE, [`${GRUPO_MONIQUE}@g.us`, GRUPO_NILZETE])).toBe(true);
  });

  it('lead sem grupo nenhum passa — não dá para provar nada contra ele', () => {
    expect(leadBelongsToConversation(GRUPO_NILZETE, [])).toBe(true);
    expect(leadBelongsToConversation(GRUPO_NILZETE, [null, undefined, ''])).toBe(true);
  });

  it('conversa direta sempre passa — o cliente tem o grupo do caso E o WhatsApp dele', () => {
    expect(leadBelongsToConversation('5521965191638', [`${GRUPO_MONIQUE}@g.us`])).toBe(true);
  });

  it('sem telefone não bloqueia nada', () => {
    expect(leadBelongsToConversation(null, [`${GRUPO_MONIQUE}@g.us`])).toBe(true);
    expect(leadBelongsToConversation('', [`${GRUPO_MONIQUE}@g.us`])).toBe(true);
  });
});

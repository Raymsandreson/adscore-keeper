import { describe, it, expect } from 'vitest';
import { conversationDisplayName } from '../useConversationDisplayNames';

const JID_GRUPO = '120363412904771767';

describe('conversationDisplayName', () => {
  it('usa o nome do lead quando existe', () => {
    expect(conversationDisplayName(JID_GRUPO, 'Girlaine Lair de Souza', {})).toBe('Girlaine Lair de Souza');
  });

  it('cai no nome resolvido do grupo quando não há lead', () => {
    const nomes = { [JID_GRUPO]: '✅Prev 1673 Denisson José de Souza/ Mateus - BPC/LOAS' };
    expect(conversationDisplayName(JID_GRUPO, null, nomes)).toBe(nomes[JID_GRUPO]);
  });

  it('nunca mostra o JID cru de grupo — sem nome, vira "Grupo •••"', () => {
    const label = conversationDisplayName(JID_GRUPO, null, {});
    expect(label).not.toContain(JID_GRUPO);
    expect(label).toBe('Grupo •••771767');
  });

  it('conversa individual sem nome mantém o telefone', () => {
    expect(conversationDisplayName('556796345111', null, {})).toBe('556796345111');
  });

  it('conversa individual usa o nome do contato resolvido', () => {
    expect(conversationDisplayName('556796345111', null, { '556796345111': 'Girlaine' })).toBe('Girlaine');
  });

  it('sem telefone e sem lead não quebra', () => {
    expect(conversationDisplayName(null, null, {})).toBe('—');
  });
});

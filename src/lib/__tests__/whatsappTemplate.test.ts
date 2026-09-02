import { describe, it, expect } from 'vitest';
import { variaveisDoCorpo, renderizarTemplate, templatesEnviaveis } from '../whatsappTemplate';

const CORPO = 'Olá, {{1}}! Aqui é {{2}}, da equipe jurídica parceira da ABRACI.';

describe('variaveisDoCorpo', () => {
  it('acha as variáveis em ordem e sem repetir', () => {
    expect(variaveisDoCorpo(CORPO)).toEqual([1, 2]);
    expect(variaveisDoCorpo('{{2}} e {{1}} e {{2}}')).toEqual([1, 2]);
    expect(variaveisDoCorpo('sem variável')).toEqual([]);
  });
});

describe('renderizarTemplate', () => {
  it('preenche na ordem dos parâmetros', () => {
    expect(renderizarTemplate(CORPO, ['Maria', 'Ana'])).toBe(
      'Olá, Maria! Aqui é Ana, da equipe jurídica parceira da ABRACI.',
    );
  });

  it('lacuna aparece na tela em vez de virar texto vazio no cliente', () => {
    expect(renderizarTemplate(CORPO, ['Maria'])).toContain('[2]');
    expect(renderizarTemplate(CORPO, ['Maria', '   '])).toContain('[2]');
  });
});

describe('templatesEnviaveis', () => {
  it('só APPROVED — PENDING e REJECTED a Meta recusa no envio', () => {
    const t = (name: string, status: string) => ({
      name, status, language: 'pt_BR', category: 'UTILITY', body_text: CORPO, body_params: 2,
    });
    const out = templatesEnviaveis([t('a', 'APPROVED'), t('b', 'PENDING'), t('c', 'REJECTED')]);
    expect(out.map((x) => x.name)).toEqual(['a']);
  });
});

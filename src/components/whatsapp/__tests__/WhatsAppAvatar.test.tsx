/**
 * Foto de perfil do WhatsApp na lista e no cabeçalho do chat.
 *
 * O que precisa continuar valendo:
 * - grupo é identificado pelo ID de 18 dígitos SEM `@g.us` (é assim que o
 *   webhook grava `whatsapp_messages.phone`) — normalizar errado fazia a função
 *   descartar todo grupo, medido em 26/08/2026;
 * - sem foto, a tela cai no ícone de sempre, nunca num quadrado vazio;
 * - a foto só é pedida quando o avatar aparece na tela.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { normalizeTarget } from '@/hooks/useWhatsAppAvatars';

const getAvatar = vi.fn();
const requestAvatar = vi.fn();

vi.mock('@/hooks/useWhatsAppAvatars', async () => {
  const real = await vi.importActual<typeof import('@/hooks/useWhatsAppAvatars')>('@/hooks/useWhatsAppAvatars');
  return { ...real, useWhatsAppAvatars: () => ({ getAvatar, requestAvatar }) };
});

// jsdom não tem IntersectionObserver; o componente cai no caminho "pede logo".
import { WhatsAppAvatar } from '../WhatsAppAvatar';

describe('normalizeTarget', () => {
  it('mantém o ID de grupo de 18 dígitos', () => {
    expect(normalizeTarget('120363149212345678')).toBe('120363149212345678');
  });

  it('tira o @g.us do JID de grupo — a chave é sempre só dígitos', () => {
    expect(normalizeTarget('120363149212345678@g.us')).toBe('120363149212345678');
  });

  it('limpa máscara de telefone', () => {
    expect(normalizeTarget('+55 (47) 99963-9870')).toBe('5547999639870');
  });

  it('descarta o que não dá pra consultar', () => {
    expect(normalizeTarget('')).toBe('');
    expect(normalizeTarget('1234')).toBe('');
  });
});

describe('WhatsAppAvatar', () => {
  beforeEach(() => {
    getAvatar.mockReset();
    requestAvatar.mockReset();
  });

  it('mostra a foto quando o cache já tem', () => {
    getAvatar.mockReturnValue('https://exemplo.test/foto.webp');
    const { container } = render(<WhatsAppAvatar phone="5547999639870" instanceName="Raym" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://exemplo.test/foto.webp');
  });

  it('cai no ícone quando não há foto, e pede a foto', () => {
    getAvatar.mockReturnValue(null);
    const { container } = render(<WhatsAppAvatar phone="5547999639870" instanceName="Raym" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(requestAvatar).toHaveBeenCalledWith('5547999639870', 'Raym');
  });

  it('não pede foto de novo quando já tem a URL', () => {
    getAvatar.mockReturnValue('https://exemplo.test/foto.webp');
    render(<WhatsAppAvatar phone="5547999639870" instanceName="Raym" />);
    expect(requestAvatar).not.toHaveBeenCalled();
  });
});

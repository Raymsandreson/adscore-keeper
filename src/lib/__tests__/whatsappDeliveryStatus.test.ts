import { describe, it, expect } from 'vitest';
import { deliveryBadge, motivoDaFalha } from '../whatsappDeliveryStatus';

describe('deliveryBadge', () => {
  it('não mostra selo em mensagem recebida', () => {
    expect(deliveryBadge('inbound', 'received')).toBeNull();
  });

  it('não mostra selo quando o canal não reporta entrega', () => {
    // UazAPI grava status fora desse vocabulário — nada a afirmar.
    expect(deliveryBadge('outbound', 'queued')).toBeNull();
    expect(deliveryBadge('outbound', null)).toBeNull();
  });

  it('sent não afirma entrega', () => {
    const b = deliveryBadge('outbound', 'sent')!;
    expect(b.label).toBe('enviada');
    expect(b.title).not.toMatch(/chegou/i);
  });

  it('distingue entregue de lida', () => {
    expect(deliveryBadge('outbound', 'delivered')!.tone).toBe('ok');
    expect(deliveryBadge('outbound', 'read')!.tone).toBe('read');
    expect(deliveryBadge('outbound', 'read')!.label).toBe('lida');
  });

  it('falha explica a janela de 24h em vez de repetir o texto da Meta', () => {
    const b = deliveryBadge('outbound', 'failed', {
      delivery_error: { code: 131047, title: 'Re-engagement message' },
    })!;
    expect(b.tone).toBe('error');
    expect(b.label).toBe('não entregue');
    expect(b.title).toMatch(/24h/);
    expect(b.title).toMatch(/template/);
    expect(b.title).toContain('131047');
  });

  it('falha sem código conhecido cai no título da Meta', () => {
    const b = deliveryBadge('outbound', 'failed', {
      delivery_error: { code: 999999, title: 'Algo novo' },
    })!;
    expect(b.title).toBe('Algo novo (erro 999999)');
  });

  it('falha sem metadata ainda diz que foi recusada', () => {
    expect(deliveryBadge('outbound', 'failed')!.title).toMatch(/recusou/i);
  });
});

describe('motivoDaFalha', () => {
  it('tolera metadata ausente ou fora do formato', () => {
    expect(motivoDaFalha(null)).toBeNull();
    expect(motivoDaFalha({})).toBeNull();
    expect(motivoDaFalha('texto')).toBeNull();
    expect(motivoDaFalha({ delivery_error: 'x' })).toBeNull();
  });
});

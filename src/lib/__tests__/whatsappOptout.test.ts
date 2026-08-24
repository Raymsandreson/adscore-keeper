import { describe, expect, it } from 'vitest';
import {
  normalizeAckStatus,
  optoutKey,
  pediuParaParar,
  statusAbaixoDe,
} from '../../../supabase/functions/_shared/optout.ts';

describe('optoutKey', () => {
  it('casa as duas formas do mesmo aparelho (com e sem o 9º dígito)', () => {
    // No Externo, 30 dias: 729 números gravados com 13 dígitos e 1.372 com 12.
    // Se estas duas formas não colapsarem na mesma chave, quem pede para sair
    // por uma continua recebendo pela outra.
    expect(optoutKey('5591987654321')).toBe('559187654321');
    expect(optoutKey('559187654321')).toBe('559187654321');
  });

  it('completa o DDI de número escrito sem 55', () => {
    expect(optoutKey('91987654321')).toBe('559187654321'); // 11 dígitos
    expect(optoutKey('9187654321')).toBe('559187654321'); // 10 dígitos (fixo)
  });

  it('aceita telefone formatado e JID', () => {
    expect(optoutKey('+55 (91) 98765-4321')).toBe('559187654321');
    expect(optoutKey('5591987654321@s.whatsapp.net')).toBe('559187654321');
  });

  it('não inventa chave para entrada vazia', () => {
    expect(optoutKey('')).toBeNull();
    expect(optoutKey(null)).toBeNull();
    expect(optoutKey('sem dígitos')).toBeNull();
  });

  it('não derruba dígito de número que não é celular brasileiro de 13', () => {
    // Fixo com DDI (12 dígitos, 5º dígito não é 9) fica intacto.
    expect(optoutKey('559132165498')).toBe('559132165498');
    // Número internacional não vira número brasileiro.
    expect(optoutKey('12025550147')).toBe('5512025550147');
  });
});

describe('pediuParaParar', () => {
  it('reconhece o pedido explícito', () => {
    for (
      const t of [
        'sair',
        'PARAR',
        'pare.',
        'não quero mais receber',
        'nao quero mais receber essas mensagens',
        'não me manda mais mensagem',
        'para de me mandar mensagem',
        'me tira dessa lista',
        'remova meu número',
        'me deixa em paz',
        'vou denunciar esse número',
      ]
    ) {
      expect(pediuParaParar(t), `deveria reconhecer: ${t}`).toBe(true);
    }
  });

  it('NÃO confunde conversa normal com pedido de parada', () => {
    // Falso positivo aqui fecha o lead de quem ainda queria atendimento —
    // é o erro caro, e por isso o detector é estreito de propósito.
    for (
      const t of [
        'vou sair do trabalho agora e te ligo',
        'pode parar na esquina que eu desço',
        'não quero mais atrasar isso, vamos resolver',
        'quero sim, pode continuar',
        'parabéns pelo atendimento',
        'stopping? não entendi',
        'me manda mais informações por favor',
        'quero receber o contrato',
      ]
    ) {
      expect(pediuParaParar(t), `NÃO deveria reconhecer: ${t}`).toBe(false);
    }
  });

  it('ignora vazio e desabafo longo', () => {
    expect(pediuParaParar('')).toBe(false);
    expect(pediuParaParar(null)).toBe(false);
    expect(pediuParaParar(undefined)).toBe(false);
    expect(pediuParaParar('sair '.repeat(40))).toBe(false); // > 160 chars
  });
});

describe('ack de entrega', () => {
  it('entende ack numérico do Baileys e string', () => {
    expect(normalizeAckStatus(2)).toBe('delivered');
    expect(normalizeAckStatus(3)).toBe('read');
    expect(normalizeAckStatus('3')).toBe('read');
    expect(normalizeAckStatus('DELIVERY_ACK')).toBe('delivered');
    expect(normalizeAckStatus('READ')).toBe('read');
    expect(normalizeAckStatus('SERVER_ACK')).toBe('sent');
  });

  it('devolve null no que não reconhece, em vez de chutar', () => {
    expect(normalizeAckStatus(null)).toBeNull();
    expect(normalizeAckStatus('')).toBeNull();
    expect(normalizeAckStatus('ALGO_NOVO')).toBeNull();
    expect(normalizeAckStatus(99)).toBeNull();
  });

  it('não deixa o status regredir quando o ack chega fora de ordem', () => {
    expect(statusAbaixoDe('read')).toEqual(['sent', 'delivered']);
    expect(statusAbaixoDe('delivered')).toEqual(['sent']);
    // Tudo já nasce 'sent': ack de 'sent' não tem o que sobrescrever.
    expect(statusAbaixoDe('sent')).toEqual([]);
  });
});

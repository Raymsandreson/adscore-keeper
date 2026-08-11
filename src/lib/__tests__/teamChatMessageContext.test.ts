import { describe, it, expect } from 'vitest';
import {
  buildForwardContent,
  buildPrivateReplyHeader,
  msgPlainText,
  msgPreviewText,
  parseForward,
  parsePrivateReply,
} from '../teamChatMessageContext';

describe('teamChatMessageContext', () => {
  it('lê o cabeçalho antigo de resposta no privado (mensagens já enviadas)', () => {
    const legacy = '↩️ Em resposta no grupo Financeiro: “manda o boleto”\nsegue anexo';
    const parsed = parsePrivateReply(legacy);
    expect(parsed.header).toBe('↩️ Em resposta no grupo Financeiro: “manda o boleto”');
    expect(parsed.body).toBe('segue anexo');
  });

  it('monta e lê a resposta no privado vinda do chat interno da ficha', () => {
    const header = buildPrivateReplyHeader('chat interno de Maria Silva', 'preciso do  documento\nhoje');
    expect(header).toBe('↩️ Em resposta no chat interno de Maria Silva: “preciso do documento hoje”');
    const parsed = parsePrivateReply(`${header}\nvou providenciar`);
    expect(parsed.header).toBe(header);
    expect(parsed.body).toBe('vou providenciar');
  });

  it('não empilha cabeçalho ao encaminhar uma mensagem já encaminhada', () => {
    const first = buildForwardContent({ content: 'olha isso', sender_name: 'Ana' }, 'Bruno');
    expect(first).toBe('↪️ Encaminhada de Ana por Bruno\nolha isso');
    const second = buildForwardContent({ content: first, sender_name: 'Bruno' }, 'Carla');
    expect(second).toBe('↪️ Encaminhada de Bruno por Carla\nolha isso');
  });

  it('texto útil ignora cabeçalho de contexto e bloco citado', () => {
    const msg = {
      content: '↪️ Encaminhada de Ana por Bruno\n> Ana · 10/08 09:00:\n> pergunta antiga\nresposta nova',
    };
    expect(msgPlainText(msg)).toBe('resposta nova');
  });

  it('preview descreve anexo quando não há texto', () => {
    expect(msgPreviewText({ content: null, message_type: 'audio' })).toBe('🎤 Áudio');
    expect(msgPreviewText({ content: null, message_type: 'file', file_name: 'peticao.pdf' })).toBe('📎 peticao.pdf');
  });

  it('mensagem sem cabeçalho passa intacta', () => {
    expect(parseForward('oi').header).toBeNull();
    expect(parsePrivateReply('oi').body).toBe('oi');
  });
});

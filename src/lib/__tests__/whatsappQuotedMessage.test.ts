import { describe, it, expect } from 'vitest';
import {
  extractQuotedMessage,
  getWhatsAppMessageId,
  findMessageByWhatsAppIdInList,
} from '../whatsappQuotedMessage';

/** Payload real (grupo FAMÍLIA 345, 21/08/2026): "." citando um PDF de 30/06. */
const RESPOSTA_A_PDF = {
  message: {
    id: '558688272959:3A182F3026D79F35EB2E',
    text: '.',
    type: 'text',
    quoted: '3EB090047C770D94394B2C',
    sender: '136227957272816@lid',
    messageid: '3A182F3026D79F35EB2E',
    messageType: 'ExtendedTextMessage',
    content: {
      text: '.',
      contextInfo: {
        stanzaID: '3EB090047C770D94394B2C',
        quotedType: 0,
        participant: '58570586476754@lid',
        quotedMessage: {
          documentMessage: {
            title: 'STN EMPREENDIMENTOS E CONSTRUCOES LTDA AcidenteTrabalho (1).pdf',
            fileName: 'STN EMPREENDIMENTOS E CONSTRUCOES LTDA AcidenteTrabalho (1).pdf',
            mimetype: 'application/pdf',
          },
        },
      },
    },
  },
};

describe('extractQuotedMessage', () => {
  it('lê a citação de documento do payload real', () => {
    const q = extractQuotedMessage(RESPOSTA_A_PDF)!;
    expect(q.stanzaId).toBe('3EB090047C770D94394B2C');
    expect(q.kind).toBe('document');
    expect(q.label).toBe('Documento');
    expect(q.text).toContain('AcidenteTrabalho');
    expect(q.participantLid).toBe('58570586476754');
    expect(q.participantPhone).toBeNull();
  });

  it('devolve null quando a mensagem não cita nada', () => {
    expect(extractQuotedMessage({ message: { text: 'oi', content: { text: 'oi' } } })).toBeNull();
    expect(extractQuotedMessage(null)).toBeNull();
    expect(extractQuotedMessage({})).toBeNull();
  });

  it('não confunde anúncio Click-to-WhatsApp com citação', () => {
    const ctwa = {
      message: {
        content: {
          contextInfo: {
            externalAdReply: { title: 'Anúncio', body: 'Fale conosco' },
          },
        },
      },
    };
    expect(extractQuotedMessage(ctwa)).toBeNull();
  });

  it('cobre os tipos que aparecem no banco', () => {
    const comQuoted = (quotedMessage: any) =>
      extractQuotedMessage({
        message: { quoted: 'ABC123', content: { contextInfo: { stanzaID: 'ABC123', quotedMessage } } },
      })!;

    expect(comQuoted({ conversation: 'bom dia' })).toMatchObject({ kind: 'text', text: 'bom dia' });
    expect(comQuoted({ extendedTextMessage: { text: 'segue o link' } }))
      .toMatchObject({ kind: 'text', text: 'segue o link' });
    expect(comQuoted({ imageMessage: { caption: 'a foto' } })).toMatchObject({ kind: 'image', text: 'a foto' });
    expect(comQuoted({ imageMessage: {} })).toMatchObject({ kind: 'image', text: null, label: 'Foto' });
    expect(comQuoted({ videoMessage: {} })).toMatchObject({ kind: 'video' });
    expect(comQuoted({ ptvMessage: {} })).toMatchObject({ kind: 'video' });
    expect(comQuoted({ audioMessage: { PTT: true } })).toMatchObject({ kind: 'voice', label: 'Mensagem de voz' });
    expect(comQuoted({ audioMessage: {} })).toMatchObject({ kind: 'audio', label: 'Áudio' });
    expect(comQuoted({ stickerMessage: {} })).toMatchObject({ kind: 'sticker' });
    expect(comQuoted({ locationMessage: { name: 'Fórum' } })).toMatchObject({ kind: 'location', text: 'Fórum' });
    expect(comQuoted({ contactMessage: { displayName: 'Maria' } })).toMatchObject({ kind: 'contact', text: 'Maria' });
    expect(comQuoted({ pollCreationMessage: { name: 'Pode?' } })).toMatchObject({ kind: 'poll', text: 'Pode?' });
    // Sem cópia do conteúdo (só o id): ainda é citação, e o clique tem alvo.
    expect(comQuoted(undefined)).toMatchObject({ kind: 'other', label: 'Mensagem', text: null });
  });

  it('desembrulha efêmera, ver-uma-vez e documento com legenda', () => {
    const comQuoted = (quotedMessage: any) =>
      extractQuotedMessage({
        message: { quoted: 'X', content: { contextInfo: { stanzaID: 'X', quotedMessage } } },
      })!;

    expect(comQuoted({ ephemeralMessage: { message: { conversation: 'some em 24h' } } }))
      .toMatchObject({ kind: 'text', text: 'some em 24h' });
    expect(comQuoted({ viewOnceMessageV2: { message: { imageMessage: { caption: 'olha' } } } }))
      .toMatchObject({ kind: 'image', text: 'olha' });
    expect(comQuoted({ documentWithCaptionMessage: { message: { documentMessage: { fileName: 'peticao.pdf' } } } }))
      .toMatchObject({ kind: 'document', text: 'peticao.pdf' });
  });
});

describe('getWhatsAppMessageId', () => {
  it('tira o owner do external_message_id (o sufixo é igual em toda cópia espelhada)', () => {
    expect(getWhatsAppMessageId({ external_message_id: '558694473226:3EB090047C770D94394B2C' }))
      .toBe('3EB090047C770D94394B2C');
    expect(getWhatsAppMessageId({ external_message_id: '558688054381:3EB090047C770D94394B2C' }))
      .toBe('3EB090047C770D94394B2C');
  });
  it('cai no metadata quando a linha não tem external_message_id', () => {
    expect(getWhatsAppMessageId({ external_message_id: null, metadata: { message: { messageid: 'ABC' } } }))
      .toBe('ABC');
    expect(getWhatsAppMessageId({ external_message_id: null, metadata: {} })).toBeNull();
  });
});

describe('findMessageByWhatsAppIdInList', () => {
  const lista = [
    { id: 'uuid-1', external_message_id: '558694473226:AAA' },
    { id: 'uuid-2', external_message_id: '558688054381:3EB090047C770D94394B2C' },
  ];
  it('acha a cópia visível pelo id do WhatsApp', () => {
    expect(findMessageByWhatsAppIdInList(lista, '3EB090047C770D94394B2C')?.id).toBe('uuid-2');
  });
  it('devolve null sem alvo', () => {
    expect(findMessageByWhatsAppIdInList(lista, 'NAOEXISTE')).toBeNull();
    expect(findMessageByWhatsAppIdInList([], 'AAA')).toBeNull();
    expect(findMessageByWhatsAppIdInList(lista, '')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { linksDoTexto, midiasDaMensagem, rotuloDaMidia, midiaCriptografada } from '../midiaDaConversa';
import { termoParaFiltro } from '../vinculoDaAtividade';

describe('linksDoTexto', () => {
  it('acha o link no meio da frase, sem a pontuação do fim', () => {
    expect(linksDoTexto('olha aqui https://pje.trt16.jus.br/doc/123.')).toEqual(['https://pje.trt16.jus.br/doc/123']);
  });

  it('não repete o mesmo link mandado duas vezes', () => {
    expect(linksDoTexto('https://a.com e de novo https://a.com')).toEqual(['https://a.com']);
  });

  it('texto sem link não vira mídia nenhuma', () => {
    expect(linksDoTexto('esse processo ainda tá ativo?')).toEqual([]);
    expect(linksDoTexto(null)).toEqual([]);
  });
});

describe('midiasDaMensagem', () => {
  it('PDF sem legenda vira anexo pra IA ler — era o caso que não gerava atividade', () => {
    const midias = midiasDaMensagem({
      id: 'm1',
      message_text: null,
      message_type: 'document',
      media_type: 'application/pdf',
      media_url: 'https://storage/x/intimacao.pdf',
    });
    expect(midias).toHaveLength(1);
    expect(midias[0]).toMatchObject({ kind: 'document', url: 'https://storage/x/intimacao.pdf', message_id: 'm1' });
  });

  it('imagem leva a legenda junto', () => {
    const [midia] = midiasDaMensagem(
      { id: 'm2', message_text: 'print do PJe', message_type: 'image', media_type: 'image/jpeg', media_url: 'https://storage/p.jpg' },
      { who: 'Cliente', when: '24/08 11:06' },
    );
    expect(midia).toMatchObject({ kind: 'image', caption: 'print do PJe', who: 'Cliente', when: '24/08 11:06' });
  });

  it('áudio já transcrito pelo webhook não é transcrito de novo', () => {
    const midias = midiasDaMensagem({
      id: 'm3',
      message_text: 'oi doutor, o processo tá parado',
      message_type: 'audio',
      media_type: 'audio/ogg',
      media_url: 'https://storage/a.ogg',
    });
    expect(midias).toEqual([]);
  });

  it('áudio sem transcrição vai como arquivo', () => {
    const midias = midiasDaMensagem({
      id: 'm4', message_text: '', message_type: 'audio', media_type: 'audio/ogg', media_url: 'https://storage/a.ogg',
    });
    expect(midias).toHaveLength(1);
    expect(midias[0].kind).toBe('audio');
  });

  it('mídia ainda criptografada (.enc) fica de fora — ninguém consegue baixar', () => {
    expect(midiaCriptografada('https://mmg.whatsapp.net/x.enc')).toBe(true);
    expect(midiasDaMensagem({
      id: 'm5', message_type: 'document', media_type: 'application/pdf', media_url: 'https://mmg.whatsapp.net/x.enc',
    })).toEqual([]);
  });

  it('vídeo não vai: o Gemini não lê aqui, viraria erro no servidor', () => {
    expect(midiasDaMensagem({
      id: 'm6', message_type: 'video', media_type: 'video/mp4', media_url: 'https://storage/v.mp4',
    })).toEqual([]);
  });

  it('anexo e link na mesma mensagem geram os dois', () => {
    const midias = midiasDaMensagem({
      id: 'm7',
      message_text: 'segue https://tribunal.jus.br/andamento',
      message_type: 'document',
      media_type: 'application/pdf',
      media_url: 'https://storage/peticao.pdf',
    });
    expect(midias.map((m) => m.kind)).toEqual(['document', 'link']);
  });
});

describe('rotuloDaMidia', () => {
  it('nomeia o arquivo pra linha da conversa que a IA lê', () => {
    expect(rotuloDaMidia({ message_type: 'document', media_type: 'application/pdf', media_url: 'https://s/1787580392100_55869559.pdf' }))
      .toBe('[documento: 1787580392100_55869559.pdf]');
  });

  it('mensagem sem mídia não ganha rótulo', () => {
    expect(rotuloDaMidia({ message_text: 'certo' })).toBe('');
  });
});

describe('termoParaFiltro', () => {
  it('tira a pontuação que quebraria o or=() do PostgREST', () => {
    expect(termoParaFiltro('SILVA, JOÃO (ESPÓLIO)')).toBe('SILVA JOÃO ESPÓLIO');
    expect(termoParaFiltro('B&Q ENERGIA LTDA.')).toBe('B&Q ENERGIA LTDA.');
    expect(termoParaFiltro('100% SEGUROS')).toBe('100 SEGUROS');
  });
});

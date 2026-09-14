/**
 * Agrupamento de páginas soltas em um documento só.
 *
 * O caso real que originou isto (pasta "Luiza - adccab03" no Drive, set/2026):
 * o laudo pericial chegou em duas fotos pelo WhatsApp e virou dois arquivos
 * chamados "Laudo Pericial — (único).bin" — cada página se declarando documento
 * único, porque `analyze_file` olha um arquivo por vez.
 */
import { describe, it, expect } from 'vitest';
import {
  candidatosDeAgrupamento,
  classificarGrupos,
  conflitoDeTitular,
  formatoParaPdf,
  formatoPorAssinatura,
  nomeDoGrupo,
  ordenarPaginas,
  paginaDeclarada,
  podeVirarPagina,
  sequenciaContinua,
  type ArquivoParaAgrupar,
  type GrupoDeDocumento,
} from '../../../supabase/functions/_shared/agrupamentoDocumentos';

function arq(over: Partial<ArquivoParaAgrupar> & { id: string }): ArquivoParaAgrupar {
  return {
    name: `${over.id}.jpg`,
    mimeType: 'image/jpeg',
    ...over,
  };
}

function pagina(
  id: string,
  tipo: string,
  titular: string | null,
  enviadoEm: string,
  extra: Partial<ArquivoParaAgrupar> = {},
): ArquivoParaAgrupar {
  return arq({
    id,
    name: `${tipo} — ${titular ?? ''} (único).bin`,
    mimeType: 'image/jpeg',
    enviadoEm,
    analise: { document_type: tipo, document_subtype: 'único', holder_name: titular },
    ...extra,
  });
}

const porId = (arquivos: ArquivoParaAgrupar[]) => new Map(arquivos.map((a) => [a.id, a]));

describe('formato real do arquivo', () => {
  it('reconhece PDF, JPEG e PNG pelos primeiros bytes', () => {
    expect(formatoPorAssinatura(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('pdf');
    expect(formatoPorAssinatura(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(formatoPorAssinatura(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(formatoPorAssinatura(new Uint8Array([0x00, 0x01]))).toBeNull();
  });

  it('os bytes valem mais que o mimetype declarado (mídia .bin do WhatsApp)', () => {
    // Esta é a página que o merge antigo descartava como "mime não suportado":
    // nome doc-XXX.bin, mime octet-stream, mas é um JPEG.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(formatoParaPdf('application/octet-stream', 'doc-3A9F.bin', bytes)).toBe('jpg');
    expect(formatoParaPdf('application/octet-stream', 'doc-3A9F.bin')).toBeNull();
  });

  it('áudio e pasta nunca viram página', () => {
    expect(podeVirarPagina(arq({ id: 'a', mimeType: 'audio/ogg', name: 'ptt.ogg' }))).toBe(false);
    expect(
      podeVirarPagina(arq({ id: 'f', mimeType: 'application/vnd.google-apps.folder', name: 'sub' })),
    ).toBe(false);
    expect(podeVirarPagina(arq({ id: 'b', mimeType: 'application/octet-stream', name: 'x.bin' }))).toBe(true);
  });
});

describe('ordem das páginas', () => {
  it('numeração declarada manda mais que horário de envio', () => {
    const p3 = arq({ id: 'p3', name: 'Laudo página 3 de 3.jpg', enviadoEm: '2026-09-10T10:00:00Z' });
    const p1 = arq({ id: 'p1', name: 'Laudo página 1 de 3.jpg', enviadoEm: '2026-09-10T10:05:00Z' });
    const p2 = arq({ id: 'p2', name: 'Laudo página 2 de 3.jpg', enviadoEm: '2026-09-10T10:10:00Z' });
    expect(ordenarPaginas([p3, p1, p2]).map((a) => a.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('sem numeração, ordena pelo horário de envio no WhatsApp', () => {
    const b = pagina('b', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:02:00Z');
    const a = pagina('a', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z');
    expect(ordenarPaginas([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('lê "página X de Y" do nome e da descrição', () => {
    expect(paginaDeclarada(arq({ id: 'x', name: 'Laudo pág. 2/9.jpg' }))).toEqual({ pagina: 2, total: 9 });
    expect(
      paginaDeclarada(arq({ id: 'y', name: 'foto.jpg', analise: { description: 'Folha 4 de 10 do laudo' } })),
    ).toEqual({ pagina: 4, total: 10 });
    expect(paginaDeclarada(arq({ id: 'z', name: 'RG frente.jpg' }))).toBeNull();
  });
});

describe('candidatos de agrupamento', () => {
  it('junta as duas páginas do mesmo laudo do mesmo titular', () => {
    const arquivos = [
      pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z'),
      pagina('l2', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:01:00Z'),
      pagina('rg', 'RG', 'LUIZA DA SILVA', '2026-09-10T11:00:00Z'),
    ];
    const candidatos = candidatosDeAgrupamento(arquivos);
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].arquivos.map((a) => a.id)).toEqual(['l1', 'l2']);
    expect(candidatos[0].document_type).toBe('Laudo Pericial');
  });

  it('página sem titular entra no grupo do mesmo tipo que tem titular', () => {
    // A IA só lê o nome do titular na primeira página do laudo.
    const arquivos = [
      pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z'),
      pagina('l2', 'Laudo Pericial', null, '2026-09-10T10:01:00Z'),
    ];
    const candidatos = candidatosDeAgrupamento(arquivos);
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].arquivos.map((a) => a.id)).toEqual(['l1', 'l2']);
  });

  it('não propõe grupo para arquivo sozinho', () => {
    expect(
      candidatosDeAgrupamento([pagina('rg', 'RG', 'LUIZA', '2026-09-10T10:00:00Z')]),
    ).toHaveLength(0);
  });

  it('titulares diferentes viram candidatos separados', () => {
    const arquivos = [
      pagina('g1', 'Guia de Encaminhamento', 'LORENZO GABRIEL', '2026-09-10T10:00:00Z'),
      pagina('g2', 'Guia de Encaminhamento', 'ANDREIA GABRIELE', '2026-09-10T10:01:00Z'),
    ];
    expect(candidatosDeAgrupamento(arquivos)).toHaveLength(0);
  });
});

describe('porteiro do modo automático', () => {
  const grupoBase: GrupoDeDocumento = {
    titulo: 'Laudo Pericial — LUIZA DA SILVA',
    document_type: 'Laudo Pericial',
    holder_name: 'LUIZA DA SILVA',
    file_ids: ['l1', 'l2'],
    confianca: 'alta',
    motivo: 'mesmo cabeçalho e envio em sequência',
    origem: 'ia',
  };

  it('aplica sozinho quando a IA tem certeza e os sinais batem', () => {
    const arquivos = [
      pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z'),
      pagina('l2', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:01:00Z'),
    ];
    const r = classificarGrupos([grupoBase], porId(arquivos));
    expect(r.aplicar.map((g) => g.titulo)).toEqual(['Laudo Pericial — LUIZA DA SILVA']);
    expect(r.confirmar).toHaveLength(0);
  });

  it('nunca agrupa "Foto" sozinho, mesmo com confiança alta', () => {
    const arquivos = [
      pagina('f1', 'Foto', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z'),
      pagina('f2', 'Foto', 'LUIZA DA SILVA', '2026-09-10T10:01:00Z'),
    ];
    const r = classificarGrupos(
      [{ ...grupoBase, document_type: 'Foto', file_ids: ['f1', 'f2'] }],
      porId(arquivos),
    );
    expect(r.aplicar).toHaveLength(0);
    expect(r.confirmar).toHaveLength(1);
    expect(r.motivosDeRebaixamento[0].motivo).toContain('não se agrupa sozinho');
  });

  it('titulares diferentes nunca entram no mesmo PDF automático', () => {
    const arquivos = [
      pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z'),
      pagina('l2', 'Laudo Pericial', 'LORENZO GABRIEL', '2026-09-10T10:01:00Z'),
    ];
    const r = classificarGrupos([grupoBase], porId(arquivos));
    expect(r.aplicar).toHaveLength(0);
    expect(r.motivosDeRebaixamento[0].motivo).toContain('titulares diferentes');
    expect(conflitoDeTitular(arquivos)).toBe(true);
  });

  it('páginas enviadas com dias de distância vão para confirmação', () => {
    const arquivos = [
      pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z'),
      pagina('l2', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-13T15:00:00Z'),
    ];
    const r = classificarGrupos([grupoBase], porId(arquivos));
    expect(r.aplicar).toHaveLength(0);
    expect(r.confirmar).toHaveLength(1);
    expect(sequenciaContinua(arquivos)).toBe(false);
  });

  it('numeração declarada dispensa a janela de envio', () => {
    const arquivos = [
      pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z', {
        name: 'Laudo página 1 de 2.jpg',
      }),
      pagina('l2', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-13T15:00:00Z', {
        name: 'Laudo página 2 de 2.jpg',
      }),
    ];
    const r = classificarGrupos([grupoBase], porId(arquivos));
    expect(r.aplicar).toHaveLength(1);
  });

  it('confiança média nunca aplica sozinha — fica para o usuário', () => {
    const arquivos = [
      pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z'),
      pagina('l2', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:01:00Z'),
    ];
    const r = classificarGrupos([{ ...grupoBase, confianca: 'média' }], porId(arquivos));
    expect(r.aplicar).toHaveLength(0);
    expect(r.confirmar).toHaveLength(1);
  });

  it('arquivo citado pela IA que não existe na pasta derruba o grupo', () => {
    const arquivos = [pagina('l1', 'Laudo Pericial', 'LUIZA DA SILVA', '2026-09-10T10:00:00Z')];
    const r = classificarGrupos([grupoBase], porId(arquivos));
    expect(r.aplicar).toHaveLength(0);
    expect(r.motivosDeRebaixamento[0].motivo).toContain('menos de 2 arquivos');
  });
});

describe('nome do PDF unificado', () => {
  it('usa tipo, titular e contagem de páginas', () => {
    expect(nomeDoGrupo('Laudo Pericial', 'LUIZA DA SILVA', 10)).toBe(
      'Laudo Pericial — LUIZA DA SILVA (10 páginas).pdf',
    );
  });

  it('remove caracteres que o Drive não aceita', () => {
    expect(nomeDoGrupo('RG/CPF', 'LUIZA', 2)).toBe('RG CPF — LUIZA (2 páginas).pdf');
  });
});

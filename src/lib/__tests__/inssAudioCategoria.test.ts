import { describe, it, expect } from 'vitest';
// Módulo do railway-server, puro (só regex e string) — o vitest da raiz é o
// único runner. Os despachos abaixo são trechos reais do `inss_status_history`,
// recortados em 04/09/2026.
import {
  categoriaDoAudio,
  chaveDoAudio,
  normalizarDespacho,
  textoParaFala,
  ROTEIROS,
} from '../../../railway-server/src/lib/inss-audio-categoria';

const PROCURACAO =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 1849271649, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: Considerando que a assinatura digital no ' +
  'documento não foi reconhecido pelo sistema ITI, favor reenviar a procuração assinada de ' +
  'forma manuscrita.';

const BIOMETRIA =
  'Prezado(a) Senhor(a), Você deve ter registro de biometria para que o INSS analise o seu ' +
  'pedido. Os órgãos para o cadastro da biometria são os que emitem: Carteira de Identidade ' +
  'Nacional - CIN, Título Eleitoral, Carteira de Habilitação - CNH.';

describe('categoriaDoAudio — assunto único', () => {
  it('reconhece a procuração pedida assinada à mão', () => {
    expect(categoriaDoAudio(PROCURACAO)).toBe('procuracao');
  });

  it('reconhece a exigência de biometria', () => {
    expect(categoriaDoAudio(BIOMETRIA)).toBe('biometria');
  });

  it('reconhece a autodeclaração rural', () => {
    expect(
      categoriaDoAudio(
        'Prezado(a) Senhor(a), 1. Para análise de seu pedido, é necessário apresentar os ' +
          'seguintes documentos no prazo de 30 dias: Autodeclaração Rural preenchida e assinada.',
      ),
    ).toBe('autodeclaracao_rural');
  });
});

describe('categoriaDoAudio — recusa quando o áudio genérico enganaria', () => {
  it('despacho com dois assuntos não escolhe nenhum', () => {
    // O áudio da procuração falaria só da procuração, e o cliente mandaria
    // metade dos papéis. Nesse caso quem narra é o texto enviado, que lista tudo.
    expect(categoriaDoAudio(`${PROCURACAO} ${BIOMETRIA}`)).toBeNull();
  });

  it('CadÚnico citado numa cobrança de alíquota não vira "vá ao CRAS"', () => {
    expect(
      categoriaDoAudio(
        'O recolhimento na condição de segurado facultativo baixa renda, na alíquota de 5%, foi ' +
          'invalidado por renda pessoal informada no Cadúnico, sendo necessária a complementação ' +
          'para a alíquota de 11%. Segue guia para pagamento.',
      ),
    ).toBeNull();
  });

  it('comunicado de vagas de perícia não vira exigência de Bolsa Família', () => {
    expect(
      categoriaDoAudio(
        'Prezado(a) Senhor(a) Informamos que a Perícia Médica Federal - PMF e o INSS estão ' +
          'abrindo vagas regulares de perícia em diversas agências, para que possa oferecer um ' +
          'serviço mais ágil. Poderá antecipar o agendamento de sua perícia.',
      ),
    ).toBeNull();
  });

  it('união estável não vira declaração de separação', () => {
    // Pensão por morte pede prova de que viviam juntos; o áudio do estado civil
    // manda declarar separação. São pedidos opostos.
    expect(
      categoriaDoAudio(
        'Documentos para comprovar a união estável entre o interessado e a pessoa falecida. ' +
          'Deverão ser apresentados no mínimo dois documentos.',
      ),
    ).toBe('uniao_estavel');
  });

  it('despacho vazio ou curto demais não classifica', () => {
    expect(categoriaDoAudio(null)).toBeNull();
    expect(categoriaDoAudio('Prezado(a) Senhor(a),')).toBeNull();
  });
});

describe('normalizarDespacho', () => {
  it('desfaz entidade HTML antes de comparar', () => {
    // Sem isto, "Comprovante de resid&ecirc;ncia" escapa de todo regex
    // acentuado e a lista genérica de documentos casava só em "Carteira de
    // Trabalho", virando categoria de CTPS sozinha.
    const cru =
      'Documento de Identifica&ccedil;&atilde;o (RG, Carteira de Trabalho, CNH); CPF; ' +
      'T&iacute;tulo de Eleitor; Comprovante de resid&ecirc;ncia.';
    expect(normalizarDespacho(cru)).toContain('Comprovante de residência');
    expect(categoriaDoAudio(cru)).toBeNull();
  });
});

describe('chaveDoAudio', () => {
  it('junta tipo e assunto, e usa só o tipo quando não há assunto', () => {
    expect(chaveDoAudio('exigencia', 'procuracao')).toBe('exigencia:procuracao');
    expect(chaveDoAudio('protocolado', null)).toBe('protocolado');
  });
});

describe('textoParaFala', () => {
  it('tira emoji, marcação, bullet e link', () => {
    const falado = textoParaFala(
      '⚠️ O INSS pediu documentos:\n• *RG ou CNH*\n• certidão\nhttps://meu.inss.gov.br/x',
    );
    expect(falado).not.toMatch(/[⚠️•*]/);
    expect(falado).not.toContain('http');
    expect(falado).toContain('RG ou CNH');
  });
});

describe('roteiros fixos', () => {
  it('todo roteiro tem chave válida e nenhum carrega dado de cliente', () => {
    for (const [chave, texto] of Object.entries(ROTEIROS)) {
      expect(chave).toMatch(/^[a-z_]+(:[a-z_]+)?$/);
      expect(texto.length).toBeGreaterThan(80);
      // Roteiro é reaproveitado entre clientes: não pode ter CPF, NB nem
      // número de processo. Data solta também não — prazo muda por evento.
      expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}|\d{2}\/\d{2}\/\d{4}|\b\d{7,}\b/);
    }
  });
});

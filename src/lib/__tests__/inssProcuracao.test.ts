import { describe, it, expect } from 'vitest';
// Módulos do railway-server: puros, e o vitest da raiz é o único runner.
import { exigeProcuracao, extrairPontosPendentes } from '../../../railway-server/src/lib/inss-despacho';

// Despachos reais de `inss_status_history`, lidos em 01/09/2026.
const pontos = (d: string) => extrairPontosPendentes(d);

/** 2077222618 — o INSS recusa a assinatura sem nomear o documento. */
const MANUSCRITA =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 2077222618, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: 1- Esclarecemos que nossos sistemas não estão ' +
  'adaptados para reconhecimento e batimento de todas as assinaturas digitais, motivo pelo ' +
  'qual não são aceitas nos requerimentos assinatura digitais que não possibilitam ' +
  'conferência pelo Serviço Oficial de Validação de Assinaturas Eletrônicas do governo. ' +
  'Sendo assim, favor reenviar o documento acima citado, assinado de forma manuscrita e ' +
  'anexá-lo ao processo para a continuidade da análise do direito pleiteado.';

/** 1174302776 — "representação processual", sem a palavra procuração. */
const REPRESENTACAO_PROCESSUAL =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 1174302776, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: - Para que seja iniciada a análise do mérito ' +
  'do pedido deverá regularizar a representação processual visto que a assinatura digital no ' +
  'documento não foi reconhecido pelo sistema ITI do Governo Federal. -INSCRIÇÃO NO CADUNICO.';

/** 163604040 — pedido direto de procuração nova. */
const PROCURACAO_NOVA =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 163604040, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: -Apresentar nova procuração, devidamente ' +
  'assinada em modalidade de assinatura aceita pelo INSS, exemplo o portal GOV, tendo em ' +
  'vista que a procuração anteriormente anexada não pôde ser validada.';

/** 39d99904 — recusa nominal do ZapSign. */
const RECUSA_ZAPSIGN =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 1797976397, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: Observou-se que a assinatura eletrônica ' +
  'apresentada na procuração não pertence ao(à) outorgante, mas sim à empresa contratante ' +
  'para o serviço. "Assinado por: ZAPSIGN PROCESSAMENTO DE DADOS LTDA".';

/** fcc3d82a — prova de união estável, NÃO é pedido de procuração. */
const PROVA_DE_UNIAO =
  'Prezado(a) Senhor(a), Para dar andamento ao processo 1294590525, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: RG e CPF do falecido Certidão de nascimento ' +
  'do falecido Apresentar no minimo duas provas de dependencia economica. Tais documentos ' +
  'podem ser: - Escritura de compra e venda de imóvel feita pelos dois - Conta bancária ' +
  'conjunta, - Disposições testamentárias, - Procuração ou fiança reciprocamente outorgada, ' +
  '- Apólice de seguro da qual conste o(a) requerente como dependente do falecido/recluso.';

/** 594757727 — pede só o documento do procurador; procuração já está nos autos. */
const SO_DOC_DO_PROCURADOR =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 594757727, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: TENDO EM VISTA DE REQUERIMENTO PROTOCOLADO ' +
  'POR PROCURADOR: APRESENTAR DOCUMENTO DE IDENTIFICAÇÃO E CPF DO PROCURADOR E CASO O ' +
  'PROCURADOR SEJA ADVOGADO, ANEXAR CARTEIRA DA OAB.';

/** 5ba12365 — lista comum de documentos do cliente. */
const DOCUMENTOS_COMUNS =
  'Prezado(a) Senhor(a), Para dar andamento ao seu requerimento, solicitamos o envio dos ' +
  'seguintes documentos: - Certidão de nascimento/casamento/óbito; - Documento de ' +
  'Identificação (RG, CNH, Passaporte); - CPF; - Comprovante de residência.';

describe('exigeProcuracao', () => {
  it('pega o pedido direto de procuração', () => {
    expect(exigeProcuracao(pontos(PROCURACAO_NOVA))).toBe(true);
  });

  it('pega a recusa de assinatura sem a palavra "procuração"', () => {
    // O INSS diz só "reenviar o documento acima citado, assinado de forma
    // manuscrita" — é o caso que motivou a feature.
    expect(exigeProcuracao(pontos(MANUSCRITA))).toBe(true);
    expect(exigeProcuracao(pontos(REPRESENTACAO_PROCESSUAL))).toBe(true);
  });

  it('pega a recusa nominal do ZapSign', () => {
    expect(exigeProcuracao(pontos(RECUSA_ZAPSIGN))).toBe(true);
  });

  it('não confunde com a prova de união estável', () => {
    // "Procuração ou fiança reciprocamente outorgada" é item do art. 22 §3º do
    // Dec. 3.048/99: papel do casal, não instrumento de representação nosso.
    expect(exigeProcuracao(pontos(PROVA_DE_UNIAO))).toBe(false);
  });

  it('não dispara quando o INSS pede só o documento do procurador', () => {
    // A procuração já está nos autos; o que falta é o RG/CPF/OAB do advogado.
    expect(exigeProcuracao(pontos(SO_DOC_DO_PROCURADOR))).toBe(false);
  });

  it('não dispara em lista comum de documentos', () => {
    expect(exigeProcuracao(pontos(DOCUMENTOS_COMUNS))).toBe(false);
  });

  it('aceita entrada vazia', () => {
    expect(exigeProcuracao(null)).toBe(false);
    expect(exigeProcuracao('   ')).toBe(false);
  });
});

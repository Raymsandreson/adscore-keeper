import { describe, it, expect } from 'vitest';
// Módulos do railway-server: puros, e o vitest da raiz é o único runner.
import { extrairPontosPendentes, separarPendencias } from '../../../railway-server/src/lib/inss-despacho';
import { exigenciaDeAgendamentoDePericia } from '../../../railway-server/src/lib/inss-mensagem-cliente';

// Todos os textos abaixo são despachos reais de `inss_status_history`
// (587 exigências com despacho, relidas em 01/09/2026), reduzidos ao miolo.
//
// A regra mudou em 01/09/2026: procuração é pendência DO CLIENTE (ele imprime,
// assina à caneta e devolve). Só o documento pessoal do procurador continua
// saindo da mensagem. Ver o bloco de comentário em lib/inss-despacho.

/** a0e76e1d — os três itens são do cliente; o 3 é o termo de responsabilidade. */
const MISTO =
  'Prezado(a) Senhor(a), Para dar andamento ao processo 126860560, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: 1- APRESENTAR CERTIDÃO DE NASCIMENTO DE ' +
  'CLEITON ALMEIDA DIGITALIZADA E LEGÍVEL, POIS A FOTO SAIU DISTANTE; 2- APRESENTAR RG E ' +
  'CPF DA REPRESENTANTE LEGAL, LAURICÉLIA CARVALHO ALMEIDA OU OUTRA PESSOA QUE ESTEJA COM ' +
  'A GUARDA, DEVENDO APRESENTAR DOCUMENTO COMPROBATÓRIO; 3- APRESENTAR TERMO DE ' +
  'RESPONSABILIDADE, EM ANEXO, ASSINADO PELA REPRESENTANTE LEGAL, LAURICÉLIA CARVALHO ' +
  'ALMEIDA OU OUTRA PESSOA QUE ESTEJA COM A GUARDA. O cumprimento de exigência por meio ' +
  'eletrônico é feito diretamente pelo aplicativo ou site do Meu INSS.';

/** 79d6f5d1 — pedido de procuração legível: é o cliente que reenvia. */
const SO_PROCURACAO =
  'NR: Prezado(a) Senhor(a), * Anexar, em melhor qualidade, a procuração. ' +
  'O cumprimento de exigência por meio eletrônico é feito diretamente pelo aplicativo ou ' +
  'site do Meu INSS.';

/** fcc3d82a — "procuração ou fiança reciprocamente outorgada" é prova de união estável. */
const PROVA_DE_UNIAO =
  'Prezado(a) Senhor(a), Para dar andamento ao processo 1294590525, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: RG e CPF do falecido Certidão de nascimento ' +
  'do falecido Apresentar no minimo duas provas de dependencia economica da requerente em ' +
  'relação ao falecido. Tais documentos podem ser: - Escritura de compra e venda de imóvel ' +
  'feita pelos dois - Conta bancária conjunta, - Disposições testamentárias, - Procuração ' +
  'ou fiança reciprocamente outorgada, - Apólice de seguro da qual conste o(a) requerente ' +
  'como dependente do falecido/recluso. O cumprimento de exigência por meio eletrônico é ' +
  'feito diretamente pelo aplicativo ou site do Meu INSS.';

/** 5ba12365 — CNH e OAB aqui são documento de identidade DO CLIENTE. */
const IDENTIDADE_DO_CLIENTE =
  'Prezado(a) Senhor(a), Para dar andamento ao seu requerimento, solicitamos o envio dos ' +
  'seguintes documentos: - Certidão de nascimento/casamento/óbito; - Documento de ' +
  'Identificação (RG, Carteira de Trabalho, CNH, Passaporte, Carteira de Profissão - OAB e ' +
  'outros, etc); - CPF; - Título de Eleitor; - Comprovante de residência.';

/** 39d99904 — recusa da assinatura eletrônica: quem assina de novo é o cliente. */
const VICIO_DE_REPRESENTACAO =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 1797976397, solicitamos o ' +
  'envio eletrônico dos documentos descritos abaixo: Observou-se que a assinatura ' +
  'eletrônica apresentada na procuração não pertence ao(à) outorgante, mas sim à empresa ' +
  'contratante para o serviço. "Assinado por: ZAPSIGN PROCESSAMENTO DE DADOS LTDA". ' +
  'Apresente novo documento de representação com poderes de representação junto ao INSS e ' +
  'com assinaturas válidas.';

/** a2333b41 — itens em letra: b) é nosso, a) e c) são do cliente. */
const ITENS_EM_LETRA =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo, solicitamos o envio eletrônico ' +
  'dos documentos descritos abaixo: a) procuração, devidamente datada e assinada (a ' +
  'assinatura do interessado deverá ser semelhante à do documento de identificação) ' +
  'b) documento de identificação com foto do procurador c) documento de identificação com ' +
  'foto do interessado';

/** 78a9c401 — o documento do procurador vem antes da procuração da cliente. */
const DOC_DO_PROCURADOR_E_PROCURACAO =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 1088392685, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: - Documento de Identificação do ' +
  'procurador(a); - Procuração devidamente assinada pela interessada. Constatamos que a ' +
  'procuração apresentada não possui assinatura válida da requerente.';

/** 86591c66 — o INSS emenda o item do cliente sem pontuação nenhuma. */
const OAB_EMENDADA_NA_PROVA =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 594757727, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: TENDO EM VISTA DE REQUERIMENTO PROTOCOLADO ' +
  'POR PROCURADOR: APRESENTAR DOCUMENTO DE IDENTIFICAÇÃO E CPF DO PROCURADOR E CASO O ' +
  'PROCURADOR SEJA ADVOGADO, ANEXAR CARTEIRA DA OAB Apresentar ao menos uma prova ' +
  'documental anterior fato gerador, até a data declarada como início da atividade.';

/** 90edde53 — os dois pedidos na MESMA frase: cortar levaria a procuração junto. */
const NA_MESMA_FRASE =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 1913451073, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: -PROCURAÇÃO E DOCUMENTOS DE IDENTIFICAÇÃO DO ' +
  'PROCURADOR, COM PODERES PERANTE O INSS. -INFORMAMOS AINDA QUE SE A PROCURAÇÃO TIVER ' +
  'ASSINATURA DIGITAL, DEVE SER POSSÍVEL A SUA VERIFICAÇÃO POR MEIO DO SITE validar.it.gov.br.';

describe('separarPendencias', () => {
  it('não mexe no texto quando não há pendência do escritório', () => {
    const pontos = extrairPontosPendentes(IDENTIDADE_DO_CLIENTE)!;
    const { cliente, escritorio } = separarPendencias(pontos);
    expect(escritorio).toBeNull();
    expect(cliente).toBe(pontos);
  });

  it('deixa o termo de responsabilidade com o cliente', () => {
    // Quem assina é a representante legal (mãe, avó, tutor) — não o escritório.
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(MISTO));
    expect(escritorio).toBeNull();
    expect(cliente).toContain('TERMO DE');
    expect(cliente).toContain('CERTIDÃO DE NASCIMENTO DE CLEITON ALMEIDA');
  });

  it('deixa o pedido de procuração com o cliente', () => {
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(SO_PROCURACAO));
    expect(escritorio).toBeNull();
    expect(cliente).toContain('procuração');
  });

  it('deixa com o cliente a "procuração ou fiança reciprocamente outorgada"', () => {
    // É item da lista de provas de união estável do art. 22 §3º do Dec. 3.048/99,
    // papel do casal — cortar aqui tiraria uma prova que o cliente precisa juntar.
    const pontos = extrairPontosPendentes(PROVA_DE_UNIAO)!;
    const { cliente, escritorio } = separarPendencias(pontos);
    expect(escritorio).toBeNull();
    expect(cliente).toContain('fiança reciprocamente outorgada');
  });

  it('não corta CNH nem OAB quando são a identidade do cliente', () => {
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(IDENTIDADE_DO_CLIENTE));
    expect(escritorio).toBeNull();
    expect(cliente).toContain('CNH');
    expect(cliente).toContain('OAB');
  });

  it('deixa com o cliente a recusa da assinatura eletrônica', () => {
    // É ele quem assina de novo, à caneta; o robô manda junto o PDF preenchido.
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(VICIO_DE_REPRESENTACAO));
    expect(escritorio).toBeNull();
    expect(cliente).toContain('documento de representação');
  });

  it('corta só o item b) — o documento do procurador', () => {
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(ITENS_EM_LETRA));
    expect(escritorio).toContain('foto do procurador');
    expect(cliente).toContain('a) procuração, devidamente datada e assinada');
    expect(cliente).toContain('foto do interessado');
    expect(cliente).not.toContain('foto do procurador');
  });

  it('corta o documento do procurador e mantém a procuração da interessada', () => {
    const { cliente, escritorio } = separarPendencias(
      extrairPontosPendentes(DOC_DO_PROCURADOR_E_PROCURACAO),
    );
    expect(escritorio).toContain('Documento de Identificação do procurador(a)');
    expect(cliente).toContain('Procuração devidamente assinada pela interessada');
    expect(cliente).not.toContain('do procurador(a)');
  });

  it('corta a OAB sem levar junto o item que o INSS emendou sem pontuação', () => {
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(OAB_EMENDADA_NA_PROVA));
    expect(escritorio).toContain('CARTEIRA DA OAB');
    expect(cliente).toContain('prova documental');
    expect(cliente).not.toContain('CARTEIRA DA OAB');
  });

  it('não corta quando os dois pedidos estão na mesma frase', () => {
    // Cortar o fragmento levaria junto a procuração, que é do cliente. Aqui a
    // barreira é a instrução do prompt, não o corte.
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(NA_MESMA_FRASE));
    expect(escritorio).toBeNull();
    expect(cliente).toContain('PROCURAÇÃO E DOCUMENTOS DE IDENTIFICAÇÃO DO PROCURADOR');
  });

  it('aceita entrada vazia', () => {
    expect(separarPendencias(null)).toEqual({ cliente: null, escritorio: null });
    expect(separarPendencias('   ')).toEqual({ cliente: null, escritorio: null });
  });
});

// ---------------------------------------------------------------------------

/** d7ebced3 — Benefício por Incapacidade, agendamento pelo Meu INSS. */
const AGENDAR_INCAPACIDADE =
  'Prezado(a) Sr.(a), Para dar continuidade ao seu pedido de Benefício por Incapacidade, é ' +
  'necessário agendar a perícia médica . Para agendar: Entre no Meu INSS; Selecione ' +
  '"Consultar Pedidos"; No pedido solicitado, vá em "Cumprir Exigência" e selecione "Agendar".';

/** Auxílio-acidente: o texto manda ligar no 135. */
const AGENDAR_135 =
  'Ao senhor {INTERESSADO}, CPF {CPF} Prezado(a) Senhor(a), Para dar continuidade ao ' +
  'pedido, ligue no telefone 135 e agende a perícia médica de Auxílio-Acidente. Atenção! O ' +
  'agendamento deve ser feito em até 30 dias.';

/** BPC: perícia médica e avaliação social. */
const AGENDAR_BPC =
  'Prezado(a) Sr.(a), O Benefício Assistencial à Pessoa com Deficiência exige perícia ' +
  'médica e avaliação social. Agende todos os serviços que estiverem pendentes para ' +
  'continuar a análise do seu pedido. Para agendar: Entre no Meu INSS.';

/** ebc7d227 — convocação: a perícia JÁ está marcada, com data e local. */
const CONVOCACAO_REMARCADA =
  'Prezado(a) Senhor(a), Informamos o que INSS está antecipando os agendamentos de perícias ' +
  'médicas agendadas para datas futuras, assim, comunicamos que sua perícia foi remarcada e ' +
  'convocamos para que compareça, com pelo menos 15 minutos de antecedência, no dia e ' +
  'horários a seguir: Data:30/05/2026 Hora:07:00 Local:APS TERESINA - LESTE Qualquer dúvida, ' +
  'pode entrar em contato pelo telefone 135.';

/** 445a4224 — convocação com comprovante em anexo. */
const CONVOCACAO_COMPARECER =
  'Assunto: Comparecimento para realização de Perícia Médica Prezado(a) Senhor(a), Para dar ' +
  'andamento ao processo de n. 1376805615, solicitamos: - COMPARECER NO DIA 02/06/2026, AS ' +
  '08:00H NO INSS DE ITAPAGÉ-CE, PARA REALIZAÇÃO DA PERÍCIA MÉDICA. (COMPROVANTE DO ' +
  'AGENDAMENTO EM ANEXO) Informamos ainda que na impossibilidade de comparecimento no dia ' +
  'acima indicado, deverá ser solicitada a remarcação em uma agência do INSS ou pelo ' +
  'telefone 135, no prazo máximo de 07 dias.';

/** 2143138033 — pedido de documentos que só menciona a perícia de passagem. */
const DOCUMENTOS_QUE_CITAM_PERICIA =
  'Prezado(a) Senhor(a), Para dar andamento ao processo 2143138033, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: A PERICIA MÉDICA FEDERAL IRÁ ANALISAR A ' +
  'DOCUMENTAÇÃO EM RELAÇÃO A MORTE ACIDENTAL DO SEGURADO. APRESENTAR BOLETIM DE OCORRÊNCIA ' +
  'E LAUDO DE NECROPSIA. Qualquer dúvida, ligue para o telefone 135.';

describe('exigenciaDeAgendamentoDePericia', () => {
  const chama = (despacho: string) =>
    exigenciaDeAgendamentoDePericia({ despacho, pontosPendentes: extrairPontosPendentes(despacho) });

  it('pega os três textos de agendamento', () => {
    expect(chama(AGENDAR_INCAPACIDADE)).toBe(true);
    expect(chama(AGENDAR_135)).toBe(true);
    expect(chama(AGENDAR_BPC)).toBe(true);
  });

  it('não pega convocação de perícia já marcada', () => {
    // Aqui o cliente PRECISA da mensagem: tem data, hora e local, e faltar
    // à perícia derruba o pedido.
    expect(chama(CONVOCACAO_REMARCADA)).toBe(false);
    expect(chama(CONVOCACAO_COMPARECER)).toBe(false);
  });

  it('não pega pedido de documentos que só cita a perícia ou o 135', () => {
    expect(chama(DOCUMENTOS_QUE_CITAM_PERICIA)).toBe(false);
    expect(chama(IDENTIDADE_DO_CLIENTE)).toBe(false);
  });

  it('exige o assunto perícia, não só o verbo agendar', () => {
    expect(
      exigenciaDeAgendamentoDePericia({
        despacho: 'Agende o serviço "Cumprimento de Exigência" para entregar os documentos.',
      }),
    ).toBe(false);
  });
});

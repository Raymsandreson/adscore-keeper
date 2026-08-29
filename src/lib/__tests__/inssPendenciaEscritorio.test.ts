import { describe, it, expect } from 'vitest';
// Módulos do railway-server: puros, e o vitest da raiz é o único runner.
import { extrairPontosPendentes, separarPendencias } from '../../../railway-server/src/lib/inss-despacho';
import { exigenciaDeAgendamentoDePericia } from '../../../railway-server/src/lib/inss-mensagem-cliente';

// Todos os textos abaixo são despachos reais de `inss_status_history`
// (559 exigências com despacho, lidas em 27/08/2026), reduzidos ao miolo.

/** a0e76e1d — item 3 é nosso (termo de responsabilidade), 1 e 2 são do cliente. */
const MISTO =
  'Prezado(a) Senhor(a), Para dar andamento ao processo 126860560, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: 1- APRESENTAR CERTIDÃO DE NASCIMENTO DE ' +
  'CLEITON ALMEIDA DIGITALIZADA E LEGÍVEL, POIS A FOTO SAIU DISTANTE; 2- APRESENTAR RG E ' +
  'CPF DA REPRESENTANTE LEGAL, LAURICÉLIA CARVALHO ALMEIDA OU OUTRA PESSOA QUE ESTEJA COM ' +
  'A GUARDA, DEVENDO APRESENTAR DOCUMENTO COMPROBATÓRIO; 3- APRESENTAR TERMO DE ' +
  'RESPONSABILIDADE, EM ANEXO, ASSINADO PELA REPRESENTANTE LEGAL, LAURICÉLIA CARVALHO ' +
  'ALMEIDA OU OUTRA PESSOA QUE ESTEJA COM A GUARDA. O cumprimento de exigência por meio ' +
  'eletrônico é feito diretamente pelo aplicativo ou site do Meu INSS.';

/** 79d6f5d1 — a exigência inteira é nossa. */
const SO_ESCRITORIO =
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

/** 39d99904 — o rótulo '"Assinado por:' só existe para abrir o item nosso. */
const VICIO_DE_REPRESENTACAO =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 1797976397, solicitamos o ' +
  'envio eletrônico dos documentos descritos abaixo: Observou-se que a assinatura ' +
  'eletrônica apresentada na procuração não pertence ao(à) outorgante, mas sim à empresa ' +
  'contratante para o serviço. "Assinado por: ZAPSIGN PROCESSAMENTO DE DADOS LTDA". ' +
  'Apresente novo documento de representação com poderes de representação junto ao INSS e ' +
  'com assinaturas válidas.';

describe('separarPendencias', () => {
  it('não mexe no texto quando não há pendência do escritório', () => {
    const pontos = extrairPontosPendentes(IDENTIDADE_DO_CLIENTE)!;
    const { cliente, escritorio } = separarPendencias(pontos);
    expect(escritorio).toBeNull();
    expect(cliente).toBe(pontos);
  });

  it('tira o termo de responsabilidade e mantém os documentos do cliente', () => {
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(MISTO));
    expect(escritorio).toContain('TERMO DE RESPONSABILIDADE');
    expect(cliente).toContain('CERTIDÃO DE NASCIMENTO DE CLEITON ALMEIDA');
    expect(cliente).toContain('APRESENTAR RG E CPF');
    expect(cliente).not.toContain('TERMO DE RESPONSABILIDADE');
  });

  it('devolve cliente null quando a exigência inteira é do escritório', () => {
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(SO_ESCRITORIO));
    expect(escritorio).toContain('procuração');
    expect(cliente).toBeNull();
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

  it('leva junto o rótulo órfão do item removido', () => {
    const { cliente, escritorio } = separarPendencias(extrairPontosPendentes(VICIO_DE_REPRESENTACAO));
    expect(escritorio).toContain('ZAPSIGN');
    expect(escritorio).toContain('documento de representação');
    expect(cliente ?? '').not.toContain('Assinado por');
    expect(cliente ?? '').not.toContain('ZAPSIGN');
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

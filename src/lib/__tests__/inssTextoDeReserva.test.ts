import { describe, it, expect } from 'vitest';
// Módulos do railway-server: puros, e o vitest da raiz é o único runner.
import {
  RECUSA_EM_PORTUGUES,
  extrairPontosPendentes,
  separarPendencias,
  simplificarPendenciaParaReserva,
} from '../../../railway-server/src/lib/inss-despacho';
import { fallbackMensagemCliente } from '../../../railway-server/src/lib/inss-mensagem-cliente';

// O texto de reserva é o que sai no grupo do cliente quando o Gemini falha.
// Ele não passa pelo prompt, então as proibições do prompt precisam valer aqui
// na unha. Todos os despachos abaixo são reais (`inss_status_history`, lidos em
// 02/09/2026); medição na mesma data sobre as 400 exigências mais recentes:
// das 64 de procuração, 28 vazavam juridiquês antes desta regra; das 334
// restantes, nenhuma muda de forma.

/** Nada disso pode chegar ao cliente. */
const PROIBIDO =
  /zapsign|validar\.iti\.gov\.br|medida provis[óo]ria|instru[çc][ãa]o normativa|icp-brasil|\blei n|decreto n|assinaturas? (digitais?|eletr[ôo]nicas?)/i;

/** e51f5146 — o INSS conta que quem assinou foi a ZapSign, não a segurada. */
const ZAPSIGN_NOMEADA =
  'Prezado(a) Senhor(a), Para dar andamento ao processo 75935094, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: A procuração apresentada ou termo de ' +
  'representação juntado ao processo foi submetido à consulta através da plataforma ' +
  'https://validar.iti.gov.br/ e não obtivemos retorno quanto à confirmação da assinatura ' +
  'da requerente/segurada. O retorno da consulta informa que quem assinou foi ZAPSIGN ' +
  'PROCESSAMENTO DE DADOS LTDA E NÃO O(A) REQUERENTE. Portanto não houve comprovação da ' +
  'outorga de poderes para representação junto ao INSS. Deverá apresentar procuração ou ' +
  'termo de representação assinada pelo outorgante. O atendimento deve ocorrer até o dia 02/10/2026.';

/** 2077222618 — a recusa vem com MP 2.200-2 e IN 128/2022 no rodapé. */
const FUNDAMENTO_LEGAL =
  'Para dar andamento ao processo 2077222618, solicitamos o envio eletrônico dos ' +
  'documentos descritos abaixo: 1- Esclarecemos que nossos sistemas não estão adaptados ' +
  'para reconhecimento e batimento de todas as assinaturas digitais, motivo pelo qual não ' +
  'são aceitas nos requerimentos assinatura digitais que não possibilitam conferência pelo ' +
  'Serviço Oficial de Validação de Assinaturas Eletrônicas do governo, no site ' +
  'https://validar.iti.gov.br/ . Sendo assim, favor reenviar o documento acima citado, ' +
  'assinado de forma manuscrita e anexá-lo ao processo para a continuidade da análise do ' +
  'direito pleiteado. Também é permitida a assinatura eletrônica por meio de certificado ' +
  'digital proveniente da ICP-Brasil, que lhe garanta autenticidade e integridade, conforme ' +
  '§ 1º do art. 10 da Medida Provisória nº 2.200-2, de 24 de agosto de 2001, e com carimbo ' +
  'do tempo, que possibilitará a conferência da sua contemporaneidade, conforme art. 560 da ' +
  'Instrução Normativa nº 128/2022. O atendimento deve ocorrer até o dia 30/09/2026.';

/** 1072824460 — cita a ICP-Brasil sem nunca dizer "assinatura eletrônica". */
const SO_ICP =
  'Para dar andamento ao processo 1072824460, solicitamos o envio eletrônico dos ' +
  'documentos descritos abaixo: -- Favor apresentar a procuração assinada (manual) pela ' +
  'segurada. Informamos que se a assinatura da segurada constante na procuração estiver ' +
  'divergente da assinatura da segurada no documento de identificação com foto, deverá ' +
  'conter reconhecimento de firma da mesma. A assinatura constante na procuração ' +
  'apresentada não pode ser confirmada no site ICP-Brasil (.GOV)';

/** 1148944191 — pede dois papéis do cliente e nenhum juridiquês. */
const DOIS_PAPEIS =
  'Para dar andamento ao processo 1148944191, solicitamos o envio eletrônico dos ' +
  'documentos descritos abaixo: Deverá apresentar PROCURAÇÃO e o TERMO DE ' +
  'RESPONSABILIDADE devidamente preenchido, onde conste o nome do interessado, do ' +
  'outorgante e o documento de identificação do(a) procurador(a).';

/** 1077691565 — exigência sem procuração nenhuma: tem que sair intacta. */
const SEM_PROCURACAO =
  'Para dar andamento ao processo 1077691565, solicitamos o envio eletrônico dos ' +
  'documentos descritos abaixo: - Apresentar Identidade, Certidão de casamento ou ' +
  'nascimento, CTPS - Carteira de Trabalho e Previdência Social ou qualquer documento ' +
  'oficial com foto de todos os membros de seu grupo familiar.';

/** Lista de dispensa da biometria: 24 exigências trazem, e o cliente precisa. */
const BIOMETRIA =
  'Você deve ter registro de biometria para que o INSS analise o seu pedido. Está ' +
  'liberada da biometria a pessoa: Maior de 80 anos que apresente documento válido com ' +
  'foto Impedida de se deslocar por saúde ou deficiência, com atestado médico Que more em ' +
  'área de difícil acesso.';

/** O caminho que a produção percorre: despacho → pontos → pendência do cliente. */
function pendenciaDoCliente(despacho: string): string | null {
  return separarPendencias(extrairPontosPendentes(despacho)).cliente;
}

describe('simplificarPendenciaParaReserva', () => {
  it('não nomeia a ZapSign nem o site do validador para o cliente', () => {
    const saida = simplificarPendenciaParaReserva(pendenciaDoCliente(ZAPSIGN_NOMEADA));
    expect(saida).not.toMatch(PROIBIDO);
    expect(saida).toContain(RECUSA_EM_PORTUGUES);
  });

  it('preserva o pedido acionável ao trocar o parágrafo de recusa', () => {
    const saida = simplificarPendenciaParaReserva(pendenciaDoCliente(ZAPSIGN_NOMEADA));
    expect(saida).toMatch(/Deverá apresentar procuração ou termo de representação/i);
  });

  it('tira MP, IN e ICP-Brasil do fundamento legal', () => {
    const saida = simplificarPendenciaParaReserva(pendenciaDoCliente(FUNDAMENTO_LEGAL));
    expect(saida).not.toMatch(PROIBIDO);
    expect(saida).not.toMatch(/2\.200-2|128\/2022/);
  });

  it('pega a recusa que só cita a ICP-Brasil, sem falar em assinatura eletrônica', () => {
    const saida = simplificarPendenciaParaReserva(pendenciaDoCliente(SO_ICP));
    expect(saida).not.toMatch(/icp-brasil/i);
    expect(saida).toMatch(/procuração/i);
  });

  it('explica a recusa uma vez só, mesmo com vários parágrafos sobre ela', () => {
    const saida = simplificarPendenciaParaReserva(pendenciaDoCliente(FUNDAMENTO_LEGAL)) || '';
    const vezes = saida.split(RECUSA_EM_PORTUGUES).length - 1;
    expect(vezes).toBe(1);
  });

  it('nunca perde o prazo', () => {
    for (const d of [ZAPSIGN_NOMEADA, FUNDAMENTO_LEGAL]) {
      const antes = pendenciaDoCliente(d) || '';
      expect(antes).toContain('⏳');
      expect(simplificarPendenciaParaReserva(antes)).toContain('⏳');
    }
  });

  it('não mexe na exigência que pede dois papéis sem juridiquês', () => {
    const antes = pendenciaDoCliente(DOIS_PAPEIS);
    expect(simplificarPendenciaParaReserva(antes)).toBe(antes);
    expect(simplificarPendenciaParaReserva(antes)).toMatch(/TERMO DE RESPONSABILIDADE/);
  });

  it('deixa intacta a exigência que não fala de procuração', () => {
    for (const d of [SEM_PROCURACAO, BIOMETRIA]) {
      const antes = pendenciaDoCliente(d);
      expect(simplificarPendenciaParaReserva(antes)).toBe(antes);
    }
    // O porteiro existe por causa desta linha: ela cai se o corte for geral.
    expect(simplificarPendenciaParaReserva(pendenciaDoCliente(BIOMETRIA))).toMatch(
      /Maior de 80 anos que apresente documento válido com foto/,
    );
  });

  it('aguenta entrada vazia', () => {
    expect(simplificarPendenciaParaReserva(null)).toBeNull();
    expect(simplificarPendenciaParaReserva('')).toBe('');
  });
});

describe('fallbackMensagemCliente na exigência de procuração', () => {
  it('sai limpo em todos os despachos de recusa', () => {
    for (const d of [ZAPSIGN_NOMEADA, FUNDAMENTO_LEGAL, SO_ICP]) {
      const texto = fallbackMensagemCliente('exigencia', {
        pontosPendentes: pendenciaDoCliente(d),
        beneficio: 'Benefício Assistencial à Pessoa com Deficiência',
      });
      expect(texto).not.toMatch(PROIBIDO);
      expect(texto).toContain('Manda aqui no grupo o que você conseguir');
    }
  });

  it('continua repetindo a pendência quando não há o que limpar', () => {
    const texto = fallbackMensagemCliente('exigencia', {
      pontosPendentes: pendenciaDoCliente(SEM_PROCURACAO),
    });
    expect(texto).toMatch(/Carteira de Trabalho e Previdência Social/);
  });
});

// ============================================================================
// Mensagem automática para o grupo do cliente quando o INSS mexe no pedido.
//
// O grupo tem CLIENTE + equipe do escritório, então o texto fala com o cliente
// e a equipe lê junto. Duas decisões estruturais, ambas medidas em 26/08/2026
// sobre `inss_status_history` (4.014 eventos):
//
// 1. NEM TODO STATUS VIRA MENSAGEM. Silenciam:
//    - "Em Análise" e "Pendente": o despacho ali é texto do PRÓPRIO escritório
//      no Meu INSS ("Segue procuração assinada", "Atestados médicos e fotos"),
//      não notícia do INSS.
//    - "Cancelada": dos 25 cancelamentos com despacho, todos são pedido nosso
//      ou do cliente ("DESEJO CANCELAR ESSE REQUERIMENTO"). Avisar seria contar
//      ao cliente algo que nós mesmos fizemos.
//    - "Concluída" sem veredito (193 de 643): dizer "seu pedido foi concluído"
//      sem dizer se ganhou ou perdeu é pior que não dizer nada.
//    - "PARSE_FAILED" e status desconhecido: não sabemos o que houve.
//
// 2. O TEXTO SAI DO DESPACHO, NÃO DO NOME DO STATUS. A IA recebe o texto real
//    do e-mail do INSS e reescreve em linguagem simples. Exceção: "Protocolado"
//    nunca tem despacho (0 de 296), então ali é template puro, sem IA.
//
// Nada de número de CPF, NB ou RG no texto — o despacho do INSS traz o NB por
// extenso ("nº 732.257.379-0") e o prompt proíbe reproduzir.
// ============================================================================

export type TipoMensagemCliente =
  | 'protocolado'
  | 'exigencia'
  | 'deferido'
  | 'indeferido'
  | 'arquivado_decurso';

export interface EntradaMensagemCliente {
  /** `inss_status_history.to_status` */
  status?: string | null;
  /** `inss_admin_processes.resultado`, ou o classificado do despacho */
  resultado?: string | null;
  /** `inss_status_history.despacho` — o corpo do e-mail do INSS */
  despacho?: string | null;
  /** Saída de `extrairPontosPendentes`, só nas exigências */
  pontosPendentes?: string | null;
  nome?: string | null;
  beneficio?: string | null;
  requerimento?: string | null;
}

/**
 * Que mensagem esse evento merece — ou `null` quando o certo é ficar calado.
 * A ordem importa: conclusão é decidida pelo veredito, não pelo status.
 */
export function classificarMensagemCliente(
  e: EntradaMensagemCliente,
): TipoMensagemCliente | null {
  const status = e.status || '';
  if (/protocolad/i.test(status)) return 'protocolado';
  if (/exig[êe]nc/i.test(status)) return 'exigencia';
  if (/conclu[íi]d/i.test(status)) {
    if (e.resultado === 'deferido') return 'deferido';
    if (e.resultado === 'indeferido') return 'indeferido';
    if (e.resultado === 'arquivado_decurso') return 'arquivado_decurso';
    return null; // conclusão sem veredito: só atividade interna
  }
  return null;
}

/**
 * Rótulo curto do benefício — por whitelist, nunca repetindo o texto cru.
 *
 * `inss_admin_processes.benefit_type` é recorte de e-mail e vem sujo: de 988
 * processos, 441 estão vazios e ~55 guardam fragmento do corpo do e-mail,
 * alguns COM O NÚMERO DO BENEFÍCIO dentro ("(NB) 2466847943. Aguarde
 * correspondência..."). Ecoar esse campo mandaria número de benefício para o
 * grupo do cliente. Por isso: só sai o que a whitelist reconhece; o resto vira
 * "seu pedido no INSS". Medido em 26/08/2026.
 */
export function beneficioLegivel(beneficio?: string | null): string {
  const b = (beneficio || '')
    .replace(/\s+/g, ' ')
    .split(/\bData\b|\(NB\)/i)[0]
    .trim();
  if (!b) return 'seu pedido no INSS';
  if (/bpc|loas|assistencial à pessoa com defici|assistencial a pessoa com defici/i.test(b))
    return 'seu pedido de BPC/LOAS';
  if (/assistencial ao idoso/i.test(b)) return 'seu pedido de BPC/LOAS do idoso';
  if (/aux[íi]lio.?acidente/i.test(b)) return 'seu pedido de auxílio-acidente';
  if (/aux[íi]lio.?doen|incapacidade/i.test(b)) return 'seu pedido de auxílio por incapacidade';
  if (/sal[áa]rio.?maternidade/i.test(b)) return 'seu pedido de salário-maternidade';
  if (/pens[ãa]o por morte/i.test(b)) return 'seu pedido de pensão por morte';
  if (/aposentadoria/i.test(b)) return 'seu pedido de aposentadoria';
  if (/recurso/i.test(b)) return 'seu recurso no INSS';
  if (/revis[ãa]o/i.test(b)) return 'seu pedido de revisão';
  return 'seu pedido no INSS';
}

/**
 * Última barreira antes de mandar: mascara CPF e número de benefício que a IA
 * possa ter copiado do despacho. Data (dd/mm/aaaa) e número de protocolo curto
 * ficam — o que não pode sair é documento.
 */
export function mascararDocumentos(texto: string): string {
  return texto
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{1,2}\b/g, '***')
    .replace(/\b\d{11,}\b/g, '***');
}

/**
 * Texto garantido, sem IA. É o que sai quando o Gemini falha ou não há chave —
 * e é a mensagem definitiva do "protocolado", que não tem despacho para
 * humanizar. Nunca inclui número de documento.
 */
export function fallbackMensagemCliente(
  tipo: TipoMensagemCliente,
  e: EntradaMensagemCliente,
): string {
  const alvo = beneficioLegivel(e.beneficio);
  switch (tipo) {
    case 'protocolado':
      return (
        `✅ ${maiuscula(alvo)} já entrou no INSS.\n\n` +
        `Agora é esperar a análise. Costuma demorar algumas semanas.\n\n` +
        `A gente acompanha e avisa aqui quando tiver novidade.`
      );
    case 'exigencia':
      return (
        `⚠️ O INSS pediu documentos pra continuar ${alvo}.\n\n` +
        (e.pontosPendentes ? `${e.pontosPendentes}\n\n` : '') +
        `Manda aqui no grupo o que você conseguir. A gente envia pro INSS.`
      );
    case 'deferido':
      return (
        `🎉 ${maiuscula(alvo)} foi aprovado!\n\n` +
        `A gente vai conferir os valores e te explica o que acontece agora.`
      );
    case 'indeferido':
      return (
        `O INSS não aprovou ${alvo} agora.\n\n` +
        `Dá pra pedir pro INSS olhar de novo, e a gente já está cuidando disso.\n\n` +
        `Logo falamos com você. Não precisa fazer nada agora.`
      );
    case 'arquivado_decurso':
      return (
        `O INSS encerrou ${alvo} porque o prazo dos documentos acabou.\n\n` +
        `Ainda dá pra fazer alguma coisa. A gente vê o melhor jeito e te avisa aqui.`
      );
  }
}

/** "seu pedido de BPC/LOAS" → "Seu pedido de BPC/LOAS", pra abrir frase. */
function maiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const REGRAS_COMUNS = [
  'Escreva para uma pessoa de baixa renda e pouca escolaridade. Frases curtas, palavras do dia a dia.',
  'Troque palavra difícil por palavra simples: "mandar" no lugar de "encaminhar"; "papéis" ou "documentos" no lugar de "documentação"; "pedir pro INSS olhar de novo" no lugar de "recorrer"; "pedido" no lugar de "requerimento"; "não aprovou" no lugar de "indeferiu".',
  'Nada de termo jurídico, nada de número de lei, nada de "conforme", "referente", "mediante", "providenciar".',
  'Seja breve. É melhor faltar detalhe do que a pessoa não entender.',
  'NUNCA repita número de CPF, RG ou número do benefício que apareça no texto do INSS.',
  // Correção do usuário (01/09/2026): procuração é pendência DO CLIENTE — ele
  // imprime, assina à caneta e devolve, que é o que o INSS passou a exigir. O
  // que segue sendo nosso é só o documento pessoal do advogado. O corte
  // principal é o `separarPendencias`, em lib/inss-despacho; esta regra é a
  // segunda barreira, para o fragmento em que o INSS emenda os dois pedidos na
  // mesma frase e o corte, de propósito, não separa.
  'NUNCA peça o documento de identificação, RG, CPF, foto ou carteira da OAB do advogado ou do procurador: esse documento é do escritório e o cliente não tem como conseguir.',
  'Procuração, termo de representação e termo de responsabilidade SÃO do cliente: pode pedir. Fale deles do jeito simples — "assinar a procuração", "assinar o papel" —, nunca "assinatura digital", "assinatura eletrônica", "validação" nem nome de site.',
  'Não invente prazo, valor, data de pagamento nem motivo que não esteja no texto do INSS.',
  'Não comece com "Bom dia"/"Boa tarde" — não sabemos a hora.',
  'No máximo 2 emojis na mensagem inteira. Não assine.',
];

const INSTRUCAO_POR_TIPO: Record<TipoMensagemCliente, string> = {
  protocolado: '', // não usa IA
  exigencia:
    'O INSS pediu documentos. Diga em uma linha que o INSS pediu documentos e liste o que a ' +
    'pessoa precisa juntar, um por linha, começando com "•". Use o nome popular do documento ' +
    '(ex.: "RG ou CNH", "certidão de nascimento", "receita do remédio"). Cada linha com no ' +
    'máximo 12 palavras. Junte pedidos parecidos numa linha só. Se houver prazo, ponha numa ' +
    'linha no fim começando com "⏳ Prazo:". Termine dizendo que é só mandar no grupo que o ' +
    'escritório envia pro INSS. No máximo 5 itens na lista.',
  deferido:
    'O pedido foi APROVADO. Dê a notícia boa em uma frase curta. Se o INSS avisar de alguma ' +
    'obrigação futura importante (por exemplo manter cadastro atualizado), diga em uma linha ' +
    'simples. Termine dizendo que o escritório vai conferir os valores e explicar o que vem ' +
    'agora. No máximo 3 linhas.',
  indeferido:
    'O pedido NÃO foi aprovado. Dê a notícia em uma frase curta e sem drama. Diga o motivo do ' +
    'INSS em palavras simples. Diga que dá pra pedir pro INSS olhar de novo e que o escritório ' +
    'já está cuidando disso. Não prometa que vai ganhar. Não peça nada agora. No máximo 4 linhas.',
  arquivado_decurso:
    'O pedido foi encerrado porque o prazo dos documentos acabou. Diga isso sem culpar a pessoa. ' +
    'Diga que o escritório vai ver o melhor jeito de continuar e avisa aqui. No máximo 3 linhas.',
};

/**
 * Prompt do humanizador. Devolve `null` quando o tipo não usa IA (protocolado)
 * ou quando não há despacho para reescrever — nesses casos vale o fallback,
 * que já é a mensagem certa e não corre risco de alucinação.
 */
export function promptMensagemCliente(
  tipo: TipoMensagemCliente,
  e: EntradaMensagemCliente,
): string | null {
  if (tipo === 'protocolado') return null;
  const fonte = (tipo === 'exigencia' ? e.pontosPendentes || e.despacho : e.despacho) || '';
  if (fonte.trim().length < 40) return null;
  return [
    'Você escreve mensagens de WhatsApp para o cliente de um escritório de advocacia previdenciária.',
    'O grupo tem o cliente e a equipe do escritório.',
    '',
    `Assunto: ${beneficioLegivel(e.beneficio)}.`,
    '',
    'Texto que o INSS enviou (reescreva a partir dele, não copie):',
    '"""',
    fonte.slice(0, 2500),
    '"""',
    '',
    `Tarefa: ${INSTRUCAO_POR_TIPO[tipo]}`,
    '',
    'Regras:',
    ...REGRAS_COMUNS.map((r) => `- ${r}`),
    '',
    'Responda só com a mensagem, sem aspas e sem comentários.',
  ].join('\n');
}

// ============================================================================
// Janela de envio e corte retroativo
// ============================================================================

/** Só manda mensagem ao cliente entre 8h e 20h de Brasília. */
export const JANELA_INICIO_HORA = 8;
export const JANELA_FIM_HORA = 20;
const FUSO = 'America/Sao_Paulo';

/**
 * Hora do dia em Brasília (0–23). O Railway roda em UTC, então comparar
 * `getHours()` mandaria mensagem às 5h da manhã achando que são 8h.
 */
export function horaEmBrasilia(quando: Date): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(quando);
  return Number(h);
}

export function dentroDaJanela(quando: Date): boolean {
  const h = horaEmBrasilia(quando);
  return h >= JANELA_INICIO_HORA && h < JANELA_FIM_HORA;
}

/**
 * Corte retroativo. 28% dos e-mails do INSS chegam fora da janela (1.467 de
 * 2.039 dentro, 572 fora — medido em 26/08/2026), e há 1.480 eventos antigos
 * nunca notificados no histórico. Sem este corte, ligar o envio despejaria
 * notícia velha no grupo de cliente que já foi avisado por outro caminho —
 * ou pior, notícia de pedido que já teve desfecho depois.
 *
 * Só evento cujo e-mail chegou DEPOIS deste instante vira mensagem. Nada de
 * backfill: pedido do usuário em 26/08/2026.
 */
export const ZAP_CLIENTE_DESDE =
  process.env.INSS_ZAP_CLIENTE_DESDE || '2026-08-26T12:00:00Z';

export function eventoElegivelParaZap(emailRecebidoEm?: string | null): boolean {
  if (!emailRecebidoEm) return false;
  const t = Date.parse(emailRecebidoEm);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(ZAP_CLIENTE_DESDE);
}

// ============================================================================
// Exigência de agendamento de perícia — quem agenda é o escritório
// ============================================================================
// Pedido do usuário (27/08/2026): quando o INSS manda agendar perícia, o cliente
// NÃO recebe mensagem. A ligação para o 135 (ou o agendamento no Meu INSS) é
// tarefa do escritório, não do cliente.
//
// O corte é em "agendar", nunca em "135": das 597 exigências do histórico, 495
// citam o 135 e só 244 pedem agendamento — nas outras 228 o 135 é apenas o
// telefone de contato no rodapé de um pedido de DOCUMENTOS, que continua indo
// para o cliente porque é ele quem tem os papéis.
//
// Também não pode pegar as 8 convocações: "sua perícia foi remarcada ...
// compareça no dia X" e "será necessário remarcar" avisam data e local de uma
// perícia JÁ marcada. Essas o cliente precisa receber, senão falta na perícia.
// Por isso o gatilho é o imperativo ("Agende") ou a construção de necessidade
// ("é preciso/é necessário/deverá agendar") — nenhuma delas aparece nas
// convocações, que dizem "convocamos para que compareça".
const PEDE_AGENDAMENTO = [
  /\bagende\b/i,
  /(?:é|e)\s+(?:preciso|necess[áa]rio)\s+agendar/i,
  /(?:precisa|dever[áa]|deve|favor)\s+(?:de\s+)?agendar/i,
];
const ASSUNTO_PERICIA = /per[íi]cia|avalia[çc][ãa]o social/i;

/**
 * O INSS está pedindo que alguém MARQUE uma perícia? Então é tarefa do
 * escritório e o cliente não é avisado — ver `zap_status = 'pericia_escritorio'`.
 */
export function exigenciaDeAgendamentoDePericia(e: EntradaMensagemCliente): boolean {
  const fonte = `${e.pontosPendentes || ''} ${e.despacho || ''}`;
  if (!ASSUNTO_PERICIA.test(fonte)) return false;
  return PEDE_AGENDAMENTO.some((re) => re.test(fonte));
}

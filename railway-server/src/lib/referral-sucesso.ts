// Quem indicou merece saber que deu certo — a lógica, sem banco e sem rede.
//
// Tudo aqui é função pura: recebe linha, devolve decisão ou texto. Os dois
// crons (`referral-success-scan` e `referral-thanks-dispatch`) só fazem I/O e
// chamam daqui. O motivo é conseguir testar a parte que erra feio — "isso conta
// como deu certo?" e "essa resposta foi um sim?" — sem subir nada.

import { FUSO } from './diasSaoPaulo';

// ============================================================================
// O QUE CONTA COMO "DEU CERTO"
// ============================================================================
// Quatro sinais, escolhidos com o Raym em 15/09/2026. Os três primeiros são
// inequívocos: o banco só registra o fato depois que ele aconteceu. O quarto
// não é — e por isso não vira mensagem sozinho (ver `SENTENCA_VAI_PARA_REVISAO`).

export type TipoDeDesfecho = 'pagamento' | 'inss_deferido' | 'acordo' | 'sentenca_revisar';

/**
 * Força do desfecho. Quando o mesmo caso tem mais de um (acordo homologado e
 * depois alvará levantado), vence o mais forte — é o que a pessoa quer ouvir.
 * Pagamento ganha de tudo: dinheiro na mão não admite discussão.
 */
const FORCA: Record<TipoDeDesfecho, number> = {
  pagamento: 4,
  inss_deferido: 3,
  acordo: 2,
  sentenca_revisar: 1,
};

/** Marcos de `process_movements` que viram desfecho aqui. */
export const MARCOS_DE_SUCESSO: Record<string, TipoDeDesfecho> = {
  pagamento: 'pagamento',
  acordo: 'acordo',
  sentenca_1grau: 'sentenca_revisar',
};

/**
 * Por que a sentença não dispara mensagem sozinha.
 *
 * O marco `sentenca_1grau` não distingue procedente de improcedente — e não é
 * limitação do parser, é do dado. Conferido no banco em 15/09/2026: das 287
 * sentenças gravadas, 284 não têm a palavra "procedente" em lugar nenhum da
 * descrição, porque a descrição é o cabeçalho da movimentação, não o teor. Das
 * 3 que têm, 1 é improcedente.
 *
 * A outra fonte possível, `lead_processes.resultado_atingido_status =
 * 'confirmado'`, tem 2 linhas na base inteira — e o rótulo vem do POP, que
 * mapeia UM resultado por marco, então também não separa ganhou de perdeu.
 *
 * Mandar "o caso do seu indicado deu certo!" quando a ação foi julgada
 * improcedente não é um bug de texto: é o escritório dando notícia falsa a um
 * cliente sobre outro. Então a sentença é DETECTOR, não gatilho — cai na fila
 * `thanks_status='revisar'`, alguém olha e libera. É o mesmo princípio do
 * `conserto-estrutural-nao-pontual`: a heurística classifica e roteia, não
 * decide sozinha nem esconde.
 */
export const SENTENCA_VAI_PARA_REVISAO = true;

export interface CandidatoDeDesfecho {
  tipo: TipoDeDesfecho;
  /** id da linha que prova o fato, para auditoria. */
  ref: string;
  /** Data do fato (YYYY-MM-DD), não a data da varredura. */
  data: string | null;
  /** Como a mensagem vai chamar isso, em português de gente. */
  rotulo: string;
}

export interface EntradaDoScan {
  /** Requerimentos INSS do lead indicado (resultado já filtrado em 'deferido'). */
  inssDeferidos: Array<{ id: string; benefit_type?: string | null; servico?: string | null; protocol_date?: string | null }>;
  /** Marcos não descartados do lead indicado. */
  marcos: Array<{ id: string; tipo_movimentacao: string; data_movimentacao?: string | null }>;
}

/**
 * Nome do benefício em linguagem de cliente. O banco guarda "Benefício
 * Assistencial ao Deficiente" e a pessoa chama de "BPC". Sem correspondência,
 * devolve o genérico — nunca inventa um benefício que não está escrito.
 */
export function rotuloDoBeneficio(benefit?: string | null, servico?: string | null): string {
  const t = semAcento(`${benefit || ''} ${servico || ''}`);
  if (t.includes('bpc') || t.includes('loas') || t.includes('assistencial')) return 'o BPC/LOAS';
  if (t.includes('incapacidade temporaria') || t.includes('auxilio-doenca') || t.includes('auxilio doenca')) return 'o auxílio-doença';
  if (t.includes('incapacidade permanente') || t.includes('aposentadoria por invalidez')) return 'a aposentadoria por incapacidade';
  if (t.includes('maternidade')) return 'o salário-maternidade';
  if (t.includes('pensao por morte')) return 'a pensão por morte';
  if (t.includes('acidente')) return 'o auxílio-acidente';
  if (t.includes('aposentadoria')) return 'a aposentadoria';
  return 'o benefício';
}

/** Escolhe o desfecho mais forte entre os sinais do lead. `null` = nada ainda. */
export function escolherDesfecho(entrada: EntradaDoScan): CandidatoDeDesfecho | null {
  const candidatos: CandidatoDeDesfecho[] = [];

  for (const r of entrada.inssDeferidos || []) {
    candidatos.push({
      tipo: 'inss_deferido',
      ref: r.id,
      data: r.protocol_date || null,
      rotulo: `${rotuloDoBeneficio(r.benefit_type, r.servico)} foi concedido`,
    });
  }

  for (const m of entrada.marcos || []) {
    const tipo = MARCOS_DE_SUCESSO[m.tipo_movimentacao];
    if (!tipo) continue;
    candidatos.push({
      tipo,
      ref: m.id,
      data: (m.data_movimentacao || '').slice(0, 10) || null,
      rotulo:
        tipo === 'pagamento' ? 'o pagamento saiu'
        : tipo === 'acordo' ? 'o acordo foi fechado'
        : 'saiu a sentença',
    });
  }

  if (!candidatos.length) return null;
  // Mais forte primeiro; empate na força, o mais recente.
  candidatos.sort((a, b) => FORCA[b.tipo] - FORCA[a.tipo] || (b.data || '').localeCompare(a.data || ''));
  return candidatos[0];
}

/** Desfecho que pode virar mensagem sem humano no meio. */
export function ehInequivoco(tipo: TipoDeDesfecho): boolean {
  return tipo !== 'sentenca_revisar';
}

// ============================================================================
// CONSENTIMENTO
// ============================================================================

/**
 * Prazo do pedido. Cinco dias cobre quem só abre o WhatsApp no fim de semana e
 * não é tempo demais para uma notícia esfriar. Passou disso, expira: silêncio
 * não vira autorização por cansaço.
 */
export const CONSENT_VALIDADE_DIAS = 5;

/**
 * O pedido de autorização, que vai para o PRÓPRIO indicado.
 *
 * Esta mensagem não revela nada de terceiro: fala do caso da pessoa com a
 * pessoa. O único dado de fora é o nome de quem a indicou — que ela já sabe,
 * porque foi indicada por ele. Quando não temos o nome, não inventamos.
 *
 * O "não" tem que ser tão fácil quanto o "sim", e escrito primeiro na frase de
 * fechamento. Pedido de consentimento redigido para arrancar o sim não é
 * consentimento, é formulário.
 */
export function textoPedidoDeConsentimento(args: {
  nomeDoIndicado?: string | null;
  nomeDoIndicador?: string | null;
  rotuloDoDesfecho: string;
}): string {
  const oi = primeiroNome(args.nomeDoIndicado);
  const quem = primeiroNome(args.nomeDoIndicador);
  return [
    oi ? `Oi, ${oi}! Tudo bem?` : 'Oi! Tudo bem?',
    '',
    `Que bom que ${args.rotuloDoDesfecho}. 🎉`,
    '',
    quem
      ? `Queria te pedir uma coisa: foi ${quem} quem passou seu contato pra gente. Posso contar pra ${quem} que deu certo?`
      : 'Queria te pedir uma coisa: uma pessoa conhecida sua passou seu contato pra gente. Posso contar pra ela que deu certo?',
    '',
    'Se preferir que fique só entre nós, é só me dizer que não — sem problema nenhum, e nada muda no seu caso.',
  ].join('\n');
}

/**
 * Lê a resposta do cliente sem gastar IA no caso fácil.
 *
 * Devolve 'indefinido' de propósito quando há qualquer dúvida — quem decide
 * o duvidoso é a IA, e se a IA também não souber, ninguém é avisado. O custo de
 * um falso 'sim' aqui é contar a um terceiro o que o cliente não autorizou; o
 * custo de um falso 'indefinido' é uma chamada de Gemini Flash. Não são
 * comparáveis.
 */
export function interpretarResposta(texto?: string | null): 'sim' | 'nao' | 'indefinido' {
  const t = semAcento(texto || '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return 'indefinido';

  // "não tem problema" / "não vejo problema" / "por mim não tem problema" são
  // SIM com a palavra "não" dentro. Tratados antes de qualquer regra de negação,
  // senão viram recusa e a autorização real se perde.
  const negacaoQueEhSim = /\bnao (tem|ha|vejo|teria) (problema|nenhum problema)\b|\bsem problema\b|\bnao me importo\b|\bnao vejo nenhum problema\b/;
  const ehSimDisfarcado = negacaoQueEhSim.test(t);

  const recusa = /\b(nao pode|prefiro que nao|melhor nao|nao quero|nao autorizo|nao gostaria|nao precisa|nao conte|nao fale|nao avise|nao comente|deixa pra la|prefiro nao)\b/;
  if (!ehSimDisfarcado && recusa.test(t)) return 'nao';

  const aceite = /\b(pode sim|pode contar|pode falar|pode avisar|pode compartilhar|sim|claro|com certeza|autorizo|tranquilo|beleza|pode ser|sem problemas?|fique a vontade|manda|conta sim|pode)\b/;
  if (ehSimDisfarcado || aceite.test(t)) {
    // "não" solto sobrando junto de um aceite é sinal contraditório: não decide.
    if (!ehSimDisfarcado && /\bnao\b/.test(t)) return 'indefinido';
    return 'sim';
  }

  return 'indefinido';
}

// ============================================================================
// O AVISO A QUEM INDICOU
// ============================================================================

/**
 * Trava de 30 dias por indicador.
 *
 * Um acolhedor com 188 indicações (o grupo TERRAS ALPHAVILLE, medido em
 * 14/09/2026) receberia 188 mensagens numa semana ruim. Vira spam, queima o
 * número e queima justamente a pessoa que mais indica. Uma mensagem por mês,
 * cobrindo todos os desfechos acumulados do período, diz a mesma coisa e é lida.
 */
export const DIAS_ENTRE_AVISOS = 30;

export const JANELA_INICIO_HORA = 8;
export const JANELA_FIM_HORA = 20;

export function horaEmBrasilia(quando: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).format(quando),
  );
}

/** Ninguém recebe notícia de escritório às 3 da manhã. */
export function dentroDaJanela(quando: Date): boolean {
  const h = horaEmBrasilia(quando);
  return h >= JANELA_INICIO_HORA && h < JANELA_FIM_HORA;
}

export function passaramOsDias(ultimoEnvio: string | null | undefined, agora: Date, dias = DIAS_ENTRE_AVISOS): boolean {
  if (!ultimoEnvio) return true;
  const t = Date.parse(ultimoEnvio);
  if (Number.isNaN(t)) return true;
  return agora.getTime() - t >= dias * 24 * 60 * 60 * 1000;
}

export interface DesfechoParaContar {
  nomeDoIndicado: string;
  rotulo: string;
}

/**
 * O texto do aviso.
 *
 * Determinístico de propósito: a IA reescreve por cima quando disponível
 * (`referral-thanks-dispatch`), mas se ela falhar a pessoa recebe esta versão,
 * que já está correta. Ninguém deixa de receber notícia boa por causa de API de
 * terceiro — mesma decisão do `montarTextoMensagemCliente` do INSS.
 *
 * O que a mensagem NÃO faz: não promete nada a ninguém, não pede indicação nova
 * explicitamente e não diz valor. O convite no fim é uma porta aberta, não uma
 * cobrança — quem acabou de saber que ajudou alguém não precisa de call to
 * action, precisa de um obrigado.
 */
export function textoDoAviso(args: {
  nomeDoIndicador?: string | null;
  desfechos: DesfechoParaContar[];
}): string {
  const oi = primeiroNome(args.nomeDoIndicador);
  const abre = oi ? `Oi, ${oi}! Tudo bem?` : 'Oi! Tudo bem?';

  if (args.desfechos.length === 1) {
    const d = args.desfechos[0];
    return [
      abre,
      '',
      `Passei só pra te dar uma notícia boa: ${primeiroNome(d.nomeDoIndicado) || 'a pessoa'}, que você indicou pra gente, ${d.rotulo}. ✅`,
      '',
      'Ele(a) autorizou a gente te contar — e a gente queria que você soubesse, porque isso começou com você passar o contato.',
      '',
      'Muito obrigado pela confiança. 🙏',
    ].join('\n');
  }

  const lista = args.desfechos
    .map((d) => `• ${primeiroNome(d.nomeDoIndicado) || 'uma pessoa'} — ${d.rotulo}`)
    .join('\n');
  return [
    abre,
    '',
    `Passei pra te contar: ${args.desfechos.length} pessoas que você indicou pra gente já tiveram notícia boa.`,
    '',
    lista,
    '',
    'Todas autorizaram a gente te contar — e a gente queria que você soubesse, porque cada uma dessas começou com você passar um contato.',
    '',
    'Muito obrigado pela confiança. 🙏',
  ].join('\n');
}

// ============================================================================

export function primeiroNome(nome?: string | null): string {
  const limpo = (nome || '').trim().replace(/\s+/g, ' ');
  if (!limpo) return '';
  // Cartão de contato vem com lixo ("Cliente - João (obra)"). Pega a primeira
  // palavra que parece nome e não é rótulo.
  const primeira = limpo.split(' ')[0];
  if (/^\d+$/.test(primeira) || primeira.length < 2) return '';
  return primeira.charAt(0).toUpperCase() + primeira.slice(1);
}

function semAcento(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Telefone em log sai mascarado — mesma regra do referral-outreach. */
export function mascarar(telefone?: string | null): string {
  const t = telefone || '';
  return t ? `${t.slice(0, 4)}****${t.slice(-2)}` : '';
}

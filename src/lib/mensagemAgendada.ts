/**
 * Mensagem agendada do WhatsApp: quando sai e quando volta a sair.
 *
 * A conta de "próximo envio" existe em DOIS lugares — aqui e no banco
 * (`public.wa_agendada_proximo`, migration
 * 20260825170000_mensagem_agendada_com_recorrencia.sql). O BANCO É A FONTE DA
 * VERDADE: é ele que dispara. Este arquivo serve para a tela poder mostrar,
 * antes de salvar, exatamente o que vai acontecer ("sai 26/08 08:00, depois
 * 02/09, depois 09/09"). Os dois seguem as mesmas três regras:
 *
 *   1. o horário do dia nunca muda — só a data anda;
 *   2. mês curto encurta o dia (31/01 mensal → 28/02), igual ao
 *      `+ interval '1 month'` do Postgres e ao `addMonths` do date-fns;
 *   3. se o disparo atrasou (sistema parado), a data anda até passar de agora,
 *      em vez de despejar de uma vez todos os envios perdidos.
 *
 * Mexeu aqui, mexa lá.
 */
import { addDays, addMonths, addWeeks, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type Repeticao = 'nenhuma' | 'diaria' | 'semanal' | 'mensal' | 'personalizada';
export type Unidade = 'dias' | 'semanas' | 'meses';

export interface RegraDeRepeticao {
  repeticao: Repeticao;
  /** Só vale em 'personalizada': "a cada N". */
  intervalo: number;
  /** Só vale em 'personalizada'. */
  unidade: Unidade;
  /** Só vale em 'semanal'. 0 = domingo … 6 = sábado. Vazio = o dia do 1º envio. */
  diasDaSemana: number[];
  /** Último dia em que ainda pode sair. null = sem fim. */
  repetirAte: Date | null;
  /** Quantos envios no total, contando o primeiro. null = sem limite. */
  maxEnvios: number | null;
}

export const REGRA_PADRAO: RegraDeRepeticao = {
  repeticao: 'nenhuma',
  intervalo: 1,
  unidade: 'semanas',
  diasDaSemana: [],
  repetirAte: null,
  maxEnvios: null,
};

const NOMES_DOS_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const NOMES_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Rótulos dos botões de dia da semana, na ordem em que aparecem na tela. */
export const DIAS_DA_SEMANA = NOMES_CURTOS.map((label, valor) => ({ valor, label }));

/** Teto de segurança: nenhuma regra sã precisa de mil saltos para achar a próxima data. */
const MAX_SALTOS = 1000;

/**
 * Quando esta mensagem sai de novo, depois de ter saído em `anterior`.
 *
 * Devolve null quando não há próximo envio: sem repetição, passou de
 * `repetirAte` ou bateu o `maxEnvios`.
 */
export function proximoEnvio(
  anterior: Date,
  regra: RegraDeRepeticao,
  agora: Date = new Date(),
  jaEnviados = 1,
): Date | null {
  if (regra.repeticao === 'nenhuma') return null;
  if (regra.maxEnvios !== null && jaEnviados >= regra.maxEnvios) return null;

  let candidato = anterior;
  for (let salto = 0; salto < MAX_SALTOS; salto++) {
    candidato = andarUmPasso(candidato, regra);
    if (regra.repetirAte && candidato > fimDoDia(regra.repetirAte)) return null;
    // Disparo atrasado não vira enxurrada: pula o que ficou para trás.
    if (candidato > agora) return candidato;
  }
  return null;
}

/** Um passo da regra, sem olhar limite nem "já passou". */
function andarUmPasso(data: Date, regra: RegraDeRepeticao): Date {
  switch (regra.repeticao) {
    case 'diaria':
      return addDays(data, 1);
    case 'semanal': {
      const dias = normalizarDias(regra.diasDaSemana);
      // Sem dia escolhido, "toda semana" é o mesmo dia da semana do 1º envio.
      if (dias.length === 0) return addWeeks(data, 1);
      // Com dias escolhidos, anda de um em um até cair num deles.
      let proximo = addDays(data, 1);
      while (!dias.includes(proximo.getDay())) proximo = addDays(proximo, 1);
      return proximo;
    }
    case 'mensal':
      return addMonths(data, 1);
    case 'personalizada': {
      const n = Math.max(1, Math.trunc(regra.intervalo || 1));
      if (regra.unidade === 'dias') return addDays(data, n);
      if (regra.unidade === 'semanas') return addWeeks(data, n);
      return addMonths(data, n);
    }
    default:
      return data;
  }
}

function normalizarDias(dias: number[]): number[] {
  return Array.from(new Set((dias || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort();
}

/** `repetirAte` é escolhido como data (sem hora) — vale o dia inteiro. */
function fimDoDia(data: Date): Date {
  const fim = new Date(data);
  fim.setHours(23, 59, 59, 999);
  return fim;
}

/** Os próximos envios, para a tela mostrar antes de salvar. Inclui o primeiro. */
export function listarProximosEnvios(
  primeiro: Date,
  regra: RegraDeRepeticao,
  agora: Date = new Date(),
  quantos = 4,
): Date[] {
  const lista = [primeiro];
  let atual = primeiro;
  while (lista.length < quantos) {
    const proximo = proximoEnvio(atual, regra, agora, lista.length);
    if (!proximo) break;
    lista.push(proximo);
    atual = proximo;
  }
  return lista;
}

/**
 * A frase que descreve o agendamento — a mesma que fica no card depois de
 * salvo. Ex.: "Toda segunda e quinta às 08:00", "Todo dia 12 às 14:30".
 */
export function descreverAgendamento(quando: Date, regra: RegraDeRepeticao): string {
  const hora = format(quando, 'HH:mm');
  const base = (() => {
    switch (regra.repeticao) {
      case 'nenhuma':
        return format(quando, "d 'de' MMMM", { locale: ptBR });
      case 'diaria':
        return 'Todo dia';
      case 'semanal': {
        const dias = normalizarDias(regra.diasDaSemana);
        if (dias.length === 0) return `Toda ${NOMES_DOS_DIAS[quando.getDay()]}`;
        if (dias.length === 7) return 'Todo dia';
        const nomes = dias.map((d) => NOMES_DOS_DIAS[d]);
        const ultimo = nomes[nomes.length - 1];
        return nomes.length === 1 ? `Toda ${ultimo}` : `Toda ${nomes.slice(0, -1).join(', ')} e ${ultimo}`;
      }
      case 'mensal':
        return `Todo dia ${quando.getDate()}`;
      case 'personalizada': {
        const n = Math.max(1, Math.trunc(regra.intervalo || 1));
        if (n === 1) {
          return regra.unidade === 'dias' ? 'Todo dia' : regra.unidade === 'semanas' ? 'Toda semana' : 'Todo mês';
        }
        return `A cada ${n} ${regra.unidade}`;
      }
      default:
        return '';
    }
  })();

  const limite = regra.repeticao === 'nenhuma'
    ? ''
    : regra.maxEnvios
      ? `, ${regra.maxEnvios} vezes`
      : regra.repetirAte
        ? `, até ${format(regra.repetirAte, 'dd/MM/yyyy')}`
        : '';

  return `${base} às ${hora}${limite}`;
}

/**
 * A regra de uma linha já salva, remontada das colunas do banco — para a
 * conversa e a janela descreverem o agendamento com a mesma frase.
 */
export function regraDaLinha(linha: {
  repeticao: Repeticao;
  intervalo: number;
  unidade: Unidade;
  dias_da_semana?: number[] | null;
  repetir_ate?: string | null;
  max_envios?: number | null;
}): RegraDeRepeticao {
  return {
    repeticao: linha.repeticao,
    intervalo: linha.intervalo,
    unidade: linha.unidade,
    diasDaSemana: linha.dias_da_semana || [],
    // `repetir_ate` é DATE (yyyy-MM-dd): o T00:00 evita ler como UTC e voltar
    // um dia no fuso de Brasília.
    repetirAte: linha.repetir_ate ? new Date(`${linha.repetir_ate}T00:00:00`) : null,
    maxEnvios: linha.max_envios ?? null,
  };
}

/** A recorrência sozinha, sem a hora — "Toda segunda e quinta". */
export function descreverRepeticao(quando: Date, regra: RegraDeRepeticao): string {
  return descreverAgendamento(quando, regra).replace(/ às \d{2}:\d{2}/, '');
}

/**
 * O que impede de agendar. Devolve a frase do erro, ou null quando está tudo
 * certo. A tela usa isto para travar o botão e dizer por quê.
 */
export function validarAgendamento(
  texto: string,
  quando: Date | null,
  regra: RegraDeRepeticao,
  agora: Date = new Date(),
): string | null {
  if (!texto.trim()) return 'Escreva a mensagem antes de agendar.';
  if (!quando || Number.isNaN(quando.getTime())) return 'Escolha a data e a hora do envio.';
  if (quando <= agora) return 'Esse horário já passou — escolha um à frente.';
  if (regra.repeticao === 'personalizada') {
    const n = Math.trunc(regra.intervalo);
    if (!Number.isFinite(n) || n < 1 || n > 365) return 'O intervalo tem que ser de 1 a 365.';
  }
  if (regra.repeticao !== 'nenhuma' && regra.repetirAte && fimDoDia(regra.repetirAte) < quando) {
    return 'A data-limite é anterior ao primeiro envio.';
  }
  if (regra.maxEnvios !== null && (regra.maxEnvios < 1 || regra.maxEnvios > 500)) {
    return 'O número de envios tem que ser de 1 a 500.';
  }
  return null;
}

/**
 * Quanto falta para a mensagem sair, em texto curto de relógio.
 *
 * Existe porque data absoluta ("04/09 às 17:00") não responde a pergunta que a
 * pessoa faz olhando a bolha: *dá tempo de eu cancelar?*. Com janela de 5
 * minutos — que é o caso do atendente virtual — a data absoluta é inútil e a
 * contagem é a única leitura possível.
 *
 * Devolve null quando a hora já passou: aí quem manda é o disparo, não a
 * contagem, e continuar contando negativo mentiria sobre o estado.
 */
export function faltaPara(alvo: Date | string, agora: Date = new Date()): string | null {
  const destino = typeof alvo === 'string' ? new Date(alvo) : alvo;
  const ms = destino.getTime() - agora.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;

  const seg = Math.floor(ms / 1000);
  if (seg < 60) return `${seg}s`;

  const min = Math.floor(seg / 60);
  if (min < 60) return `${min}:${String(seg % 60).padStart(2, '0')}`;

  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas}h${String(min % 60).padStart(2, '0')}`;

  const dias = Math.floor(horas / 24);
  return `${dias}d${horas % 24}h`;
}

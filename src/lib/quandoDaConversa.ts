/**
 * "Ele já disse quando" — lê da própria conversa a data do próximo contato.
 *
 * Quase todo agendamento nasce de uma frase do interlocutor: "me manda na
 * segunda", "volta a falar comigo amanhã", "semana que vem eu te respondo".
 * Antes disso virar agendamento, alguém precisava ler a conversa, traduzir a
 * frase em data e digitar dia e hora na mão — três passos para uma informação
 * que já estava escrita ali.
 *
 * Isto é um LEITOR, não um adivinhador: só devolve data quando encontra a
 * expressão de tempo no texto, e devolve junto o trecho exato que a gerou, para
 * a tela poder mostrar de onde veio ("ele disse: 'me manda na segunda'"). Sem
 * expressão reconhecida, devolve null e a janela segue com a sugestão padrão.
 *
 * Determinístico de propósito: não gasta token, roda offline, e o teste prende
 * o comportamento. IA aqui traria latência e variação numa conta que é aritmética
 * de calendário.
 */

/** Hora usada quando a fala marca o dia mas não a hora ("me manda na segunda"). */
export const HORA_PADRAO = 8;

export interface QuandoDaConversa {
  /** O instante sugerido. */
  quando: Date;
  /** O pedaço da fala que gerou a data — a tela mostra como justificativa. */
  trecho: string;
  /** Como dizer isso em uma linha ("ele falou em segunda-feira"). */
  rotulo: string;
  /** true quando a fala marcou também a hora; false = hora é o padrão. */
  horaExplicita: boolean;
}

const DIAS: { nomes: string[]; indice: number; rotulo: string }[] = [
  { nomes: ['domingo'], indice: 0, rotulo: 'domingo' },
  { nomes: ['segunda', 'segunda-feira'], indice: 1, rotulo: 'segunda-feira' },
  { nomes: ['terca', 'terca-feira'], indice: 2, rotulo: 'terça-feira' },
  { nomes: ['quarta', 'quarta-feira'], indice: 3, rotulo: 'quarta-feira' },
  { nomes: ['quinta', 'quinta-feira'], indice: 4, rotulo: 'quinta-feira' },
  { nomes: ['sexta', 'sexta-feira'], indice: 5, rotulo: 'sexta-feira' },
  { nomes: ['sabado'], indice: 6, rotulo: 'sábado' },
];

/** Tira acento e baixa a caixa — "às 14h da TERÇA" e "as 14h da terca" são a mesma frase. */
const normalizar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const comHora = (base: Date, hora: number, minuto = 0): Date => {
  const d = new Date(base);
  d.setHours(hora, minuto, 0, 0);
  return d;
};

const somarDias = (base: Date, dias: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
};

/**
 * Próxima ocorrência do dia da semana, sempre à frente.
 *
 * Dia igual ao de hoje cai na semana que vem: quem diz "me manda na segunda"
 * numa segunda está falando da próxima, não de daqui a cinco minutos.
 */
const proximoDiaDaSemana = (base: Date, indice: number): Date => {
  const diff = (indice - base.getDay() + 7) % 7;
  return somarDias(base, diff === 0 ? 7 : diff);
};

/** A hora dita na frase: "às 14h", "14:30", "9 da manhã", "de tarde". */
function lerHora(texto: string): { hora: number; minuto: number; trecho: string } | null {
  // "às 3 da tarde", "9 da manhã", "8 da noite" — número SEM o "h", que só vira
  // hora cheia por causa do período dito em seguida.
  const comPeriodo = texto.match(/(\d{1,2})(?:\s*[h:]\s*(\d{2}))?\s*(?:da|de|pela)\s+(manha|tarde|noite)/);
  if (comPeriodo) {
    let hora = parseInt(comPeriodo[1], 10);
    const minuto = comPeriodo[2] ? parseInt(comPeriodo[2], 10) : 0;
    const periodo = comPeriodo[3];
    if (hora <= 12 && (periodo === 'tarde' || periodo === 'noite') && hora !== 12) hora += 12;
    if (hora === 12 && periodo === 'manha') hora = 0;
    if (hora <= 24 && minuto < 60) {
      return { hora: hora === 24 ? 0 : hora, minuto, trecho: comPeriodo[0].trim() };
    }
  }
  // "às 14h30", "as 14:30", "14h", "9 horas"
  const numerica = texto.match(/(?:as|às|@)?\s*(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?/);
  if (numerica) {
    let hora = parseInt(numerica[1], 10);
    const minuto = numerica[2] ? parseInt(numerica[2], 10) : 0;
    if (hora <= 24 && minuto < 60) {
      // "me liga às 3h, de tarde" — o período dito solto na frase ainda manda.
      const daTarde = /(da|de)\s+tarde|a\s+tarde/.test(texto);
      const daNoite = /(da|de)\s+noite|a\s+noite/.test(texto);
      if (hora < 12 && (daTarde || daNoite)) hora += 12;
      if (hora === 24) hora = 0;
      return { hora, minuto, trecho: numerica[0].trim() };
    }
  }
  if (/(de|pela)\s+manha|(de|pela)\s+manhazinha/.test(texto)) return { hora: 8, minuto: 0, trecho: 'de manhã' };
  if (/(a|de|pela)\s+tarde/.test(texto)) return { hora: 14, minuto: 0, trecho: 'à tarde' };
  if (/(a|de|pela)\s+noite/.test(texto)) return { hora: 19, minuto: 0, trecho: 'à noite' };
  return null;
}

/** A data dita em UMA fala. Null quando a fala não marca dia nenhum. */
export function lerQuandoDaFala(fala: string, agora: Date = new Date()): QuandoDaConversa | null {
  const t = normalizar(fala);
  if (!t.trim()) return null;

  const hora = lerHora(t);
  const h = hora?.hora ?? HORA_PADRAO;
  const m = hora?.minuto ?? 0;

  const devolver = (dia: Date, trecho: string, rotulo: string): QuandoDaConversa => ({
    quando: comHora(dia, h, m),
    trecho: hora ? `${trecho} ${hora.trecho}`.trim() : trecho,
    rotulo,
    horaExplicita: !!hora,
  });

  // Ordem importa: "depois de amanhã" contém "amanhã", e "semana que vem"
  // precisa ganhar de um "segunda" solto na mesma frase.
  if (/depois\s+de\s+amanha/.test(t)) {
    return devolver(somarDias(agora, 2), 'depois de amanhã', 'depois de amanhã');
  }
  if (/\bamanha\b/.test(t)) {
    return devolver(somarDias(agora, 1), 'amanhã', 'amanhã');
  }
  // "daqui a 3 dias", "em 2 semanas", "daqui uns 10 dias"
  const daqui = t.match(/(?:daqui\s+a?\s*(?:uns?\s+)?|em\s+)(\d{1,3})\s+(dias?|semanas?|mes(?:es)?)/);
  if (daqui) {
    const n = parseInt(daqui[1], 10);
    const unidade = daqui[2];
    const dias = unidade.startsWith('semana') ? n * 7 : unidade.startsWith('mes') ? n * 30 : n;
    if (dias > 0 && dias <= 365) {
      return devolver(somarDias(agora, dias), daqui[0].trim(), `daqui a ${daqui[0].replace(/^.*?(\d)/, '$1')}`);
    }
  }
  if (/(semana\s+que\s+vem|proxima\s+semana|semana\s+seguinte)/.test(t)) {
    const alvo = proximoDiaDaSemana(agora, 1); // a semana começa na segunda
    return devolver(alvo, 'semana que vem', 'semana que vem (segunda-feira)');
  }
  if (/(mes\s+que\s+vem|proximo\s+mes)/.test(t)) {
    return devolver(somarDias(agora, 30), 'mês que vem', 'mês que vem');
  }
  // Dia da semana nomeado: "na segunda", "quinta-feira", "próxima sexta".
  for (const dia of DIAS) {
    const nome = dia.nomes[0];
    const re = new RegExp(`\\b${nome}(?:-?\\s*feira)?\\b`);
    if (re.test(t)) {
      return devolver(proximoDiaDaSemana(agora, dia.indice), dia.rotulo, dia.rotulo);
    }
  }
  // "dia 15", "15/09", "no dia 3"
  const dataCurta = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dataCurta) {
    const d = parseInt(dataCurta[1], 10);
    const mes = parseInt(dataCurta[2], 10) - 1;
    let ano = dataCurta[3] ? parseInt(dataCurta[3], 10) : agora.getFullYear();
    if (ano < 100) ano += 2000;
    const alvo = new Date(ano, mes, d);
    if (!Number.isNaN(alvo.getTime()) && alvo.getMonth() === mes && alvo.getDate() === d) {
      // Data sem ano que já passou é do ano que vem ("me manda em 05/01").
      if (!dataCurta[3] && comHora(alvo, h, m) <= agora) alvo.setFullYear(ano + 1);
      return devolver(alvo, dataCurta[0], `dia ${dataCurta[0]}`);
    }
  }
  const diaDoMes = t.match(/\bdia\s+(\d{1,2})\b/);
  if (diaDoMes) {
    const d = parseInt(diaDoMes[1], 10);
    if (d >= 1 && d <= 31) {
      const alvo = new Date(agora.getFullYear(), agora.getMonth(), d);
      // Dia já passado neste mês é o do mês que vem.
      if (comHora(alvo, h, m) <= agora) alvo.setMonth(alvo.getMonth() + 1);
      if (alvo.getDate() === d) return devolver(alvo, `dia ${d}`, `dia ${d}`);
    }
  }
  // "hoje" fica por último: só vale se a fala não marcou nenhum outro dia.
  if (/\bhoje\b/.test(t)) {
    const alvo = comHora(agora, h, m);
    // "hoje às 8" dito às 10h não dá para agendar — cai fora.
    if (alvo > agora) return devolver(agora, 'hoje', 'hoje');
    return null;
  }
  // Hora sem dia ("me manda às 15h") é hoje, se ainda couber.
  if (hora) {
    const alvo = comHora(agora, h, m);
    if (alvo > agora) return devolver(agora, hora.trecho, `hoje ${hora.trecho}`);
    return devolver(somarDias(agora, 1), hora.trecho, `amanhã ${hora.trecho}`);
  }
  return null;
}

/**
 * A data combinada na conversa, lendo as falas da mais recente para a mais
 * antiga e parando na primeira que marque um dia à frente.
 *
 * `falas` vem em ordem cronológica (a última é a mais recente) e deve conter só
 * o que a OUTRA pessoa disse: quem marca o próximo contato é ela.
 */
export function lerQuandoDaConversa(falas: string[], agora: Date = new Date()): QuandoDaConversa | null {
  const recentes = (falas || []).filter((f) => String(f || '').trim()).slice(-8);
  for (let i = recentes.length - 1; i >= 0; i--) {
    const achado = lerQuandoDaFala(recentes[i], agora);
    if (achado && achado.quando > agora) return achado;
  }
  return null;
}

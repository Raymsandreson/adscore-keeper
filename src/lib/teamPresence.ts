/**
 * Quem apareceu hoje — a regra que o painel "Time agora" usa para separar
 * ausente de presente.
 *
 * Vive fora do TeamTimersPanel porque é decisão de negócio, não de tela: ela
 * decide quem a gestão cobra. Aqui ela é testável sem montar o painel inteiro,
 * e tem um lugar só para ser lida quando o app mobile precisar da mesma regra.
 */

/** O que a regra precisa saber. O MemberStatus do painel satisfaz por estrutura. */
export type PresenceInput = {
  state: 'working' | 'idle' | 'break' | 'off';
  /** Segundos produtivos de hoje (activity_time_entries). */
  dayActive: number;
  /** Segundos ociosos de hoje (activity_time_entries). */
  dayIdle: number;
  /** Bateu ponto hoje (work_shifts), mesmo que já tenha encerrado. */
  shiftToday: boolean;
};

/**
 * "Não iniciou" ≠ "off": quem bateu o ponto e já encerrou também fica 'off',
 * mas apareceu no sistema hoje. Aqui o alvo é só quem não começou o expediente.
 *
 * A presença tem DUAS fontes, não uma. Até 17/08/2026 só se olhava
 * `activity_time_entries`, o que bastava enquanto cronometrar era o único jeito
 * de entrar no dia. O app mobile bate ponto em `work_shifts` e NÃO cronometra
 * — decisão de escopo: ele registra evento discreto, nunca contagem contínua.
 * Sem `shiftToday` aqui, quem entra pelo celular chega com dayActive = 0 e
 * dayIdle = 0, aparece como "não entrou no sistema hoje" e vira alvo do sino de
 * alerta e do push de cobrança: o sistema cobra por não trabalhar exatamente
 * quem está trabalhando fora do escritório. Turno aberto hoje é presença.
 */
export const notStarted = (m: PresenceInput): boolean =>
  m.state === 'off' && m.dayActive === 0 && m.dayIdle === 0 && !m.shiftToday;

/**
 * Bateu ponto e não tem um segundo cronometrado — o expediente do app. Ganha
 * selo próprio porque "presente sem cronômetro" não é "fazendo" (não há
 * atividade em andamento para mostrar) nem "não iniciou".
 *
 * O `state === 'off'` não é redundante: quem bate o ponto pela web cai em
 * ocioso no mesmo instante, e até o primeiro flush (30s) ainda está com os dois
 * totais zerados. Sem ele, o selo do app apareceria em quem acabou de entrar
 * pelo navegador.
 */
export const appOnlyShift = (m: PresenceInput): boolean =>
  m.state === 'off' && m.shiftToday && m.dayActive === 0 && m.dayIdle === 0;

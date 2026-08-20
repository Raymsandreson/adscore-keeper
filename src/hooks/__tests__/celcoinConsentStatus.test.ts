// A Celcoin devolve a grafia com Z; o padrão Open Finance Brasil usa S.
// Medido em 18/08/2026 contra consentimento real no Banco Inter PJ: a resposta
// veio AWAITING_AUTHORIZATION e o banco passou a guardar assim. Sem normalizar,
// o portão do sync recusava com "está AUTHORIZED, não AUTHORISED" — erro que
// parece da Celcoin e é nosso.
import { describe, it, expect } from 'vitest';
import {
  normalizeConsentStatus,
  isConsentAuthorised,
  isConsentDiscarded,
  consentHealth,
} from '@/hooks/useCelcoinOpenFinance';

describe('status de consentimento — grafia Z vs S', () => {
  it('normaliza as duas grafias para a forma com S', () => {
    expect(normalizeConsentStatus('AUTHORIZED')).toBe('AUTHORISED');
    expect(normalizeConsentStatus('AUTHORISED')).toBe('AUTHORISED');
    expect(normalizeConsentStatus('AWAITING_AUTHORIZATION')).toBe('AWAITING_AUTHORISATION');
    expect(normalizeConsentStatus('AWAITING_AUTHORISATION')).toBe('AWAITING_AUTHORISATION');
  });

  it('aceita minúsculas e valores ausentes sem quebrar', () => {
    expect(normalizeConsentStatus('authorized')).toBe('AUTHORISED');
    expect(normalizeConsentStatus(null)).toBe('');
    expect(normalizeConsentStatus(undefined)).toBe('');
  });

  it('reconhece autorizado nas duas grafias', () => {
    expect(isConsentAuthorised('AUTHORIZED')).toBe(true);
    expect(isConsentAuthorised('AUTHORISED')).toBe(true);
  });

  it('NÃO confunde aguardando com autorizado', () => {
    // O bug real seria aqui: AWAITING_AUTHORIZATION contém "AUTHORIZ" e uma
    // normalização descuidada (substring/startsWith) daria positivo.
    expect(isConsentAuthorised('AWAITING_AUTHORIZATION')).toBe(false);
    expect(isConsentAuthorised('AWAITING_AUTHORISATION')).toBe(false);
    expect(isConsentAuthorised('REJECTED')).toBe(false);
    expect(isConsentAuthorised('')).toBe(false);
  });

  it('consentHealth marca como parado quando não está autorizado, na grafia da Celcoin', () => {
    const h = consentHealth({
      status: 'AWAITING_AUTHORIZATION',
      expires_at: null,
      last_sync_at: null,
    });
    expect(h.level).toBe('parado');
    // Desde 19/08/2026 o rótulo é em português — enum cru numa tela de
    // financeiro não diz nada a quem lê. O que a grafia Z não pode fazer é
    // escapar pro rótulo.
    expect(h.label).toBe('Aguardando autorização no banco');
    expect(h.label).not.toContain('AUTHORIZ');
  });

  it('status desconhecido cai no rótulo cru, mas já normalizado', () => {
    // Este é o caso que a asserção antiga protegia: se a Celcoin inventar um
    // estado que não conhecemos, mostramos o código (melhor que engolir) — e
    // ainda assim com S, nunca com Z.
    const h = consentHealth({
      status: 'PENDING_AUTHORIZATION_XYZ',
      expires_at: null,
      last_sync_at: null,
    });
    expect(h.level).toBe('parado');
    expect(h.label).toContain('PENDING_AUTHORISATION_XYZ');
  });

  it('descartado tem rótulo próprio nos dois desfechos', () => {
    // REVOKED = a Celcoin aceitou o DELETE. ABANDONED = ela recusou com 422
    // (consentimento nunca autorizado não se revoga) e o consentimento segue
    // existindo lá. Os dois somem da lista principal; o rótulo difere porque o
    // fato difere.
    expect(consentHealth({ status: 'REVOKED', expires_at: null, last_sync_at: null }).label).toBe('Revogado');
    expect(consentHealth({ status: 'ABANDONED', expires_at: null, last_sync_at: null }).label).toBe('Descartado');
    expect(isConsentDiscarded('REVOKED')).toBe(true);
    expect(isConsentDiscarded('ABANDONED')).toBe(true);
    expect(isConsentDiscarded('AWAITING_AUTHORIZATION')).toBe(false);
    expect(isConsentDiscarded('AUTHORISED')).toBe(false);
  });

  it('consentHealth aceita AUTHORIZED (com Z) como ativo', () => {
    const daquiUmAno = new Date(Date.now() + 300 * 86_400_000).toISOString();
    const h = consentHealth({
      status: 'AUTHORIZED',
      expires_at: daquiUmAno,
      last_sync_at: new Date().toISOString(),
    });
    expect(h.level).toBe('ok');
  });
});

/**
 * Obsolescência: o sync roda e não traz nada.
 *
 * Este bloco existe por causa de um modo de falha JÁ OBSERVADO, não hipotético.
 * A Pluggy parou de trazer lançamento em 18/03/2026 e as 3 conexões seguem
 * dizendo `status: UPDATED` até hoje — cinco meses de silêncio que ninguém viu,
 * porque o rótulo que a tela mostrava media a rodada, não o dado.
 *
 * O `last_sync_at` da Celcoin tem exatamente o mesmo defeito: a edge o carimba
 * no fim de todo sync bem-sucedido, INCLUSIVE quando o resultado é zero linha.
 * Com o cron do Railway rodando 3x/dia ele nunca envelhece, e o alerta de "sem
 * sincronizar há N dias" que existia aqui era um alarme sem badalo.
 */
describe('obsolescência — medir dado que chegou, não rodada que aconteceu', () => {
  // Datas de calendário em Brasília, que é o fuso que o vitest.config fixa e o
  // mesmo em que a coluna DATE `transaction_date` é gravada.
  const diasAtras = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  };
  const daquiUmAno = new Date(Date.now() + 300 * 86_400_000).toISOString();
  const consentimento = (last_transaction_date: string | null, last_sync_at = new Date().toISOString()) => ({
    status: 'AUTHORISED',
    expires_at: daquiUmAno,
    last_sync_at,
    last_transaction_date,
  });

  it('acusa quando o sync roda em dia mas o dado parou — o caso da Pluggy', () => {
    const h = consentHealth(consentimento(diasAtras(7)));
    expect(h.level).toBe('atencao');
    expect(h.label).toBe('Sem lançamento novo há 7 dias');
  });

  it('escala para parado quando o silêncio passa de 10 dias', () => {
    expect(consentHealth(consentimento(diasAtras(12))).level).toBe('parado');
  });

  it('NÃO alarma no maior silêncio real medido (3 dias, 08/07 -> 12/07)', () => {
    // O limiar precisa caber no comportamento observado da conta: 113 dias com
    // movimento em 5 meses, 8 buracos de fim de semana (2 dias) e um de 3.
    // Alarmar em 3 seria alarme de rotina, e alarme de rotina vira ruído
    // ignorado — que é como o silêncio de verdade passa.
    expect(consentHealth(consentimento(diasAtras(0))).level).toBe('ok');
    expect(consentHealth(consentimento(diasAtras(2))).level).toBe('ok');
    expect(consentHealth(consentimento(diasAtras(3))).level).toBe('ok');
    // Carnaval é o pior caso que a janela medida não contém: sexta -> quarta
    // sem lançamento dá 4 dias. Ainda assim não pode tocar.
    expect(consentHealth(consentimento(diasAtras(4))).level).toBe('ok');
  });

  it('separa "o sync parou" de "a conta não teve movimento"', () => {
    // Causas diferentes, consertos diferentes: um é o cron do Railway caído,
    // o outro é a conexão respondendo 200 vazio. O rótulo tem que dizer qual.
    const h = consentHealth(consentimento(diasAtras(0), new Date(Date.now() - 3 * 86_400_000).toISOString()));
    expect(h.level).toBe('parado');
    expect(h.label).toBe('O sync não roda há 3 dias');
  });

  it('sem last_transaction_date não inventa alarme', () => {
    // Enquanto a edge que preenche o campo não subir, o front recebe undefined.
    // Silêncio é a resposta certa: alarme falso aqui queima o alarme verdadeiro.
    expect(consentHealth(consentimento(null)).level).toBe('ok');
    expect(consentHealth({ status: 'AUTHORISED', expires_at: daquiUmAno, last_sync_at: new Date().toISOString() }).level).toBe('ok');
  });

  it('expiração vence obsolescência — é a causa, não o sintoma', () => {
    const h = consentHealth({
      status: 'AUTHORISED',
      expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      last_sync_at: new Date().toISOString(),
      last_transaction_date: diasAtras(30),
    });
    expect(h.level).toBe('atencao');
    expect(h.label).toContain('Expira em');
  });
});

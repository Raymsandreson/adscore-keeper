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

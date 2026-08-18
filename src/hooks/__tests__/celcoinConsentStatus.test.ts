// A Celcoin devolve a grafia com Z; o padrão Open Finance Brasil usa S.
// Medido em 18/08/2026 contra consentimento real no Banco Inter PJ: a resposta
// veio AWAITING_AUTHORIZATION e o banco passou a guardar assim. Sem normalizar,
// o portão do sync recusava com "está AUTHORIZED, não AUTHORISED" — erro que
// parece da Celcoin e é nosso.
import { describe, it, expect } from 'vitest';
import {
  normalizeConsentStatus,
  isConsentAuthorised,
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
    // A mensagem mostra a grafia normalizada, não a bruta da Celcoin.
    expect(h.label).toContain('AWAITING_AUTHORISATION');
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

// Conexão de contas via Open Finance (Celcoin) — sucessora da Pluggy na conciliação.
//
// Diferença de fluxo que muda a UI: a Pluggy abre um widget dentro da página
// (pluggy-connect) e devolve o item na hora. O Open Finance obriga a mandar o
// titular ao site do banco para autenticar e aprovar, e só depois o consentimento
// vira AUTHORISED. Por isso aqui existem consentimentos em estado intermediário,
// e a autorização acontece fora do app (única exceção prevista à regra de não
// redirecionar: site de terceiro que não roda dentro do app).
import { useState, useCallback } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';

export interface CelcoinBrand {
  brand_id: string;
  name: string;
}

export interface CelcoinConsent {
  id: string;
  consent_id: string;
  brand_id: string;
  brand_name: string | null;
  status: string;
  permissions: string[];
  celcoin_env: string;
  custom_name: string | null;
  authorized_at: string | null;
  expires_at: string | null;
  last_sync_at: string | null;
  created_at: string;
}

// Onde a pessoa estava antes de ir para o banco. O callback usa isto para
// devolvê-la ao mesmo lugar em vez de despejar na home.
const RETURN_KEY = 'celcoin:return_to';
const PENDING_KEY = 'celcoin:pending_consent';

async function callCelcoin(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message || `Falha em ${action}`);
  if (data && data.success === false) throw new Error(data.error || `Falha em ${action}`);
  return data;
}

export function useCelcoinOpenFinance() {
  const [brands, setBrands] = useState<CelcoinBrand[]>([]);
  const [consents, setConsents] = useState<CelcoinConsent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrands = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callCelcoin('list_brands');
      setBrands(data.brands || []);
      return data.brands as CelcoinBrand[];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao listar bancos');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConsents = useCallback(async (userId: string) => {
    try {
      const data = await callCelcoin('list_connections', { user_id: userId });
      setConsents(data.consents || []);
      return data.consents as CelcoinConsent[];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao listar conexões');
      return [];
    }
  }, []);

  /**
   * Cria o consentimento e manda o titular ao banco.
   * `cpf` é sempre o do representante legal — mesmo quando a conta é PJ, quem
   * autoriza no Open Finance é uma pessoa física. O CNPJ vai em `cnpj`.
   */
  const connect = useCallback(
    async (params: { userId: string; brandId: string; cpf: string; cnpj?: string; returnTo?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const data = await callCelcoin('create_consent', {
          user_id: params.userId,
          brand_id: params.brandId,
          cpf: params.cpf,
          cnpj: params.cnpj,
        });

        if (!data.authorization_url) {
          throw new Error('A Celcoin não devolveu a URL de autorização do banco.');
        }

        sessionStorage.setItem(RETURN_KEY, params.returnTo || window.location.pathname);
        sessionStorage.setItem(PENDING_KEY, data.consent_id || '');
        window.location.href = data.authorization_url;
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao conectar');
        setLoading(false);
        throw err;
      }
    },
    [],
  );

  const checkConsent = useCallback(async (consentId: string) => {
    return callCelcoin('consent_status', { consent_id: consentId });
  }, []);

  const syncTransactions = useCallback(
    async (params: { userId: string; consentId: string; from?: string; to?: string }) => {
      setLoading(true);
      setError(null);
      try {
        return await callCelcoin('sync_transactions', {
          user_id: params.userId,
          consent_id: params.consentId,
          from: params.from,
          to: params.to,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao sincronizar');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { brands, consents, loading, error, fetchBrands, fetchConsents, connect, checkConsent, syncTransactions };
}

export function popCelcoinReturnTo(): string {
  const value = sessionStorage.getItem(RETURN_KEY) || '/finance';
  sessionStorage.removeItem(RETURN_KEY);
  return value;
}

export function popCelcoinPendingConsent(): string | null {
  const value = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  return value || null;
}

/**
 * Um consentimento expira em no máximo 1 ano e, quando expira, a sincronização
 * simplesmente para. Foi assim que a Pluggy ficou 5 meses parada sem ninguém
 * notar. Estes helpers existem para a tela avisar ANTES.
 */
/**
 * A Celcoin devolve a grafia com Z (AUTHORIZED, AWAITING_AUTHORIZATION); o padrão
 * Open Finance Brasil e o resto deste código usam S (AUTHORISED). Medido em
 * 18/08/2026 num consentimento real. Comparar sem normalizar fazia o botão de
 * sincronizar nunca habilitar, e o backend recusar com "está AUTHORIZED, não
 * AUTHORISED" — que parece erro da Celcoin e não é.
 */
export function normalizeConsentStatus(status?: string | null): string {
  return String(status ?? '').toUpperCase().replace(/AUTHORIZ/g, 'AUTHORIS');
}

export function isConsentAuthorised(status?: string | null): boolean {
  return normalizeConsentStatus(status) === 'AUTHORISED';
}

export function consentDaysLeft(consent: Pick<CelcoinConsent, 'expires_at'>): number | null {
  if (!consent.expires_at) return null;
  const ms = new Date(consent.expires_at).getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

export function consentHealth(
  consent: Pick<CelcoinConsent, 'status' | 'expires_at' | 'last_sync_at'>,
): { level: 'ok' | 'atencao' | 'parado'; label: string } {
  if (!isConsentAuthorised(consent.status)) {
    return { level: 'parado', label: `Consentimento ${normalizeConsentStatus(consent.status)} — não sincroniza` };
  }
  const days = consentDaysLeft(consent);
  if (days !== null && days <= 0) return { level: 'parado', label: 'Consentimento expirado' };
  if (days !== null && days <= 30) return { level: 'atencao', label: `Expira em ${days} dia(s)` };

  if (consent.last_sync_at) {
    const daysSinceSync = Math.floor((Date.now() - new Date(consent.last_sync_at).getTime()) / 86_400_000);
    if (daysSinceSync >= 7) return { level: 'atencao', label: `Sem sincronizar há ${daysSinceSync} dias` };
  }
  return { level: 'ok', label: 'Ativo' };
}

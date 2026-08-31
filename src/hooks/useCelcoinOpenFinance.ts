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
  /**
   * Data do lançamento mais recente que ESTA conexão trouxe. Vem calculada pela
   * edge (`list_connections`) porque as tabelas de transação são as únicas do
   * Externo com RLS de verdade (`user_id = auth.uid()`), e a sessão que o front
   * mantém lá é anônima — ler daqui devolveria vazio, não erro.
   */
  last_transaction_date?: string | null;
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

/** O que `sync_all` devolve. Só os campos que a tela usa. */
export interface CelcoinSyncResumo {
  success?: boolean;
  falhas?: number;
  bank_transactions?: number;
  credit_card_transactions?: number;
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

  /**
   * Tira o consentimento de circulação. Devolve `desfecho`: `REVOKED` se a
   * Celcoin aceitou revogar, `ABANDONED` se recusou (é o caso de todo
   * consentimento que nunca foi autorizado). IRREVERSÍVEL, e o backend recusa
   * com 409 quando o consentimento está AUTHORISED — nesta tela todos os
   * cartões mostram o mesmo nome de banco, e o clique errado mataria a conexão
   * que sustenta a conciliação.
   */
  const discardConsent = useCallback(async (consentId: string) => {
    return callCelcoin('revoke_consent', { consent_id: consentId });
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

  /**
   * Sincroniza TODAS as conexões autorizadas — é o que o cron chama, e o que o
   * botão da tela precisa. `syncTransactions` exige um `consent_id`, que a tela
   * não tem em mãos; e mandar um id fixo quebraria calado no dia em que o
   * consentimento fosse renovado. Uma conexão que falha não derruba as outras.
   */
  const syncAll = useCallback(async (): Promise<CelcoinSyncResumo> => {
    setLoading(true);
    setError(null);
    try {
      return await callCelcoin('sync_all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao sincronizar');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { brands, consents, loading, error, fetchBrands, fetchConsents, connect, checkConsent, discardConsent, syncTransactions, syncAll };
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

/**
 * Consentimento tirado de circulação, nos dois desfechos possíveis:
 * `REVOKED` (a Celcoin aceitou o DELETE) e `ABANDONED` (ela recusou com 422 —
 * consentimento nunca autorizado não se revoga, e segue existindo lá, inerte,
 * até a data de expiração). A tela trata os dois igual; o texto do cartão é que
 * diz qual foi.
 */
export function isConsentDiscarded(status?: string | null): boolean {
  const s = normalizeConsentStatus(status);
  return s === 'REVOKED' || s === 'ABANDONED';
}

export function isConsentAbandoned(status?: string | null): boolean {
  return normalizeConsentStatus(status) === 'ABANDONED';
}

export function consentDaysLeft(consent: Pick<CelcoinConsent, 'expires_at'>): number | null {
  if (!consent.expires_at) return null;
  const ms = new Date(consent.expires_at).getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

/**
 * Data de hoje em Brasília, no formato do banco (YYYY-MM-DD). `en-CA` é o
 * atalho padrão para ISO curto. Não dá para usar `new Date()` cru: a coluna
 * `transaction_date` é DATE, e `new Date('2026-08-20')` vira meia-noite UTC —
 * às 21h de Brasília isso já é "amanhã" e a conta de dias sai errada por um.
 */
function hojeBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/**
 * Dias corridos entre uma data e hoje, contando em dias de calendário. Aceita
 * DATE ('2026-08-20') e timestamp ISO — do timestamp interessa só a data,
 * lida no MESMO fuso do "hoje" (Brasília): o slice(0,10) pegava o dia UTC e,
 * entre 21h e meia-noite BRT, todo timestamp recente contava um dia a menos.
 * Ancorar os dois lados em Date.UTC evita que horário de verão ou fuso do
 * navegador movam a diferença em um dia.
 */
function diasDesde(quando: string | null | undefined): number | null {
  if (!quando) return null;
  const s = String(quando);
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? s
    : Number.isNaN(Date.parse(s))
      ? s.slice(0, 10)
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(s));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const [ay, am, ad] = dia.split('-').map(Number);
  const [hy, hm, hd] = hojeBrasilia().split('-').map(Number);
  return Math.round((Date.UTC(hy, hm - 1, hd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// MEDIDO em 20/08/2026 sobre os 5 meses que a Celcoin já trouxe do Inter PJ
// (300 lançamentos, 113 dias com movimento entre 19/03 e 20/08): o maior
// silêncio real foi de 3 dias (08/07 -> 12/07); há 8 buracos de 2 dias, todos
// fim de semana, e NENHUM de 4 ou mais. Alertar a partir de 5 dias, portanto,
// não teria dado um único falso positivo em todo o histórico disponível — e
// ainda cobre o pior caso que a janela medida não contém: Carnaval, que
// encadeia sábado, domingo e as duas segundas/terças, dando 4 dias sem
// lançamento entre a sexta e a quarta.
const DIAS_SEM_DADO_ALERTA = 5;
const DIAS_SEM_DADO_PARADO = 10;

// O cron do Railway chama `sync_all` 3x ao dia (06h/12h/19h BRT). Mais de 2
// dias sem carimbo significa que o processo em si parou — coisa diferente de
// não haver movimento na conta.
const DIAS_SEM_SYNC_ALERTA = 2;

export function consentHealth(
  consent: Pick<CelcoinConsent, 'status' | 'expires_at' | 'last_sync_at'> & {
    last_transaction_date?: string | null;
  },
): { level: 'ok' | 'atencao' | 'parado'; label: string } {
  // Rótulo em português para os estados que a tela mostra de fato. O fallback
  // com a grafia crua fica para status que a Celcoin invente e nós ainda não
  // conheçamos — melhor mostrar o código do que engolir.
  const st = normalizeConsentStatus(consent.status);
  if (st === 'REVOKED') return { level: 'parado', label: 'Revogado' };
  if (st === 'ABANDONED') return { level: 'parado', label: 'Descartado' };
  if (st.startsWith('AWAITING')) return { level: 'parado', label: 'Aguardando autorização no banco' };
  if (st === 'REJECTED') return { level: 'parado', label: 'Recusado pelo banco' };
  if (!isConsentAuthorised(consent.status)) {
    return { level: 'parado', label: `Consentimento ${st} — não sincroniza` };
  }
  const days = consentDaysLeft(consent);
  if (days !== null && days <= 0) return { level: 'parado', label: 'Consentimento expirado' };
  if (days !== null && days <= 30) return { level: 'atencao', label: `Expira em ${days} dia(s)` };

  // A partir daqui são DOIS medidores, e confundi-los é o que deixou a Pluggy
  // morrer calada por 5 meses:
  //
  //   last_sync_at         -> a RODADA aconteceu. Sobe sempre que o sync termina
  //                           sem erro, INCLUSIVE trazendo zero linha (a edge
  //                           carimba a data no fim, incondicionalmente).
  //   last_transaction_date-> chegou DADO. É o único que percebe a conexão que
  //                           responde 200 e não traz nada.
  //
  // Enquanto o cron do Railway roda 3x/dia, o primeiro NUNCA envelhece — o
  // limiar de 7 dias que existia aqui era um alarme que não podia tocar. É
  // exatamente o formato da falha da Pluggy: `status: UPDATED` até hoje, sem
  // um lançamento desde 18/03/2026.
  const semSync = diasDesde(consent.last_sync_at ?? null);
  if (semSync !== null && semSync >= DIAS_SEM_SYNC_ALERTA) {
    return { level: 'parado', label: `O sync não roda há ${semSync} dias` };
  }

  const semDado = diasDesde(consent.last_transaction_date ?? null);
  if (semDado !== null && semDado >= DIAS_SEM_DADO_PARADO) {
    return { level: 'parado', label: `Sem lançamento novo há ${semDado} dias` };
  }
  if (semDado !== null && semDado >= DIAS_SEM_DADO_ALERTA) {
    return { level: 'atencao', label: `Sem lançamento novo há ${semDado} dias` };
  }
  return { level: 'ok', label: 'Ativo' };
}

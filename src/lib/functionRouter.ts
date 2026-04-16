/**
 * Function Router — Única fonte de verdade para roteamento de Edge Functions.
 * 
 * Cada função tem uma rota definida: 'cloud' (Lovable Cloud) ou 'railway' (servidor externo).
 * Quando uma função é migrada para Railway, basta mudar a rota aqui.
 * 
 * Fallback automático: se Railway falhar, tenta Cloud (e vice-versa).
 */

type FunctionTarget = 'cloud' | 'railway';

// ============================================================
// MAPA DE ROTAS — Edite aqui para migrar funções
// ============================================================
const FUNCTION_ROUTES: Record<string, FunctionTarget> = {
  // --- Funções de alto volume (migrar primeiro) ---
  'whatsapp-webhook': 'cloud',              // TODO: migrar para 'railway'
  'trigger-whatsapp-notifications': 'cloud', // TODO: migrar para 'railway'
  'whatsapp-ai-agent-reply': 'cloud',        // TODO: migrar para 'railway'
  'whatsapp-call-queue-processor': 'cloud',  // TODO: migrar para 'railway'
  'wjia-followup-processor': 'cloud',        // TODO: migrar para 'railway'
  'send-whatsapp': 'cloud',                  // TODO: migrar para 'railway'
  
  // --- Todas as demais ficam no Cloud por padrão ---
};



// ============================================================
// CONFIGURAÇÃO DOS BACKENDS
// ============================================================
const CLOUD_URL = 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';

// Railway URL — será configurada quando o servidor estiver pronto
// Formato: https://seu-app.up.railway.app
const RAILWAY_URL = import.meta.env.VITE_RAILWAY_URL || '';
const RAILWAY_API_KEY = import.meta.env.VITE_RAILWAY_API_KEY || '';

// ============================================================
// LÓGICA DE ROTEAMENTO
// ============================================================

function getTarget(functionName: string): FunctionTarget {
  return FUNCTION_ROUTES[functionName] || 'cloud';
}

async function callCloud<T>(
  functionName: string,
  body?: Record<string, any>,
  authToken?: string
): Promise<{ data: T | null; error: Error | null }> {
  const url = `${CLOUD_URL}/functions/v1/${functionName}`;
  const bearerToken = authToken || CLOUD_ANON_KEY;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
      'apikey': CLOUD_ANON_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloud function error ${response.status}: ${errorText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return { data: response as any, error: null };
  }

  const data = await response.json();
  return { data, error: null };
}

async function callRailway<T>(
  functionName: string,
  body?: Record<string, any>,
  authToken?: string
): Promise<{ data: T | null; error: Error | null }> {
  if (!RAILWAY_URL) {
    throw new Error('Railway URL not configured');
  }

  const url = `${RAILWAY_URL}/functions/${functionName}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (RAILWAY_API_KEY) {
    headers['x-api-key'] = RAILWAY_API_KEY;
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Railway function error ${response.status}: ${errorText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return { data: response as any, error: null };
  }

  const data = await response.json();
  return { data, error: null };
}

/**
 * Invoca uma função com roteamento automático e fallback.
 * Drop-in replacement para cloudFunctions.invoke()
 */
async function invokeFunction<T = any>(
  functionName: string,
  options?: { body?: any; authToken?: string }
): Promise<{ data: T | null; error: Error | null }> {
  const body = options?.body;
  const authToken = options?.authToken;

  // Funções deployadas diretamente no Supabase externo — bypass completo
  if (EXTERNAL_FUNCTIONS[functionName]) {
    try {
      const url = `${EXTERNAL_SUPABASE_URL}/functions/v1/${functionName}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`External function error ${response.status}: ${errorText}`);
      }
      const data = await response.json();
      return { data, error: null };
    } catch (err) {
      console.error(`[Router] ${functionName} → external FALHOU:`, err);
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  const target = getTarget(functionName);
  const primary = target === 'railway' ? callRailway : callCloud;
  const fallback = target === 'railway' ? callCloud : callRailway;
  const fallbackAvailable = target === 'railway' ? true : !!RAILWAY_URL;

  try {
    const result = await primary<T>(functionName, body, authToken);
    if (import.meta.env.DEV) {
      console.log(`[Router] ${functionName} → ${target} ✓`);
    }
    return result;
  } catch (err) {
    console.warn(`[Router] ${functionName} → ${target} FALHOU:`, err);
    
    // Fallback: tenta o outro backend
    if (fallbackAvailable) {
      try {
        const fallbackTarget = target === 'railway' ? 'cloud' : 'railway';
        console.log(`[Router] ${functionName} → fallback para ${fallbackTarget}...`);
        const result = await fallback<T>(functionName, body, authToken);
        console.log(`[Router] ${functionName} → ${fallbackTarget} (fallback) ✓`);
        return result;
      } catch (fallbackErr) {
        console.error(`[Router] ${functionName} → fallback também falhou:`, fallbackErr);
      }
    }
    
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error(String(err)) 
    };
  }
}

// ============================================================
// EXPORT — Interface compatível com cloudFunctions
// ============================================================

/**
 * Roteador centralizado de funções.
 * Substitui cloudFunctions.invoke() com roteamento inteligente.
 * 
 * Uso: import { cloudFunctions } from '@/lib/functionRouter';
 *      const { data, error } = await cloudFunctions.invoke('send-whatsapp', { body: {...} });
 */
export const cloudFunctions = {
  invoke: invokeFunction,
};

// Re-export para compatibilidade com imports antigos
export async function invokeCloudFunction<T = any>(
  functionName: string,
  body?: Record<string, any>,
  options?: { authToken?: string }
): Promise<{ data: T | null; error: Error | null }> {
  return invokeFunction<T>(functionName, { body, authToken: options?.authToken });
}

// Utilidade para verificar o status do roteamento
export function getRoutingStatus() {
  return {
    railwayConfigured: !!RAILWAY_URL,
    railwayUrl: RAILWAY_URL ? RAILWAY_URL.replace(/https?:\/\//, '***') : 'não configurado',
    routes: { ...FUNCTION_ROUTES },
    defaultTarget: 'cloud' as FunctionTarget,
  };
}

/**
 * Function Router — Única fonte de verdade para roteamento de Edge Functions.
 * 
 * Cada função tem uma rota definida: 'cloud' (Lovable Cloud) ou 'railway' (servidor externo).
 * Quando uma função é migrada para Railway, basta mudar a rota aqui.
 * 
 * Fallback automático: se Railway falhar, tenta Cloud (e vice-versa).
 */

type FunctionTarget = 'cloud' | 'railway' | 'external';

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

  // --- Funções já portadas pro Railway ---
  'send-team-push': 'railway',
  'onboarding-checkpoint-execute': 'railway',
  'onboarding-checkpoint-reprocess': 'railway',
  'regenerate-lead-name': 'railway',
  'lead-close-sequence-info': 'railway',
  'whatsapp-download-media': 'railway',
  // Só existe no Railway. Sem esta linha caía no default 'cloud', onde não há
  // handler — e o chamador driblava o router com fetch cru, sem JWT nenhum.
  'match-orphans-for-lead': 'railway',
  'whatsapp-backfill-media': 'railway',
  'extract-conversation-data': 'railway',
  'list-uazapi-labels': 'railway',
  'manage-uazapi-label': 'railway',
  'sync-agent-labels': 'railway',
  // Ativar o agente pela tela também manda a 1ª mensagem proativa (antes só a etiqueta mandava)
  'agent-proactive-first-message': 'railway',
  'sync-result-labels': 'railway',
  'sync-stage-labels': 'railway',
  'apply-stage-label': 'railway',
  'apply-label-event': 'railway',
  'list-stage-label-mappings': 'railway',
  'set-stage-result-key': 'railway',
  'get-whatsapp-group-info': 'railway',
  'get-group-participants': 'railway', // lia whatsapp_instances/groups_cache do Cloud (moram no Externo) e descartava participante @lid
  'sync-group-contacts': 'railway', // blocklist de equipe lia instances/profiles do Cloud; ilike não casava telefone formatado (criava contato duplicado); @lid descartado e nome do roster ignorado
  'get-whatsapp-avatars': 'railway', // foto de perfil do WhatsApp: só existe no Railway (usa sharp + bucket privado)
  'scan-duplicate-contacts': 'railway',
  'recover-leads-phone-55': 'railway',
  'transcribe-activity-call': 'railway',
  'transcribe-team-audio': 'railway',
  'extract-activity-from-document': 'railway',
  // Busca e vínculo manual da procuração do lead: lê e escreve em
  // zapsign_documents, que não responde à anon key sem sessão e cuja escrita
  // tem que ser por service role.
  'inss-procuracao-vincular': 'railway',
  'dictate-activity': 'railway',
  'chat-to-activity': 'railway',
  'detect-client-commitments': 'railway', // IA lê a conversa e registra o que o cliente ficou de fazer
  'detect-group-case-reports': 'railway', // IA lê os grupos marcados e acha gente relatando acidente
  'call-to-activities': 'railway', // transcreve+resume ligação de voz do chat interno → atividades
  'activity-from-movement': 'railway',
  'generate-activity-title': 'railway', // gera título curto ("o que fazer") no concluir-e-próxima e no botão renomear
  'suggest-step-actions': 'railway',
  'suggest-step-completion': 'railway', // POP: IA lê movimentações + comando ("já foi feito acordo") e sugere os passos a marcar
  'edit-workflow': 'railway', // POP: editar com IA (agora inclui status/resultados do POP, não só passos)
  'generate-workflow': 'railway', // POP: criar com IA — versão com responsáveis por cargo (team), prazos e sugestão de cargos; Cloud mantém a versão antiga como fallback
  'suggest-revision-reason': 'railway', // POP: IA sugere motivo+categoria da revisão a partir do diff
  'wipe-instance-agent-labels': 'railway',
  'bpc-sheet-sync': 'railway',
  'report-query': 'railway', // gerador de relatórios por IA (NL→SQL read-only)
  'performance-coach': 'railway', // coach do telão /tv/atividades (análise + mensagem Corrida Maluca)
  'extract-acordo-from-ata': 'railway', // IA lê ata de audiência e extrai o acordo homologado
  'jm-documento-url': 'railway', // URL assinada de peça dos autos (bucket privado jm-autos)
  'telao-narrar': 'railway', // narração do telão com voz de locutor (ElevenLabs + cache no storage)
  'sync-hearings-from-sheet': 'railway', // credenciais do Google Sheets (gateway Lovable) só existem no Railway
  'nearby-establishments': 'railway', // pontes por proximidade — gateway Google Maps (LOVABLE_API_KEY no Railway)
  // Open Finance/Celcoin — conciliação financeira (substitui a Pluggy).
  // Estava no Railway até 18/08/2026, quando MEDIMOS que a borda da Celcoin
  // barra tráfego de fora do Brasil: o Railway sai da Califórnia e toma 403 com
  // HTML de WAF (a requisição nem chega na aplicação). A edge do Externo sai de
  // São Paulo e passa. Some a isso a LGPD — o tráfego carrega CPF/CNPJ e extrato.
  'celcoin-open-finance': 'external',
  'update-profile-avatar': 'railway', // foto de perfil: a policy de UPDATE de profiles barra a sessão anônima do Externo — só service role grava
  // Testemunho → Instagram: só existem no Railway (sharp + fonte embutida; token Meta no env do servidor)
  'testimonial-to-instagram-post': 'railway',
  'publish-instagram-testimonial': 'railway',

  // --- INSS administrativo / e-mails processuais ---
  // Só existem no Railway. Estavam FORA deste mapa e os componentes chamavam
  // com fetch cru + `x-api-key: VITE_RAILWAY_API_KEY`, que nunca teve valor —
  // ou seja, 12 chamadas anônimas que morreriam no RAILWAY_AUTH_ENFORCE=1.
  'gmail-inss-sync': 'railway',
  'gmail-message-body': 'railway',
  'gmail-processual-sync': 'railway',
  'notify-inss-update': 'railway',
  'match-inss-orphans': 'railway',
  'auto-link-inss-by-name': 'railway',
  'bulk-link-inss-by-cpf': 'railway',

  // --- Consolidação no Supabase Externo (kmedldlepwiityjsdahz) ---
  // Deploy: supabase functions deploy <slug> --project-ref kmedldlepwiityjsdahz --no-verify-jwt
  // Fallback automático → Cloud (código legado) se o externo falhar.
  'search-escavador': 'external',
  'analyze-news-case': 'external',
  'scrape-news': 'external', // fix anti-bot (proxy stealth + detecção de página de bloqueio); Cloud mantém versão legada como fallback
  'enrich-news-leads': 'external', // enriquecimento de manchetes (vítima/cidade/estrangeira) — só existe no externo
  'sync-process-compromissos': 'external', // detector de compromissos + feed do sino (dados 100% no Externo)
  'sync-email-push': 'external', // parser do push por e-mail; a aba "Sem vínculo" chama o modo reprocessar ao vincular identificador
  'facebook-capi': 'external', // CAPI Purchase/Lead — migrada do Cloud (Lovable) p/ controle total de deploy+secrets; fallback → Cloud
  'create-whatsapp-group': 'external', // v12 com tokens de nome (lead_name_upper etc.); cópia do Cloud está desatualizada e criava grupo sem template
  'find-contact-groups': 'external', // instance_name deixou de ser obrigatório na busca por nome; lê instâncias/cache no Externo (onde de fato moram). Fallback → Cloud mantém a versão antiga.
  'sugerir-lancamento': 'external', // lê comprovante/ditado e propõe o lançamento; só existe no Externo
  'whatsapp-cloud-admin': 'external', // config/regras do canal Cloud API: dado e token passam a morar no Externo (o Cloud fica de fallback)

  // --- Todas as demais ficam no Cloud por padrão ---
};



// ============================================================
// CONFIGURAÇÃO DOS BACKENDS
// ============================================================
const CLOUD_URL = 'https://gliigkupoebmlbwyvijp.supabase.co';
const CLOUD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';

// Supabase Externo (kmedldlepwiityjsdahz) — mesmas credenciais públicas do external-client.
// Anon key não é segredo (mesmo padrão do CLOUD_ANON_KEY acima).
const EXTERNAL_URL = 'https://kmedldlepwiityjsdahz.supabase.co';
const EXTERNAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs';

// Railway URL — endpoint público, não é segredo
// Variáveis VITE_* não são suportadas no Lovable (build-time), então hardcoded.
const RAILWAY_URL =
  import.meta.env.VITE_RAILWAY_URL ||
  'https://adscore-keeper-production.up.railway.app';

// API key opcional. Se RAILWAY_API_KEY estiver setada no Railway, o servidor exige
// header x-api-key. Como expor a key no bundle frontend não traz proteção real
// (qualquer usuário consegue lê-la), preferimos NÃO setar RAILWAY_API_KEY no
// Railway — proteção real fica nos próprios handlers (validação de payload + JWT).
const RAILWAY_API_KEY = import.meta.env.VITE_RAILWAY_API_KEY || '';

// ============================================================
// LÓGICA DE ROTEAMENTO
// ============================================================

function getTarget(functionName: string): FunctionTarget {
  return FUNCTION_ROUTES[functionName] || 'cloud';
}

function generateRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as any).randomUUID();
    }
  } catch {/* fallback */}
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseFunctionErrorPayload(err: unknown): Record<string, any> | null {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const jsonStart = message.indexOf('{');
  if (jsonStart === -1) return null;

  try {
    return JSON.parse(message.slice(jsonStart));
  } catch {
    return null;
  }
}

function isInvalidMetaTokenError(functionName: string, payload: Record<string, any> | null) {
  return functionName.startsWith('list-meta-')
    && payload?.error_type === 'OAuthException'
    && Number(payload?.error_code) === 190;
}

async function callCloud<T>(
  functionName: string,
  body?: Record<string, any>,
  authToken?: string,
  requestId?: string
): Promise<{ data: T | null; error: Error | null }> {
  const url = `${CLOUD_URL}/functions/v1/${functionName}`;
  const bearerToken = authToken || CLOUD_ANON_KEY;
  const rid = requestId || generateRequestId();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
      'apikey': CLOUD_ANON_KEY,
      'x-request-id': rid,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloud function error ${response.status} [rid=${rid}]: ${errorText}`);
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
  authToken?: string,
  requestId?: string
): Promise<{ data: T | null; error: Error | null }> {
  if (!RAILWAY_URL) {
    throw new Error('Railway URL not configured');
  }

  const url = `${RAILWAY_URL}/functions/${functionName}`;
  const rid = requestId || generateRequestId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-request-id': rid,
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
    throw new Error(`Railway function error ${response.status} [rid=${rid}]: ${errorText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return { data: response as any, error: null };
  }

  const data = await response.json();
  return { data, error: null };
}

// Edges do Externo que exigem identidade de usuário, não só a anon key (que é
// pública e não identifica ninguém). Para estas, e SÓ para estas, o JWT da
// sessão do Cloud vai em x-cloud-jwt — header separado porque o Authorization já
// carrega a anon key exigida pelo gateway do Supabase. É uma lista e não o
// padrão porque header novo entra no preflight de CORS: mandar para uma edge que
// não declara x-cloud-jwt em Access-Control-Allow-Headers faria o navegador
// bloquear a chamada inteira.
const EXTERNAL_COM_JWT = new Set(['celcoin-open-finance']);

async function callExternal<T>(
  functionName: string,
  body?: Record<string, any>,
  authToken?: string,
  requestId?: string
): Promise<{ data: T | null; error: Error | null }> {
  const url = `${EXTERNAL_URL}/functions/v1/${functionName}`;
  const rid = requestId || generateRequestId();

  // Ignora o JWT da sessão Cloud injetado no invokeFunction: ele é de OUTRO projeto.
  // Funções no externo usam verify_jwt=false; o gateway só exige o apikey do externo.
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${EXTERNAL_ANON_KEY}`,
      'apikey': EXTERNAL_ANON_KEY,
      'x-request-id': rid,
      ...(authToken && EXTERNAL_COM_JWT.has(functionName) ? { 'x-cloud-jwt': authToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`External function error ${response.status} [rid=${rid}]: ${errorText}`);
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
  options?: { body?: any; authToken?: string; requestId?: string }
): Promise<{ data: T | null; error: Error | null }> {
  const body = options?.body;
  let authToken = options?.authToken;
  const requestId = options?.requestId || generateRequestId();

  // Auto-injeta JWT da sessão Cloud se não foi passado explicitamente.
  // Necessário para handlers do Railway que validam JWT (ex.: onboarding-checkpoint-execute).
  if (!authToken) {
    try {
      const { authClient } = await import('@/integrations/supabase');
      const { data: { session } } = await authClient.auth.getSession();
      if (session?.access_token) authToken = session.access_token;
    } catch {/* segue sem token — handler decide se aceita anônimo */}
  }

  const target = getTarget(functionName);
  const CALLERS: Record<FunctionTarget, typeof callCloud> = {
    cloud: callCloud,
    railway: callRailway,
    external: callExternal,
  };
  // Fallback por alvo: external e railway caem no Cloud; Cloud cai no Railway (se houver).
  const FALLBACK: Record<FunctionTarget, FunctionTarget | null> = {
    cloud: RAILWAY_URL ? 'railway' : null,
    railway: 'cloud',
    external: 'cloud',
  };
  const primary = CALLERS[target];
  const fallbackTarget = FALLBACK[target];
  const fallback = fallbackTarget ? CALLERS[fallbackTarget] : null;

  try {
    const result = await primary<T>(functionName, body, authToken, requestId);
    if (import.meta.env.DEV) {
      console.log(`[Router] ${functionName} → ${target} ✓ [rid=${requestId}]`);
    }
    return result;
  } catch (err) {
    const businessPayload = parseFunctionErrorPayload(err);
    if (isInvalidMetaTokenError(functionName, businessPayload)) {
      console.warn(`[Router] ${functionName} → token Meta inválido/expirado [rid=${requestId}]`);
      return { data: { success: false, ...businessPayload } as T, error: null };
    }

    console.warn(`[Router] ${functionName} → ${target} FALHOU [rid=${requestId}]:`, err);

    // Fallback: tenta o backend alternativo definido no mapa FALLBACK
    if (fallback && fallbackTarget) {
      try {
        console.log(`[Router] ${functionName} → fallback para ${fallbackTarget}... [rid=${requestId}]`);
        const result = await fallback<T>(functionName, body, authToken, requestId);
        console.log(`[Router] ${functionName} → ${fallbackTarget} (fallback) ✓ [rid=${requestId}]`);
        return result;
      } catch (fallbackErr) {
        console.error(`[Router] ${functionName} → fallback também falhou [rid=${requestId}]:`, fallbackErr);
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

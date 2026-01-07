// Debug Logger for Native App Connection Monitoring
const isNativeApp = () => {
  return window.location.protocol === 'capacitor:' || 
         (window as any).Capacitor !== undefined ||
         document.URL.includes('capacitor://');
};

const getEnvironmentInfo = () => ({
  platform: isNativeApp() ? 'native' : 'web',
  url: window.location.href,
  origin: window.location.origin,
  protocol: window.location.protocol,
  userAgent: navigator.userAgent,
  online: navigator.onLine,
  timestamp: new Date().toISOString(),
});

export const debugLog = (category: string, message: string, data?: any) => {
  const prefix = `[${category.toUpperCase()}]`;
  const env = getEnvironmentInfo();
  
  console.log(`${prefix} ${message}`, {
    ...env,
    ...(data && { data }),
  });
};

export const logAppInit = () => {
  debugLog('INIT', '🚀 App inicializado', getEnvironmentInfo());
  
  // Monitor online/offline status
  window.addEventListener('online', () => {
    debugLog('NETWORK', '✅ Conexão restaurada');
  });
  
  window.addEventListener('offline', () => {
    debugLog('NETWORK', '❌ Conexão perdida');
  });
};

export const logApiCall = (endpoint: string, method: string, success: boolean, details?: any) => {
  const status = success ? '✅' : '❌';
  debugLog('API', `${status} ${method} ${endpoint}`, details);
};

export const logSupabaseConnection = (success: boolean, details?: any) => {
  const status = success ? '✅' : '❌';
  debugLog('SUPABASE', `${status} Conexão com backend`, details);
};

export const logMetaConnection = (success: boolean, details?: any) => {
  const status = success ? '✅' : '❌';
  debugLog('META', `${status} Conexão com Meta API`, details);
};

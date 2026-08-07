import { useState, useEffect, useCallback } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// Chave pública VAPID — pública por design (pode ficar no bundle). A privada
// correspondente fica só no Railway (secret VAPID_PRIVATE_KEY).
const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'BCvftQ_LuWT31NIHmtAFRdCCVbstlWNZEfmUN95EMGx7-DlSd4CayKSWAXEOmalmeQBCXpkbu1Gapj0H1_v9NuE';

const SW_URL = '/push-sw.js';
const SW_SCOPE = '/push-sw/';
const OPTOUT_KEY = 'push-optout';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isPreview() {
  const h = window.location.hostname;
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  return inIframe || h.includes('id-preview--') || h.includes('lovableproject.com');
}

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ se apresenta como Mac; o toque é o que denuncia.
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

async function waitActive(reg: ServiceWorkerRegistration) {
  if (reg.active) return;
  const sw = reg.installing || reg.waiting;
  if (!sw) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    sw.addEventListener('statechange', () => { if (sw.state === 'activated') done(); });
    setTimeout(done, 3000);
  });
}

/**
 * Web Push nativo. Registra um service worker isolado (só push), pede permissão,
 * assina e guarda a assinatura no Externo (push_subscriptions). A função Railway
 * send-team-push envia os pushes usando a chave privada VAPID.
 */
export function usePushNotifications() {
  const { user } = useAuthContext();
  const supported = pushSupported() && !isPreview();
  // iOS só entrega Web Push para app instalado na tela inicial (16.4+). Fora do
  // standalone o Safari nem expõe PushManager, então `supported` é false — mas o
  // caminho existe: instalar. Sem esta distinção a UI dizia "não suportado" e a
  // pessoa não tinha o que fazer (0 iPhones inscritos em 22 assinaturas).
  const needsInstall = !supported && !isPreview() && isIOS() && !isStandalone();
  const [permission, setPermission] = useState<NotificationPermission>(
    pushSupported() ? Notification.permission : 'denied'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  // A auto-assinatura abaixo é assíncrona. Sem este flag a UI trata "ainda não
  // verifiquei" como "não assinado" e pisca um convite pra quem já está ativo.
  const [checked, setChecked] = useState(false);

  const saveSubscription = useCallback(async (sub: PushSubscription) => {
    if (!user?.id) return;
    await ensureExternalSession();
    const json = sub.toJSON();
    const { error } = await (externalSupabase as any).from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) {
      console.error('[push] falha ao salvar assinatura:', error);
      throw error;
    }
  }, [user?.id]);

  const getRegistration = useCallback(async () => {
    const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    const reg = existing || await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    await waitActive(reg);
    return reg;
  }, []);

  const subscribeAndSave = useCallback(async () => {
    // Sem usuário não há onde gravar a assinatura (a chave é user_id). Acontece
    // em /install, que é rota pública — sem isso a UI dizia "ativado" e nada era
    // salvo, deixando o aparelho mudo com cara de configurado.
    if (!user?.id) throw new Error('NO_USER');
    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await saveSubscription(sub);
    setSubscribed(true);
  }, [user?.id, getRegistration, saveSubscription]);

  const enable = useCallback(async () => {
    if (!supported) { toast.error('Notificações não suportadas neste navegador'); return; }
    if (!user?.id) { toast.error('Entre na sua conta antes de ativar as notificações'); return; }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { toast.info('Permissão de notificação negada'); return; }
      localStorage.removeItem(OPTOUT_KEY);
      await subscribeAndSave();
      toast.success('Notificações ativadas neste dispositivo');
    } catch (e) {
      console.error('Erro ao ativar push:', e);
      toast.error('Não foi possível ativar as notificações');
    } finally {
      setBusy(false);
    }
  }, [supported, user?.id, subscribeAndSave]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      localStorage.setItem(OPTOUT_KEY, '1');
      const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => { /* ignora */ });
        await ensureExternalSession();
        await (externalSupabase as any).from('push_subscriptions').delete().eq('endpoint', endpoint);
      }
      setSubscribed(false);
      toast.success('Notificações desativadas neste dispositivo');
    } catch (e) {
      console.error('Erro ao desativar push:', e);
      toast.error('Não foi possível desativar');
    } finally {
      setBusy(false);
    }
  }, []);

  // Notificação de teste LOCAL (via o próprio SW) — não passa pelo servidor.
  // Serve para o usuário confirmar se o sistema operacional deixa a notificação
  // aparecer (ex.: no Windows o Chrome precisa estar ligado nas Notificações).
  const testNotification = useCallback(async () => {
    if (!supported) { toast.error('Notificações não suportadas neste navegador'); return; }
    if (Notification.permission !== 'granted') { toast.info('Ative as notificações primeiro'); return; }
    try {
      const reg = await getRegistration();
      await reg.showNotification('WhatsJUD', {
        body: 'Notificação de teste — se você está vendo isso, está tudo certo! ✅',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
      });
      toast.success('Teste enviado. Não apareceu? Veja as notificações do Windows/navegador.');
    } catch (e) {
      console.error('Erro no teste de notificação:', e);
      toast.error('Não foi possível exibir a notificação de teste');
    }
  }, [supported, getRegistration]);

  // Auto-garante a assinatura se a permissão já foi concedida e o usuário não
  // optou por sair (self-heal se o SW tiver sido removido por um force-refresh).
  useEffect(() => {
    if (!supported || !user?.id) { setChecked(true); return; }
    if (Notification.permission !== 'granted' || localStorage.getItem(OPTOUT_KEY) === '1') {
      setChecked(true);
      return;
    }
    subscribeAndSave()
      .catch(() => { /* ignora */ })
      .finally(() => setChecked(true));
  }, [supported, user?.id, subscribeAndSave]);

  return { supported, needsInstall, checked, permission, subscribed, busy, enable, disable, testNotification };
}

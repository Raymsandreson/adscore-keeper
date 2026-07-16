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
  const [permission, setPermission] = useState<NotificationPermission>(
    pushSupported() ? Notification.permission : 'denied'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const saveSubscription = useCallback(async (sub: PushSubscription) => {
    if (!user?.id) return;
    await ensureExternalSession();
    const json = sub.toJSON();
    const { error } = await externalSupabase.from('push_subscriptions').upsert({
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
  }, [getRegistration, saveSubscription]);

  const enable = useCallback(async () => {
    if (!supported) { toast.error('Notificações não suportadas neste navegador'); return; }
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
  }, [supported, subscribeAndSave]);

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
        await externalSupabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
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

  // Auto-garante a assinatura se a permissão já foi concedida e o usuário não
  // optou por sair (self-heal se o SW tiver sido removido por um force-refresh).
  useEffect(() => {
    if (!supported || !user?.id) return;
    if (Notification.permission !== 'granted') return;
    if (localStorage.getItem(OPTOUT_KEY) === '1') return;
    subscribeAndSave().catch(() => { /* ignora */ });
  }, [supported, user?.id, subscribeAndSave]);

  return { supported, permission, subscribed, busy, enable, disable };
}

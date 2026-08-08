/**
 * Notificação nativa do sistema, disparada pelo app aberto.
 *
 * Por que existe: `new Notification(...)` NÃO é construível no Chrome do Android
 * — lança `TypeError: Illegal constructor`. Todo alerta do sistema que usava o
 * construtor simplesmente não aparecia no celular (e ainda estourava exceção no
 * meio do fluxo). O caminho que funciona nos dois mundos é
 * `ServiceWorkerRegistration.showNotification()`.
 *
 * Reaproveita o service worker de push que já existe (`/push-sw.js`, escopo
 * `/push-sw/`) — ele já sabe tratar o clique e levar a pessoa até a URL. Nada de
 * fetch/cache é interceptado por ele.
 *
 * Nota de alcance: isto só roda com o app ABERTO. Alerta que precisa chegar com
 * o app fechado tem que sair do servidor (ver railway-server/.../send-team-push).
 */

const SW_URL = '/push-sw.js';
const SW_SCOPE = '/push-sw/';

export interface NativeNotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  /** URL aberta ao tocar na notificação; tratada pelo push-sw. */
  url?: string;
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Pede permissão. Retorna true só quando concedida. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch (e) {
    console.error('[notif] falha ao obter o service worker:', e);
    return null;
  }
}

/**
 * Mostra a notificação. Nunca lança — alerta que falha não pode derrubar o
 * fluxo que o chamou. Retorna se conseguiu exibir.
 */
export async function showNativeNotification(
  title: string,
  options: NativeNotificationOptions = {},
): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;

  const { url, ...rest } = options;
  const payload: NotificationOptions = {
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    ...rest,
    data: { url: url || '/' },
  };

  const reg = await getPushRegistration();
  if (reg) {
    try {
      await reg.showNotification(title, payload);
      return true;
    } catch (e) {
      console.error('[notif] showNotification falhou:', e);
    }
  }

  // Desktop antigo sem service worker: o construtor ainda serve.
  try {
    new Notification(title, payload);
    return true;
  } catch {
    return false;
  }
}

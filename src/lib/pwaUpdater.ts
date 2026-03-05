/**
 * PWA Update checker — forces reload when a new service worker is available.
 * Works for installed PWA (desktop/mobile) and browser tabs.
 */

let refreshing = false;

export function initPWAUpdater() {
  if (!('serviceWorker' in navigator)) return;

  // When a new SW takes control, reload to get fresh assets
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      console.log('[PWA] Nova versão detectada, recarregando…');
      window.location.reload();
    }
  });

  // Periodically check for updates (every 60s)
  setInterval(() => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) {
        reg.update().catch(() => {});
      }
    });
  }, 60 * 1000);

  // Also check on visibility change (user returns to app)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          reg.update().catch(() => {});
        }
      });
    }
  });
}

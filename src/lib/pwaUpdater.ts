/**
 * PWA Update manager — robust detection, manual apply, and forced refresh for mobile.
 */

let refreshing = false;
let waitingWorker: ServiceWorker | null = null;
let updateCallbacks: Array<() => void> = [];

/** Register a callback when an update is available */
export function onUpdateAvailable(cb: () => void) {
  updateCallbacks.push(cb);
  if (waitingWorker) cb();
  return () => {
    updateCallbacks = updateCallbacks.filter(fn => fn !== cb);
  };
}

/** Tell the waiting SW to activate */
export function applyUpdate() {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }
}

/**
 * Check for updates. Returns:
 * - 'update-found' if a new SW is waiting
 * - 'up-to-date' if no update
 * - 'no-sw' if service workers not supported/registered
 */
export async function checkForUpdates(): Promise<'update-found' | 'up-to-date' | 'no-sw'> {
  if (!('serviceWorker' in navigator)) return 'no-sw';

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'no-sw';

    await reg.update();

    // After update(), check if there's a waiting worker
    if (reg.waiting) {
      waitingWorker = reg.waiting;
      updateCallbacks.forEach(cb => cb());
      return 'update-found';
    }

    // Wait a moment for updatefound to fire
    return new Promise<'update-found' | 'up-to-date'>((resolve) => {
      let resolved = false;

      const onUpdateFound = () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = newWorker;
            updateCallbacks.forEach(cb => cb());
            if (!resolved) { resolved = true; resolve('update-found'); }
          }
        });
      };

      reg.addEventListener('updatefound', onUpdateFound);

      // Timeout: if no update found in 3s, consider up-to-date
      setTimeout(() => {
        reg.removeEventListener('updatefound', onUpdateFound);
        if (!resolved) { resolved = true; resolve('up-to-date'); }
      }, 3000);
    });
  } catch {
    return 'no-sw';
  }
}

/**
 * Force hard refresh — equivalent to Ctrl+F5 on mobile.
 * Unregisters all SWs, clears all caches, then reloads.
 */
export async function forceHardRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch {
    // ignore errors during cleanup
  }
  window.location.reload();
}

/** Initialize — listen for waiting workers and controller changes */
export function initPWAUpdater() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  navigator.serviceWorker.getRegistration().then(async (reg) => {
    if (!reg) return;

    const notifyIfWaiting = () => {
      if (!reg.waiting) return;
      waitingWorker = reg.waiting;
      updateCallbacks.forEach(cb => cb());
    };

    // Check immediately on app startup so newly published versions are detected fast.
    notifyIfWaiting();
    try {
      await reg.update();
    } catch {
      // ignore update check failures (offline/intermittent network)
    }
    notifyIfWaiting();

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          waitingWorker = newWorker;
          updateCallbacks.forEach(cb => cb());
        }
      });
    });

    // Auto-update silencioso: poll a cada 60s + quando a aba volta ao foco.
    // Com skipWaiting/clientsClaim, o SW novo assume controle e o 'controllerchange' recarrega sozinho.
    const poll = () => { reg.update().catch(() => undefined); };
    setInterval(poll, 60_000);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') poll();
    });
  });
}

/**
 * PWA Update checker — notifies user when a new version is available
 * instead of auto-reloading or checking aggressively on every session.
 */

let refreshing = false;
let waitingWorker: ServiceWorker | null = null;
let updateCallbacks: Array<() => void> = [];

export function onUpdateAvailable(cb: () => void) {
  updateCallbacks.push(cb);
  // If already detected, fire immediately
  if (waitingWorker) cb();
  return () => {
    updateCallbacks = updateCallbacks.filter(fn => fn !== cb);
  };
}

export function applyUpdate() {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }
}

export function checkForUpdates() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg) reg.update().catch(() => {});
  });
}

export function initPWAUpdater() {
  if (!('serviceWorker' in navigator)) return;

  // When a new SW takes control, reload to get fresh assets
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  // Listen for waiting service workers
  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg) return;

    // Already waiting
    if (reg.waiting) {
      waitingWorker = reg.waiting;
      updateCallbacks.forEach(cb => cb());
    }

    // New SW installed while page is open
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
  });
}

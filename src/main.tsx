import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logAppInit } from "./utils/debugLogger";
import { initPWAUpdater } from "./lib/pwaUpdater";

const PRELOAD_RELOAD_KEY = "vite-preload-reload";
const PREVIEW_CACHE_BUST_KEY = "preview-cache-busted-once";
const isPreviewHost = window.location.hostname.includes("id-preview--");

const clearRuntimeCaches = async () => {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => undefined);
  }

  if ("caches" in window) {
    await caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .catch(() => undefined);
  }
};

// Initialize debug logging for native app monitoring
logAppInit();

// In preview/dev, clear old SW/cache to prevent stale module fetches.
if (import.meta.env.DEV || isPreviewHost) {
  const shouldForceReload = isPreviewHost && sessionStorage.getItem(PREVIEW_CACHE_BUST_KEY) !== "1";
  if (shouldForceReload) sessionStorage.setItem(PREVIEW_CACHE_BUST_KEY, "1");

  void clearRuntimeCaches().finally(() => {
    if (shouldForceReload) window.location.reload();
  });
}

// Recover from stale-chunk/preload failures after deployments.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();

  if (sessionStorage.getItem(PRELOAD_RELOAD_KEY) === "1") return;

  sessionStorage.setItem(PRELOAD_RELOAD_KEY, "1");
  window.location.reload();
});

window.addEventListener(
  "pageshow",
  () => {
    sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
  },
  { once: true }
);

// Keep update watcher only for production PWA builds.
if (import.meta.env.PROD) {
  initPWAUpdater();
}

createRoot(document.getElementById("root")!).render(<App />);


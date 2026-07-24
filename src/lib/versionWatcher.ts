/**
 * Version watcher — detecta deploy novo (Lovable) sem depender de service worker.
 *
 * O SW deste projeto se auto-desregistra (public/sw.js é um kill switch), então
 * não há caminho de "waiting worker" em produção. Aqui fazemos polling do
 * index.html e comparamos o fingerprint dos assets com hash (que o Vite troca a
 * cada build). Quando muda, acendemos o badge "Atualizar" e — só quando é seguro —
 * recarregamos sozinho.
 *
 * "Seguro" = aba oculta e ninguém digitando. Nunca descartamos um formulário
 * sendo preenchido enquanto a pessoa está trabalhando na aba.
 */

import { notifyUpdateAvailable } from "./pwaUpdater";

const POLL_MS = 60_000;

let baseline: string | null = null;
let updatePending = false;

/** Extrai os assets com hash (/assets/xxx.js|css) e monta uma assinatura estável. */
function fingerprint(html: string): string {
  const assets = Array.from(
    html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g)
  ).map((m) => m[0]);
  return Array.from(new Set(assets)).sort().join("|");
}

async function fetchFingerprint(): Promise<string | null> {
  try {
    const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const fp = fingerprint(await res.text());
    return fp || null;
  } catch {
    // offline/intermitente — tenta de novo no próximo ciclo
    return null;
  }
}

/** Alguém digitando em input/textarea/contenteditable? */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

function maybeAutoReload() {
  if (!updatePending) return;
  if (document.visibilityState === "hidden" && !isTyping()) {
    window.location.reload();
  }
}

async function check() {
  const fp = await fetchFingerprint();
  if (!fp || baseline === null) return;

  if (fp !== baseline && !updatePending) {
    updatePending = true;
    notifyUpdateAvailable(); // acende o badge "Atualizar" (FloatingNav/AppSidebar)
    maybeAutoReload();
  }
}

export function initVersionWatcher() {
  void (async () => {
    const fp = await fetchFingerprint();
    if (!fp) return; // sem assets com hash (dev/preview) → não vigia
    baseline = fp;

    window.setInterval(check, POLL_MS);
    window.addEventListener("focus", () => void check());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void check();
      } else {
        // acabou de ocultar com update pendente → momento seguro pra recarregar
        maybeAutoReload();
      }
    });
  })();
}

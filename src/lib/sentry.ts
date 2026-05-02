// Lazy-loaded Sentry: only fetched in PROD, async, off the critical path.
// Saves ~244KB from the initial bundle in development and pre-prod loads.

const SENTRY_DSN = "https://3b5660f73bda792947cc50058f061d50@o4511213092667392.ingest.us.sentry.io/4511213120258048";

type SentryModule = typeof import("@sentry/react");

let sentryPromise: Promise<SentryModule | null> | null = null;

const loadSentry = (): Promise<SentryModule | null> => {
  if (!import.meta.env.PROD) return Promise.resolve(null);
  if (!sentryPromise) {
    sentryPromise = import("@sentry/react").catch((e) => {
      console.error("Failed to load Sentry:", e);
      return null;
    });
  }
  return sentryPromise;
};

export const initSentry = () => {
  if (!import.meta.env.PROD) return;

  // Defer init off the critical render path
  const schedule =
    (typeof window !== "undefined" && (window as any).requestIdleCallback) ||
    ((cb: () => void) => setTimeout(cb, 0));

  schedule(async () => {
    const Sentry = await loadSentry();
    if (!Sentry) return;
    try {
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: "production",
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({
            maskAllText: false,
            blockAllMedia: false,
          }),
        ],
      });
    } catch (e) {
      console.error("Failed to initialize Sentry:", e);
    }
  });
};

// Manual error capture for catch blocks
export const captureError = async (error: unknown, context?: Record<string, any>) => {
  if (!import.meta.env.PROD) {
    console.error("[Sentry would capture]:", error, context);
    return;
  }
  const Sentry = await loadSentry();
  if (!Sentry) return;
  if (error instanceof Error) {
    if (context) Sentry.setContext("additional", context);
    Sentry.captureException(error);
  } else {
    Sentry.captureMessage(String(error), { level: "error" });
  }
};

export const setSentryUser = async (user: { id: string; email?: string; name?: string }) => {
  if (!import.meta.env.PROD) return;
  const Sentry = await loadSentry();
  Sentry?.setUser(user);
};

export const clearSentryUser = async () => {
  if (!import.meta.env.PROD) return;
  const Sentry = await loadSentry();
  Sentry?.setUser(null);
};

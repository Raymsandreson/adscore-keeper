import * as Sentry from "@sentry/react";

const SENTRY_DSN = "https://3b5660f73bda792947cc50058f061d50@o4511213092667392.ingest.us.sentry.io/4511213120258048";

export const initSentry = () => {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.PROD ? "production" : "development",
    tracesSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    enabled: import.meta.env.PROD,
  });
};

// Manual error capture for catch blocks
export const captureError = (error: unknown, context?: Record<string, any>) => {
  if (error instanceof Error) {
    if (context) {
      Sentry.setContext("additional", context);
    }
    Sentry.captureException(error);
  } else {
    Sentry.captureMessage(String(error), { level: "error" });
  }
};

// Capture user info for better error tracking
export const setSentryUser = (user: { id: string; email?: string; name?: string }) => {
  Sentry.setUser(user);
};

export const clearSentryUser = () => {
  Sentry.setUser(null);
};

export { Sentry };

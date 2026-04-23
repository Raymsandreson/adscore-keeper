import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Resolve build SHA: prefer CI env vars, fallback to local git, then 'unknown'
function resolveBuildSha(): string {
  const fromEnv =
    process.env.VITE_BUILD_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_REF;
  if (fromEnv) return fromEnv.substring(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const BUILD_SHA = resolveBuildSha();
const BUILD_TIME = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    host: "::",
    port: 8080,
  },
  // Auth uses Lovable Cloud (env vars from .env) - external DB is accessed via edge functions only
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      devOptions: { enabled: false },
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'favicon.ico'],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // index.html NUNCA é cacheado — sempre busca da rede para detectar updates
        navigateFallback: null,
        runtimeCaching: [
          {
            // HTML sempre da rede
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/gliigkupoebmlbwyvijp\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
      manifest: {
        name: 'WhatsJUD - Gestão Inteligente',
        short_name: 'WhatsJUD',
        description: 'Plataforma inteligente para gestão de leads, marketing digital e automação',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Use existing public/manifest.json — do not generate one
      manifest: false,
      registerType: "autoUpdate",
      strategies: "generateSW",
      workbox: {
        // Import push notification handler into the generated service worker
        importScripts: ["/push-sw.js"],
        // Precache all build output: JS chunks (incl. lazy-loaded), CSS, HTML,
        // icons, SVGs, and the two terminal Nerd Font woff2 files (~2.4MB total)
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Main bundle exceeds default 2 MiB — raise to 5 MiB
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        // Hash routing: all navigations hit "/" → serve index.html from cache
        navigateFallback: "index.html",
        // Never intercept API calls, WebSocket upgrades, SSE streams, or the
        // SocialView VNC iframe (serving index.html for /socialview/vnc/*
        // would break the embedded noVNC viewer).
        navigateFallbackDenylist: [/^\/api/, /^\/ws/, /^\/socialview/],
        runtimeCaching: [
          {
            // All /api/* fetch() calls: always go to network, never cache
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            // Cache icon/image assets with stale-while-revalidate
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            // Cache fonts with cache-first strategy
            urlPattern: /\.(?:woff|woff2|ttf|otf)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "fonts",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: false,
    proxy: {
      "/api": "http://localhost:3457",
      "/ws": {
        target: "ws://localhost:3457",
        ws: true,
      },
    },
  },
});

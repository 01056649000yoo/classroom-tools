import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,json}'],
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vocab-data',
              expiration: { maxEntries: 10 },
            },
          },
        ],
      },
      manifest: {
        name: '문해력 서바이벌',
        short_name: '문해력',
        lang: 'ko',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-dexie': ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'survival.xn--vz0ba242ncqcba79xhwx.site',
      'helper.xn--vz0ba242ncqcba79xhwx.site',
      'app.xn--9y2br3k43n.kr',
      'localhost',
      '127.0.0.1',
    ],
  },
  preview: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: [
      'survival.xn--vz0ba242ncqcba79xhwx.site',
      'helper.xn--vz0ba242ncqcba79xhwx.site',
      'app.xn--9y2br3k43n.kr',
      'localhost',
      '127.0.0.1',
    ],
  },
});

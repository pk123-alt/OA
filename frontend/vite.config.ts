import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/OA/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ArthroVix',
        short_name: 'ArthroVix',
        description: 'Clinical screening app for osteoarthritis and gait assessment.',
        theme_color: '#071b2e',
        background_color: '#071b2e',
        display: 'standalone',
        start_url: '/OA/',
        scope: '/OA/',
        lang: 'en',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/OA/oa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});

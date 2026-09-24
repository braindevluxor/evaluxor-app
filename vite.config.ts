import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'EvaLuxor - Evaluaciones 360 Supermercados',
        short_name: 'EvaLuxor',
        description: 'Evaluaciones 360 de sucursales con indicadores de gestión y soporte offline.',
        theme_color: '#0B2545',
        background_color: '#0B2545',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/evaluar',
        lang: 'es',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html'
      }
    })
  ],
  server: {
    proxy: {
      // Reenvía al backend de precios como servidor (sin CORS). En producción
      // el mismo path lo resuelve un rewrite en vercel.json.
      '/api/pricing': {
        target: 'https://deliveryluxor.store',
        changeOrigin: true,
        secure: true
      }
    }
  },
  build: {
    target: 'es2020'
  }
})
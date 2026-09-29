import { defineConfig, type Plugin } from 'vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Identidad de esta build. Se inyecta en el bundle (`__APP_VERSION__` /
 * `__BUILD_ID__` / `__BUILD_FECHA__`) y además se publica como `version.json` en
 * la raíz, que es lo que la app consulta para saber si hay una versión nueva.
 * Con eso cada teléfono puede decir con qué build está trabajando y el Líder ve
 * en /usuarios quién quedó atrás.
 */
function identidadBuild(): { version: string; buildId: string; commit: string; fecha: string } {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }
  const fecha = new Date().toISOString()
  let commit = 'sinc-git'
  try {
    // En Vercel el clon es shallow, pero el HEAD siempre está disponible.
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || commit
  } catch {
    // Build sin .git (o sin git instalado): se degrada a la fecha, sin romper.
  }
  // Ordenable por fecha: 20260929-1912-a1b2c3
  const buildId = `${fecha.slice(0, 10).replace(/-/g, '')}-${fecha.slice(11, 16).replace(':', '')}-${commit}`
  return { version: pkg.version, buildId, commit, fecha }
}

/** Publica `/version.json` (el service worker no lo precachea: siempre fresco). */
function pluginVersion(info: ReturnType<typeof identidadBuild>): Plugin {
  return {
    name: 'evaluxor-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(info, null, 2)}\n` })
    }
  }
}

const build = identidadBuild()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __BUILD_ID__: JSON.stringify(build.buildId),
    __BUILD_FECHA__: JSON.stringify(build.fecha)
  },
  plugins: [
    pluginVersion(build),
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
      },
      // Reenvía al API de flota/vehículos (dev-logix). El path interno /api/flota
      // corresponde al /api/v1 del backend; el header Authorization viaja tal cual.
      '/api/flota': {
        target: 'https://dev-logix.tusupermercadoluxor.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/flota/, '/api/v1')
      }
    }
  },
  build: {
    target: 'es2020'
  }
})
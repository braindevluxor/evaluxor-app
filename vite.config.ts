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

/** El valor de una clave del entorno: `process.env` (Vercel) o el `.env` de siempre. */
function valorEntorno(clave: string): string {
  const enProceso = process.env[clave]
  if (enProceso) return enProceso
  try {
    for (const linea of readFileSync(resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
      const i = linea.indexOf('=')
      if (i > 0 && linea.slice(0, i).trim() === clave) {
        return linea.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // Sin .env: la landing queda con sus marcadores y pinta sus valores por defecto.
  }
  return ''
}

/**
 * La config de Supabase de la landing `/gran-cosecha.html`.
 *
 * Ese archivo vive en `public/`, así que Vite lo COPIA tal cual: ni `define`
 * ni `transformIndexHtml` le llegan. Los marcadores `__SUPABASE_URL__` /
 * `__SUPABASE_ANON_KEY__` se reemplazan acá, en los dos caminos en que se
 * sirve:
 *
 *  - dev, con un middleware antes del servidor estático;
 *  - build, emitiendo el asset ya transformado. La copia de `public/` corre
 *    en `renderStart` —ANTES de escribir el bundle—, así que éste es el que
 *    queda en `dist/` y el que el service worker precachea.
 *
 * Si falta el entorno no se reemplaza nada: el marcador arranca con "_" y
 * el script de la página ni siquiera intenta conectar. La anon key es
 * pública por diseño —es la misma que viaja en el bundle de la app—.
 */
function pluginLandingGranCosecha(): Plugin {
  const origen = resolve(process.cwd(), 'public/gran-cosecha.html')
  const transformar = (): string => {
    let html = readFileSync(origen, 'utf8')
    const pares: [string, string][] = [
      ['__SUPABASE_URL__', valorEntorno('VITE_SUPABASE_URL')],
      ['__SUPABASE_ANON_KEY__', valorEntorno('VITE_SUPABASE_ANON_KEY')]
    ]
    for (const [marcador, valor] of pares) {
      if (valor) html = html.split(marcador).join(valor)
    }
    return html
  }
  return {
    name: 'evaluxor-landing-gran-cosecha',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/gran-cosecha.html')) return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(transformar())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'gran-cosecha.html', source: transformar() })
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
    pluginLandingGranCosecha(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Los iconos y los logos de marca van en webp: el isotipo pesa la décima
      // parte que el png y se ve igual. `includeAssets` es el listado exacto que
      // se pre-cachea, así que el resto de los webp de public no entra.
      includeAssets: [
        'favicon.webp',
        'icons/icon-192.webp',
        'icons/icon-512.webp',
        'icons/maskable-512.webp',
        'completo.webp',
        'isotipo.webp'
      ],
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
        // El isotipo sobre el mismo disco navy de siempre (#0B2545, el mismo
        // color que `theme_color`). La maskable va a sangre completa: el
        // sistema le recorta la forma, así que la marca tiene que vivir dentro
        // de la zona segura del centro.
        icons: [
          { src: '/icons/icon-192.webp', sizes: '192x192', type: 'image/webp' },
          { src: '/icons/icon-512.webp', sizes: '512x512', type: 'image/webp' },
          { src: '/icons/maskable-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Los originales de marca son la fuente con la que se generaron los
        // webp: la app no los usa y no tienen que ocupar el caché offline.
        // `evidencia/` son fotos de varios MB (hasta ~7): workbox TIRA ERROR
        // de build si un archivo pasa su límite de precaché (2 MiB), y
        // subir el límite tampoco sería la solución — precachear ~50 MB de
        // fotos obligaría a descargarlos a todos al instalar el SW. Se van
        // igual al caché de runtime como cualquier imagen.
        globIgnores: ['**/isotipo.png', '**/completo.png', '**/logo.png', '**/evidencia/**'],
        navigateFallback: '/index.html',
        // El handler de push. `generateSW` no acepta handlers propios, así que
        // en vez de migrar a `injectManifest` (lo que obligaría a reescribir el
        // precacheo offline) se carga un archivo aparte por `importScripts`.
        // Va ANTES del precacheo en el template de Workbox, así que las
        // escuchas de `push` y `notificationclick` quedan registradas desde la
        // instalación del SW. Ver `public/push-handler.js`.
        importScripts: ['/push-handler.js']
      }
    })
  ],
  optimizeDeps: {
    include: ['jspdf', 'jspdf-autotable']
  },
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
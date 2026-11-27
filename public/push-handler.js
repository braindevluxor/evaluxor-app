/**
 * HANDLER DE PUSH DEL SERVICE WORKOR
 * -----------------------------------
 * Vivo en `public/` y entra al SW generado por Workbox por `importScripts`
 * (ver `workbox.importScripts` en `vite.config.ts`).
 *
 * POR QUÉ UN ARCHIVO APARTE Y NO UNA MIGRACIÓN A `injectManifest`
 * --------------------------------------------------------------
 * El SW lo genera `generateSW`, que no acepta handlers propios. La única
 * alternativa era migrar a `injectManifest` con un SW escrito a mano — y eso
 * significaba reimplementar el precacheo (`globPatterns`, `globIgnores`,
 * `navigateFallback`), que es el offline, que según PRODUCT.md es el core del
 * producto. `importScripts` carga este archivo SIN tocar nada de eso: el
 * precacheo sigue siendo el de siempre y acá sólo se agregan dos escuchas.
 *
 * Lo que llega en el payload es un JSON con esta forma:
 *
 *   { "title": "...", "body": "...", "url": "/ruta", "tag": "clave" }
 *
 * `tag` es lo que evita que la misma notificación se apile: dos avisos con el
 * mismo tag reemplazan al anterior en vez de apilarse en la bandeja.
 *
 * Todo se defiende solo: un payload que no es JSON, o que no trae `title`,
 * no puede tirar abajo el SW — si éste muere, se muere el offline también.
 */

/** El icono de la notificación: el mismo del manifest. */
const ICONO = '/icons/icon-192.webp'
const ICONO_MASKABLE = '/icons/maskable-512.webp'

/**
 * Lee el payload como objeto, sea string u objeto.
 *
 * El push service manda el body como string; dependiendo de cómo se mande
 * puede llegar ya parseado. Y si llega algo que no es JSON, se devuelve un
 * objeto mínimo con el texto crudo en `title`: mejor mostrar algo que no
 * mostrar nada, y mejor eso que romper.
 */
function leerPayload(event) {
  const crudo = event.data ? event.data.text() : ''
  if (typeof crudo !== 'string' || !crudo) {
    return { title: 'EvaLuxor', body: '', url: '/evaluar', tag: '' }
  }
  try {
    const datos = JSON.parse(crudo)
    if (datos && typeof datos === 'object') {
      return {
        title: typeof datos.title === 'string' && datos.title ? datos.title : 'EvaLuxor',
        body: typeof datos.body === 'string' ? datos.body : '',
        url: typeof datos.url === 'string' && datos.url ? datos.url : '/evaluar',
        tag: typeof datos.tag === 'string' ? datos.tag : ''
      }
    }
  } catch {
    // No era JSON: se muestra el texto tal cual, como título.
  }
  return { title: 'EvaLuxor', body: crudo, url: '/evaluar', tag: '' }
}

self.addEventListener('push', (event) => {
  const { title, body, url, tag } = leerPayload(event)

  // `requireInteraction: false` a propósito: el aviso se va solo, como los de
  // la app. Con `true` quedaría clavado en la bandeja hasta que alguien lo
  // cierre, que es justo lo que la gente termina ignorando.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICONO,
      maskable: ICONO_MASKABLE,
      badge: ICONO,
      tag,
      data: { url },
      // El sonido lo pone el sistema operativo; acá sólo se pide.
      silent: false
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/evaluar'

  // Abrir es apuntar a una pestaña ya abierta: si la app está abierta en
  // segundo plano (que es lo normal, es una PWA instalada), se trae adelante
  // en vez de abrir una segunda.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const ventana of ventanas) {
        if ('focus' in ventana) {
          // `navigate` sólo existe en ventanas de la app; si está en otra
          // página, se enfoca y ya, sin arrastrarla a una ruta que no le toca.
          if ('navigate' in ventana) {
            return ventana.focus().then(() => ventana.navigate(url))
          }
          return ventana.focus()
        }
      }
      // Ninguna abierta: se abre una nueva.
      return self.clients.openWindow(url)
    })
  )
})

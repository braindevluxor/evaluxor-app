import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check } from 'lucide-react'
import { suscribirAvisos, type Aviso } from '../lib/aviso'

/** Cuánto tiempo se queda en pantalla antes de apagarse sola. */
const DURACION = 2800

/**
 * El único cartel flotante de la app.
 *
 * Vive en `App` y se pinta por portal en `document.body`, así que pasa por
 * encima de la barra inferior de controles (`z-40`), de los modales
 * (`z-[100]` / `z-[130]`) y de la pantalla completa de incidencias (`z-[100]`)
 * sin que ninguna pantalla tenga que saber que existe.
 *
 * Va `aria-hidden` a propósito: el anuncio para lector de pantalla lo hace el
 * botón que dispara el aviso (su propio `aria-live`), y repetirlo aquí sería
 * dos anuncios para el mismo toque. Esto es confirmación a la vista.
 *
 * Lleva `key` con la clave del aviso: es lo que remonta el elemento y por lo
 * tanto lo que hace correr la animación de entrada cada vez, aunque el host
 * siga montado.
 */
export function AvisoHost() {
  const [aviso, setAviso] = useState<Aviso | null>(null)

  useEffect(() => suscribirAvisos(setAviso), [])

  // Se apaga sola, y el reloj se reinicia si llega otro aviso antes: por eso
  // depende del aviso entero y no solo de la clave.
  useEffect(() => {
    if (!aviso) return
    const reloj = setTimeout(
      () => setAviso((a) => (a && a.clave === aviso.clave ? null : a)),
      DURACION
    )
    return () => clearTimeout(reloj)
  }, [aviso])

  if (!aviso || typeof document === 'undefined') return null

  const ok = aviso.tono === 'ok'

  return createPortal(
    <div
      key={aviso.clave}
      aria-hidden="true"
      className={[
        // `bottom-24` deja libre la barra de controles (72px de alto): el
        // cartel nunca tapa Anterior / Incidencia / Siguiente.
        'aviso-entrar pointer-events-none fixed bottom-24 left-1/2 z-[150]',
        '-translate-x-1/2 max-w-[calc(100vw-2rem)]',
        'flex items-center gap-2.5 rounded-2xl px-4 py-2.5',
        // La sombra se sostiene porque el elemento es `fixed`: la regla de
        // relieve plano de `index.css` deja pasar a los flotantes.
        'text-sm font-bold text-white shadow-lg shadow-slate-900/30',
        ok ? 'bg-slate-900' : 'bg-red-600'
      ].join(' ')}
    >
      <span
        className={[
          'grid h-5 w-5 shrink-0 place-items-center rounded-full',
          ok ? 'bg-green-500' : 'bg-white/25'
        ].join(' ')}
      >
        {ok ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>
      <span className="truncate">{aviso.texto}</span>
    </div>,
    document.body
  )
}

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, AlertCircle, Check, Info, X } from 'lucide-react'
import { suscribirAvisos, type Aviso, type TonoAviso } from '../lib/aviso'
import { cn } from './ui'

/** Cuánto tiempo se queda en pantalla antes de apagarse sola. */
const DURACION = 2800

/**
 * La pinta de cada tono: franja de color a la izquierda, fondo tintado,
 * burbuja con el icono y el título. El cuerpo del aviso es el texto que pasó
 * quien avisó — ése no se toca, es el dato—; el título lo pone el tono.
 *
 * Los colores no se inventan: verde/ámbar/rojo son la escala que la app ya usa
 * para estados, y el azul de «información» es el primario de la casa.
 */
const TONOS: Record<
  TonoAviso,
  { titulo: string; franja: string; fondo: string; burbuja: string; Icono: typeof Check }
> = {
  ok: { titulo: 'Listo', franja: 'border-green-500', fondo: 'bg-green-50', burbuja: 'bg-green-500', Icono: Check },
  aviso: { titulo: 'Atención', franja: 'border-amber-400', fondo: 'bg-amber-50', burbuja: 'bg-amber-400', Icono: AlertTriangle },
  error: { titulo: 'No se pudo', franja: 'border-red-500', fondo: 'bg-red-50', burbuja: 'bg-red-500', Icono: AlertCircle },
  info: { titulo: 'Aviso', franja: 'border-primary-500', fondo: 'bg-primary-50', burbuja: 'bg-primary-500', Icono: Info }
}

/**
 * El único cartel flotante de la app.
 *
 * Vive en `App` y se pinta por portal en `document.body`, así que pasa por
 * encima de la barra inferior de controles (`z-40`), de los modales
 * (`z-[100]` / `z-[130]`) y de la pantalla completa de incidencias (`z-[100]`)
 * sin que ninguna pantalla tenga que saber que existe.
 *
 * El formato es el de una notificación de sistema: color de banda a la
 * izquierda, fondo tintado, icono en su burbuja y el texto al lado. El
 * contenedor es `pointer-events-none` — tocar el vacío de alrededor no se
 * come el toque de la pantalla— y sólo la tarjeta es `pointer-events-auto`,
 * que es la que lleva el botón de cerrar.
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

  const tono = TONOS[aviso.tono]

  return createPortal(
    <div
      key={aviso.clave}
      aria-hidden="true"
      className={[
        // `bottom-24` deja libre la barra de controles (72px de alto): el
        // cartel nunca tapa Anterior / Incidencia / Siguiente.
        'aviso-entrar pointer-events-none fixed bottom-24 left-1/2 z-[150]',
        '-translate-x-1/2 max-w-[calc(100vw-2rem)]'
      ].join(' ')}
    >
      <div
        className={cn(
          'pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3',
          'rounded-2xl border-l-4 px-4 py-3',
          // La sombra se sostiene porque el elemento es `fixed`: la regla de
          // relieve plano de `index.css` deja pasar a los flotantes.
          'shadow-lg shadow-slate-900/15',
          tono.franja,
          tono.fondo
        )}
      >
        <span
          className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white', tono.burbuja)}
        >
          <tono.Icono className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">{tono.titulo}</p>
          <p className="mt-0.5 text-sm text-slate-600">{aviso.texto}</p>
        </div>
        <button
          type="button"
          onClick={() => setAviso(null)}
          aria-label="Cerrar aviso"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-700"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>,
    document.body
  )
}

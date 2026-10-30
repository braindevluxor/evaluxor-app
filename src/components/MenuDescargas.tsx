import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { BOTON_CABECERA } from './ui'

/**
 * Una entrada del menú de descargas: icono, rótulo y qué hacer al tocarla.
 */
export interface OpcionDescarga {
  /** Clave estable para React (no es un id de DOM). */
  id: string
  /** Texto visible de la opción. */
  etiqueta: string
  icono: ReactNode
  onSelect: () => void
}

/**
 * Un solo botón de descargas en la barra azul, con un menú para elegir entre
 * las salidas que ya existen (PDF general, Excel general, reporte por cargo).
 *
 * Antes eran tres botones icono seguidos en el encabezado del detalle: la fila
 * se llenaba de iconos casi idénticos y no se sabía cuál bajaba qué. Acá la
 * barra queda con una sola acción «Descargar» y el desglose vive en el menú,
 * que se cierra al elegir, al tocar afuera o con Escape.
 *
 * El botón usa `BOTON_CABECERA` (el mismo rostro del resto de la barra) y el
 * menú se posiciona relativo al botón: el encabezado es `sticky` con `z-30`,
 * así que el panel con `z-50` queda por encima del contenido de la página.
 */
export function MenuDescargas({
  opciones,
  disabled = false
}: {
  opciones: OpcionDescarga[]
  /** Mientras se genera un archivo no se abre: evita dos descargas superpuestas. */
  disabled?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const cajaRef = useRef<HTMLDivElement>(null)

  // Cierre al tocar afuera. Va en un efecto porque el listener vive en
  // `document`, fuera del árbol de React: sin esto el menú quedaba abierto
  // encima de la página hasta tocar otra opción.
  useEffect(() => {
    if (!abierto) return
    const alTocarFuera = (e: MouseEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    const alEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', alTocarFuera)
    document.addEventListener('keydown', alEscape)
    return () => {
      document.removeEventListener('mousedown', alTocarFuera)
      document.removeEventListener('keydown', alEscape)
    }
  }, [abierto])

  return (
    <div ref={cajaRef} className="relative">
      <button
        type="button"
        className={BOTON_CABECERA}
        disabled={disabled}
        onClick={() => setAbierto((a) => !a)}
        title="Descargar"
        aria-label="Descargar"
        aria-haspopup="menu"
        aria-expanded={abierto}
      >
        <Download className="h-5 w-5" />
      </button>

      {abierto ? (
        <div
          role="menu"
          aria-label="Opciones de descarga"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {opciones.map((op) => (
            <button
              key={op.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false)
                op.onSelect()
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <span className="shrink-0 text-primary-600" aria-hidden="true">
                {op.icono}
              </span>
              <span className="min-w-0 truncate">{op.etiqueta}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

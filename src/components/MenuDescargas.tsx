import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download } from 'lucide-react'
import { BOTON_CABECERA, cn } from './ui'

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
 * Un solo botón de descargas, con un menú para elegir entre las salidas que ya
 * existen (PDF general, Excel general, reporte por cargo).
 *
 * Antes eran tres botones icono seguidos en el encabezado del detalle: la fila
 * se llenaba de iconos casi idénticos y no se sabía cuál bajaba qué. Acá queda
 * una sola acción «Descargar» y el desglose vive en el menú, que se cierra al
 * elegir, al tocar afuera o con Escape.
 *
 * Dos particularidades, porque vive en dos mundos distintos:
 *
 *   - EL BOTÓN: por defecto usa `BOTON_CABECERA` (la cara de las barras azules:
 *     el detalle y `MobileLayout`). En filas sobre blanco (Historial) se le pasa
 *     `claseBoton` con `claseBotonIcono('secondary')`, si no el texto blanco del
 *     `BOTON_CABECERA` quedaría invisible sobre la tarjeta.
 *   - EL MENÚ: se monta por portal en `document.body` y se posiciona en
 *     `fixed` contra el rectángulo del botón. Un `absolute` común queda cortado
 *     por el `overflow-x-auto` de la tabla del Historial, y ahí las últimas
 *     filas no verían nunca el menú.
 */
export function MenuDescargas({
  opciones,
  disabled = false,
  claseBoton
}: {
  opciones: OpcionDescarga[]
  /** Mientras se genera un archivo no se abre: evita dos descargas superpuestas. */
  disabled?: boolean
  /** Clases del botón gatillo. Por defecto, la cara de la barra azul. */
  claseBoton?: string
}) {
  const [abierto, setAbierto] = useState(false)
  /** Posición del menú en coordenadas de ventana; null mientras no se midió. */
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const cajaRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const botonRef = useRef<HTMLButtonElement>(null)

  // Medir el botón cada vez que se abre (y al mover la página): con `fixed`
  // el menú vive fuera del flujo, así que su ancla es el rectángulo del
  // botón en pantalla. Los listeners capturan el scroll de cualquier
  // contenedor, no sólo el del `window`.
  useEffect(() => {
    if (!abierto) {
      setPos(null)
      return
    }
    const medir = () => {
      const r = botonRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    medir()
    window.addEventListener('scroll', medir, true)
    window.addEventListener('resize', medir)
    return () => {
      window.removeEventListener('scroll', medir, true)
      window.removeEventListener('resize', medir)
    }
  }, [abierto])

  // Cierre al tocar afuera. Va en un efecto porque el listener vive en
  // `document`, fuera del árbol de React: sin esto el menú quedaba abierto
  // encima de la página hasta tocar otra opción. El menú va por portal, así
  // que también cuenta como "adentro": sin esto el mousedown de una opción la
  // cerraría antes del click y la opción no dispararía.
  useEffect(() => {
    if (!abierto) return
    const alTocarFuera = (e: MouseEvent) => {
      const destino = e.target as Node
      if (cajaRef.current?.contains(destino) || menuRef.current?.contains(destino)) return
      setAbierto(false)
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
    <div ref={cajaRef} className="relative inline-block">
      <button
        ref={botonRef}
        type="button"
        className={cn(claseBoton ?? BOTON_CABECERA)}
        disabled={disabled}
        onClick={() => setAbierto((a) => !a)}
        title="Descargar"
        aria-label="Descargar"
        aria-haspopup="menu"
        aria-expanded={abierto}
      >
        <Download className="h-5 w-5" />
      </button>

      {abierto && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Opciones de descarga"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-[100] w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
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
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

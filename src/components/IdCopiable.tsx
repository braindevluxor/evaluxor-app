import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copiarAlPortapapeles } from '../lib/copiar'

/**
 * El `id` del producto en la API, tocable: al tocarlo se copia.
 *
 * Es el dato que hay que pegar en el sistema de precios para confirmar de qué
 * producto es la fila, y transcribirlo a mano —número por número— es donde se
 * cuelga. El texto entero es la zona de toque (no hay un botón chiquito al
 * lado), y el único cambio visual al copiar es el icono: `Copy` pasa a `Check`
 * sin mover nada de alrededor.
 */
export function IdCopiable({ id, className }: { id: number | string; className?: string }) {
  const [copiado, setCopiado] = useState(false)
  const reloj = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(reloj.current), [])

  const alCopiar = () => {
    void copiarAlPortapapeles(String(id)).then((ok) => {
      if (!ok) return
      setCopiado(true)
      clearTimeout(reloj.current)
      reloj.current = setTimeout(() => setCopiado(false), 1800)
    })
  }

  const etiqueta = copiado ? 'ID copiado' : `Copiar ID ${id}`

  return (
    <button
      type="button"
      onClick={alCopiar}
      title={etiqueta}
      aria-label={etiqueta}
      className={[
        // Sin caja ni borde: se lee como el resto del renglón y solo el
        // subrayado punteado avisa que es tocable.
        'inline-flex items-center gap-1 rounded-md px-1 py-0.5',
        '-mx-1 -my-0.5 align-middle',
        'font-bold transition-colors hover:bg-slate-100 active:bg-slate-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'decoration-dotted underline-offset-2 hover:decoration-slate-400',
        copiado ? 'underline' : 'underline decoration-slate-300',
        className ?? ''
      ].join(' ')}
    >
      <span>ID: {id}</span>
      {copiado ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      )}
      {/* El icono es sólo confirmación visual; quién usa lector de pantalla se
          entera del cambio por este anuncio. */}
      <span className="sr-only" aria-live="polite">
        {copiado ? 'ID copiado' : ''}
      </span>
    </button>
  )
}

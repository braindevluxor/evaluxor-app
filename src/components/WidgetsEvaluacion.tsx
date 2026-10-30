import { useState, type ReactNode } from 'react'
import { Ban } from 'lucide-react'
import { cn } from './ui'

/**
 * Widgets compartidos por los editores de ítems (ItemRenderer y el editor de planos
 * PLANO_XY). Viven aparte para que el visor de planos pueda usarlos sin importarlo
 * desde ItemRenderer, que a su vez importa al visor.
 */

/** Chips toggle para que el evaluador elija a quién(es) se atribuye un punto INCUMPLIDO (falla). Múltiples = el punto fallado se carga a cada uno. */
export function SelectorResponsables({ responsables, seleccion, onChange, gerente, etiqueta, ayuda }: {
  responsables: string[]
  seleccion: string[]
  onChange: (sel: string[]) => void
  gerente?: string | null
  etiqueta?: string
  /** Texto de ayuda; por defecto explica a dónde va la falla si no se elige a nadie. */
  ayuda?: string
}) {
  // Cuando el punto queda sin cumplir ya están definidos los que responden por
  // él, así que los chips aparecen marcados apenas se abre el trabajador. Es una
  // preselección de cara al evaluador, NO una escritura: hasta que él toca algo
  // no se guarda nada.
  //
  // La diferencia importa. Si el valor se escribiera solo al montar, dos cosas
  // indeseadas salen de una: el punto dejaría de estar "sin cumplir" (y el panel
  // se escondería solo), y el trabajador quedaría como revisado, lo que enciende
  // la casilla de "cuenta para el puntaje" junto a su nombre y puede hacer que
  // la fila entera desaparezca de la lista. Ambas decisiones las tiene que tomar
  // el evaluador.
  //
  // El primer toque confirma la preselección entera y le aplica el cambio, así
  // que sacar un chip guarda el resto y agregar uno guarda el resto más ese.
  const [tocado, setTocado] = useState(false)
  const preseleccionando = !tocado && seleccion.length === 0 && responsables.length > 0
  const elegidos = preseleccionando ? responsables : seleccion

  if (!responsables.length) return null
  const toggle = (r: string) => {
    const existe = elegidos.includes(r)
    setTocado(true)
    onChange(existe ? elegidos.filter((x) => x !== r) : [...elegidos, r])
  }
  const sinElegir = elegidos.length === 0
  return (
    <div className="min-w-0 space-y-1.5">
      {etiqueta ? <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{etiqueta}</p> : null}
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {responsables.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => toggle(r)}
            title={elegidos.includes(r) ? `Quitar ${r}` : `Marcar a ${r} como responsable`}
            className={cn(
              'max-w-full min-w-0 break-words rounded-full px-2.5 py-1 text-center text-[11px] font-bold transition-colors',
              elegidos.includes(r) ? 'bg-primary text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">
        {preseleccionando
          ? responsables.length === 1
            ? `Preseleccionado: ${responsables[0]} es el único responsable de este punto. Tocá el chip para confirmarlo.`
            : `Preseleccionados los ${responsables.length} responsables de este punto. Tocá un chip para confirmar.`
          : ayuda ??
            (sinElegir
              ? (gerente ? `Sin elegir, la falla queda para ${gerente}.` : 'Elige quién responde por este punto incumplido (pueden ser varios).')
              : elegidos.length > 1
                ? 'El punto fallado se carga a cada responsable elegido.'
                : 'El punto fallado se carga a este responsable.')}
      </p>
    </div>
  )
}

export function BotonNoAplica({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
        activo
          ? 'border-amber-300 bg-amber-100 text-amber-800'
          : 'border-slate-200 bg-white text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
      )}
    >
      <Ban className="h-3.5 w-3.5" />
      {children}
    </button>
  )
}

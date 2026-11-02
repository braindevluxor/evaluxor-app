import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from './ui'
import { alternarTema, temaActual } from '../lib/tema'

/**
 * El interruptor del modo oscuro, para los DOS menús de la casa: el de la
 * cuenta en la barra de la consola y el del modo de evaluación en el teléfono.
 *
 * El estado se lee del DOM (la clase en `<html>` es la fuente de verdad), así
 * que nunca queda desincronizado aunque el tema cambie desde el otro menú.
 *
 * El toque aporta sus coordenadas: de ahí nace el círculo del revelado
 * (`alternarTema`), que no puede salir del centro si no sabe desde dónde vino.
 *
 * El padding es del que lo usa: acá sólo va la fila, para que se alinee con
 * los ítems de cada menú.
 */
export function TemaInterruptor({ className }: { className?: string }) {
  const [oscuro, setOscuro] = useState(() => temaActual() === 'oscuro')

  return (
    <button
      type="button"
      role="switch"
      aria-checked={oscuro}
      onClick={(e) => setOscuro(alternarTema({ x: e.clientX, y: e.clientY }) === 'oscuro')}
      className={cn(
        'flex w-full items-center justify-between gap-3 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100',
        className
      )}
    >
      <span className="flex items-center gap-3">
        {oscuro ? <Moon className="h-4 w-4 text-slate-400" /> : <Sun className="h-4 w-4 text-slate-400" />}
        Modo oscuro
      </span>
      <span
        aria-hidden
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', oscuro ? 'bg-primary' : 'bg-slate-300')}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all',
            oscuro ? 'left-[1.125rem]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  )
}

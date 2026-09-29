import { cn } from './ui'
import type { Conectado } from '../context/PresenciaContext'

/**
 * Punto verde + en qué pantalla está la persona. Sin conexión muestra un punto
 * apagado: la presencia solo dice que la app está abierta con señal, no que haya
 * subido datos (para eso está la última sincronización).
 */
export function EnLinea({ conectado, className }: { conectado?: Conectado | null; className?: string }) {
  if (!conectado) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-slate-400', className)} title="Ahora mismo no tiene la app abierta con señal">
        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
        Desconectado
      </span>
    )
  }
  const extra = conectado.dispositivos > 1 ? ` · ${conectado.dispositivos} dispositivos` : ''
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={`${conectado.nombre} · ${conectado.dispositivo}${extra}`}>
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-green-700">En línea</span>
        <span className="block truncate text-xs text-slate-500">{conectado.pantalla}</span>
      </span>
    </span>
  )
}

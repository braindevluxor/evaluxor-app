import { cn } from './ui'
import type { Conectado } from '../context/PresenciaContext'
import { BUILD_ID } from '../lib/version'

/**
 * Punto verde + en qué pantalla está la persona. Sin conexión muestra un punto
 * apagado: la presencia solo dice que la app está abierta con señal, no que haya
 * subido datos (para eso está la última sincronización).
 *
 * Si el dispositivo corre una build distinta a la del que mira la pantalla, se
 * marca en rojo: es la forma de ver de un vistazo a quién le va a seguir fallando
 * por tener la app vieja.
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
  const atrasada = !!conectado.build_id && conectado.build_id !== BUILD_ID
  // El build va siempre en el tooltip: el líder puede pasar el mouse por cualquiera
  // y saber con qué build está ese teléfono, no solo por los que quedaron viejos.
  const build = conectado.build_id ? ` · build ${conectado.version} ${conectado.build_id}` : ''
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
      title={`${conectado.nombre} · ${conectado.dispositivo}${extra}${build}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-green-700">En línea</span>
        <span className="block truncate text-xs text-slate-500">{conectado.pantalla}</span>
        {atrasada ? (
          <span className="block text-[10px] font-bold uppercase tracking-wide text-red-600">
            Versión vieja · {conectado.version}
          </span>
        ) : null}
      </span>
    </span>
  )
}

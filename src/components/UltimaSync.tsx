import { COLOR_ESTADO_SYNC, TEXTO_ESTADO_SYNC, desdeAhora, estadoSync, formatearFechaHora } from '../lib/tiempo'
import { cn } from './ui'

const COLOR_TEXTO: Record<ReturnType<typeof estadoSync>, string> = {
  nunca: 'text-slate-400',
  reciente: 'text-green-700',
  medio: 'text-amber-700',
  viejo: 'text-red-600'
}

/**
 * Última vez que el usuario logró subir datos del dispositivo a la nube
 * (`profiles.ultima_sync`, marcada por la RPC `registrar_sync` al subir). Un punto
 * de color resume el estado: verde acaba de subir, ámbar hace rato, rojo más de un
 * día y gris nunca subió. El title lleva la fecha y hora exactas.
 */
export function UltimaSync({ ultimaSync, className }: { ultimaSync?: string | null; className?: string }) {
  const estado = estadoSync(ultimaSync)
  const exacto = ultimaSync ? ` · ${formatearFechaHora(ultimaSync)}` : ''
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium', COLOR_TEXTO[estado], className)} title={`${TEXTO_ESTADO_SYNC[estado]}${exacto}`}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', COLOR_ESTADO_SYNC[estado])} />
      {desdeAhora(ultimaSync)}
    </span>
  )
}

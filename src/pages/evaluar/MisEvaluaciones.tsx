import { useEffect, useState } from 'react'
import type { VistaEvaluacion } from '../../lib/types'
import { Badge, EmptyState, Puntaje, Spinner } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { useAuth } from '../../context/AuthContext'
import { consultarEvaluaciones } from '../../lib/data/indicadores'

export function MisEvaluaciones() {
  const { profile } = useAuth()
  const [evals, setEvals] = useState<VistaEvaluacion[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!profile) return
    void (async () => {
      try {
        const d = await consultarEvaluaciones({ sucursal_ids: null })
        setEvals(d.evaluaciones.filter((e) => e.evaluador_id === profile.id))
      } catch {
        setEvals([])
      }
      setCargando(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  return (
    <MobileLayout titulo="Mi historial" subtitulo="Evaluaciones enviadas">
      {cargando ? (
        <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
      ) : evals.length === 0 ? (
        <EmptyState
          title="Aún no has enviado evaluaciones"
          subtitle="Las evaluaciones que envíes aparecerán aquí una vez sincronizadas."
        />
      ) : (
        <div className="space-y-3">
          {evals.map((ev) => (
            <div key={ev.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-primary-900">{ev.sucursal?.nombre ?? 'Sucursal'}</p>
                  <p className="text-xs text-slate-500">{new Date(ev.completed_at).toLocaleString('es')}</p>
                </div>
                <div className="text-right">
                  <Puntaje value={ev.puntuacion} />
                  <div className="mt-1">
                    <Badge color={ev.puntuacion != null && ev.puntuacion >= 80 ? 2 : ev.puntuacion != null && ev.puntuacion >= 60 ? 3 : 4}>
                      Enviada
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </MobileLayout>
  )
}
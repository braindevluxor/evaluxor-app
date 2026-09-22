import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, FileDown, Trash2 } from 'lucide-react'
import type { VistaEvaluacion } from '../../lib/types'
import { Badge, Button, Confirmar, EmptyState, Puntaje, Spinner } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { useAuth } from '../../context/AuthContext'
import { consultarEvaluaciones, eliminarEvaluacion } from '../../lib/data/indicadores'
import { descargarPdf } from '../../lib/pdf'

export function MisEvaluaciones() {
  const { profile } = useAuth()
  const [evals, setEvals] = useState<VistaEvaluacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [descargando, setDescargando] = useState<string | null>(null)
  const [aEliminar, setAEliminar] = useState<VistaEvaluacion | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const descargar = async (ev: VistaEvaluacion) => {
    setError(null)
    setDescargando(ev.id)
    try {
      await descargarPdf(ev.id)
    } catch {
      setError('No se pudo generar el PDF. Intenta de nuevo en unos segundos.')
    }
    setDescargando(null)
  }

  const eliminar = async () => {
    if (!aEliminar) return
    setError(null)
    const id = aEliminar.id
    try {
      await eliminarEvaluacion(id)
      setEvals((prev) => prev.filter((e) => e.id !== id))
      setAEliminar(null)
    } catch {
      setError('No se pudo eliminar la evaluación.')
      setAEliminar(null)
    }
  }

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
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
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
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={descargando === ev.id}
                  onClick={() => void descargar(ev)}
                >
                  {descargando === ev.id ? <Spinner className="h-4 w-4" /> : <FileDown className="h-4 w-4" />}
                  {descargando === ev.id ? 'Generando…' : 'PDF'}
                </Button>
                <Link
                  to={`/evaluaciones/${ev.id}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-white"
                >
                  <Eye className="h-4 w-4" /> Ver detalle
                </Link>
                <button
                  onClick={() => setAEliminar(ev)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Eliminar evaluación"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Confirmar
        open={aEliminar != null}
        texto={`¿Eliminar la evaluación de ${aEliminar?.sucursal?.nombre ?? 'esta sucursal'}? Se borrarán sus respuestas y fotografías.`}
        onConfirm={() => void eliminar()}
        onCancel={() => setAEliminar(null)}
      />
    </MobileLayout>
  )
}
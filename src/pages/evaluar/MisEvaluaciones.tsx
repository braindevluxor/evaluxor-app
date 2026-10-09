import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, FileDown } from 'lucide-react'
import type { EstadoEvaluacion, VistaEvaluacion } from '../../lib/types'
import { Badge, Button, EmptyState, Puntaje, SkeletonTarjetas } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { useAuth } from '../../context/AuthContext'
import { consultarEvaluaciones } from '../../lib/data/indicadores'
import { descargarInformePdf } from '../../lib/pdf'
import { useModulosExportables } from '../../lib/pdf/modulosExportables'
import type { OpcionesPdf } from '../../lib/pdf/opciones'
import { SelectorPdf } from '../../components/SelectorPdf'

const COLOR_ESTADO: Record<EstadoEvaluacion, number> = {
  PROGRAMADA: 4,
  ACTIVA: 2,
  CERRADA: 3
}

export function MisEvaluaciones() {
  const { profile } = useAuth()
  const [evals, setEvals] = useState<VistaEvaluacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [descargando, setDescargando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Evaluación cuyo selector de PDF está abierto. null = cerrado. */
  const [elegirEn, setElegirEn] = useState<string | null>(null)
  const { modulos: modulosDeElegir, cargando: cargandoModulosElegir } = useModulosExportables(elegirEn)

  useEffect(() => {
    if (!profile) return
    void (async () => {
      try {
        const d = await consultarEvaluaciones({ sucursal_ids: null })
        const participadas = d.evaluaciones.filter((e) =>
          d.respuestas.some((r) => r.evaluacion_id === e.id && r.respondido_por === profile.id)
        )
        setEvals(participadas)
      } catch {
        setEvals([])
      }
      setCargando(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const descargar = async (ev: VistaEvaluacion, impresion?: OpcionesPdf) => {
    setError(null)
    setDescargando(ev.id)
    try {
      await descargarInformePdf(ev.id, undefined, impresion)
    } catch {
      setError('No se pudo descargar el PDF. Intenta de nuevo.')
    }
    setDescargando(null)
    setElegirEn(null)
  }

  return (
    <MobileLayout titulo="Mi participación" subtitulo="Evaluaciones donde respondiste módulos">
      {cargando ? (
        <SkeletonTarjetas n={3} cols="" />
      ) : evals.length === 0 ? (
        <EmptyState
          title="Aún no has participado"
          subtitle="Cuando el Líder abra una evaluación y respondas tus módulos, aparecerán aquí."
        />
      ) : (
        <div className="space-y-3">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {evals.map((ev) => (
            <div key={ev.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-primary-900">
                    {ev.departamento?.nombre ?? ev.sucursal?.nombre ?? 'Sucursal'}
                    {ev.departamento ? (
                      <span className="ml-1.5 align-middle text-[10px] font-bold uppercase tracking-wide text-primary-500">Departamento</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(`${ev.fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right">
                  <Puntaje value={ev.puntuacion} />
                  <div className="mt-1">
                    <Badge color={COLOR_ESTADO[ev.estado]}>
                      {ev.estado === 'ACTIVA' ? 'En curso' : ev.estado === 'CERRADA' ? 'Cerrada' : 'Programada'}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={descargando === ev.id}
                  onClick={() => setElegirEn(ev.id)}
                >
                  <FileDown className="h-4 w-4" />
                  Descargar PDF
                </Button>
                <Link
                  to={`/evaluaciones/${ev.id}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-2.5 text-sm font-bold text-white"
                >
                  <Eye className="h-4 w-4" /> Ver detalle
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Una sola instancia del selector para todas las tarjetas: abrir uno por
          evaluación dejaría N modales montados, cada uno con su propio estado de
          casillas. */}
      <SelectorPdf
        abierto={!!elegirEn}
        onClose={() => setElegirEn(null)}
        modulos={modulosDeElegir}
        cargandoModulos={cargandoModulosElegir}
        onConfirmar={(impresion) => {
          const objetivo = evals.find((ev) => ev.id === elegirEn)
          if (objetivo) void descargar(objetivo, impresion)
        }}
        descargando={!!descargando}
      />
    </MobileLayout>
  )
}
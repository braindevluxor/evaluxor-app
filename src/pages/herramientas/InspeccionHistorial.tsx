import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car } from 'lucide-react'
import { useCatalog, useModuloHerramienta } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { listarRevisionesPreEntrega } from '../../lib/data/revisionPreEntrega'
import {
  CLAVE_INSPECCION,
  RUTA_INSPECCION,
  fechaLegible,
  fusionarHistorial,
  type FilaHistorial
} from '../../lib/inspeccionVehiculo'
import { listarPreEntregas } from '../../lib/offline/db'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { Button, Card, EmptyState, Spinner, cn } from '../../components/ui'

/**
 * Historial de inspecciones de vehículo particular.
 *
 * Es la respuesta a «necesito ver las inspecciones anteriores de esos
 * vehículos»: cuando una inspección finalizada sube al servidor, sale de la
 * base del equipo (así se libera el teléfono), así que el pasado sólo se puede
 * ver juntando las dos orillas —lo que quedó acá (borradores y pendientes) y
 * lo que ya está en el servidor— sin repetir filas.
 *
 * Tocar una fila reabre la inspección en su propia pantalla con
 * `?registro=<id>`, donde se puede regenerar su PDF cuantas veces haga falta.
 * Misma puerta que la herramienta: `/evaluar`, EVALUADOR/LIDER, sin sucursal.
 */
export function InspeccionHistorial() {
  const navigate = useNavigate()
  const { cargado } = useCatalog()
  const { online } = useOffline()
  const { modulo } = useModuloHerramienta(CLAVE_INSPECCION)

  const [filas, setFilas] = useState<FilaHistorial[] | null>(null)

  useEffect(() => {
    if (!cargado || !modulo) return
    void (async () => {
      const local = await listarPreEntregas().catch(() => [])
      // Sin conexión (o sin permiso sobre la tabla) el historial no se cae:
      // muestra lo que queda en el equipo y ya.
      const servidor = await listarRevisionesPreEntrega().catch(() => [])
      setFilas(
        fusionarHistorial(
          local.filter((r) => r.modulo_id === modulo.id),
          servidor.filter((r) => r.modulo_id === modulo.id)
        )
      )
    })()
    // Se lee `modulo` completo, pero sólo interesa su id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargado, modulo?.id])

  if (!cargado || (filas === null && modulo)) {
    return (
      <MobileLayout titulo="Historial de inspecciones">
        <div className="py-20 text-center text-slate-400">
          <Spinner className="mx-auto" />
          <p className="mt-3 text-sm">Cargando historial…</p>
        </div>
      </MobileLayout>
    )
  }

  if (!modulo) {
    return (
      <MobileLayout titulo="Historial de inspecciones">
        <EmptyState
          title="No hay checklist configurado"
          subtitle="Ejecuta supabase/inspeccion-vehiculo.sql en el SQL Editor (crea el módulo «Inspección de vehículo» con sus secciones)."
        />
        <div className="text-center">
          <Button variant="ghost" onClick={() => navigate(-1)} className="-ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver
          </Button>
        </div>
      </MobileLayout>
    )
  }

  return (
    <MobileLayout titulo="Historial de inspecciones" subtitulo={modulo.nombre}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => navigate(-1)} className="-ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver
          </Button>
          <span className="text-xs font-semibold tabular-nums text-slate-400">
            {filas?.length ?? 0} inspección{(filas?.length ?? 0) === 1 ? '' : 'es'}
          </span>
        </div>

        {!online ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Sin conexión: sólo se muestran las inspecciones que quedan en este equipo.
          </p>
        ) : null}

        {!filas?.length ? (
          <EmptyState
            title="Aún no hay inspecciones"
            subtitle="Cada inspección que generes con su PDF aparecerá acá, con su placa y su estado."
          />
        ) : (
          <Card>
            <ul className="divide-y divide-slate-100">
              {filas.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`${RUTA_INSPECCION}?registro=${f.id}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <Car className="h-5 w-5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-primary-900">
                        {f.placa || 'Sin placa'}
                        {f.vehiculo ? <span className="font-medium text-slate-500"> · {f.vehiculo}</span> : null}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {fechaLegible(f.fecha)}
                        {f.propietario ? ` · ${f.propietario}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-bold',
                          f.estado === 'FINALIZADA'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-amber-100 text-amber-800'
                        )}
                      >
                        {f.estado === 'FINALIZADA' ? 'Finalizada' : 'Borrador'}
                      </span>
                      {f.pendiente ? (
                        <span className="rounded-full border border-amber-300 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                          Por subir
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </MobileLayout>
  )
}

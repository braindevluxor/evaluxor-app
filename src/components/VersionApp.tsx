/**
 * Versión de la app y "Restaurar app".
 *
 * Sirve para dos cosas concretas:
 *  1. Saber con qué build está corriendo este teléfono (build id + commit), que
 *     es el dato que hace falta cuando alguien reporta una falla.
 *  2. Desbloquear un teléfono que quedó trabado con una versión vieja cacheada,
 *     sin tener que reinstalar la PWA a mano ni perder trabajo sin avisar.
 */

import { useEffect, useState } from 'react'
import { RefreshCw, TriangleAlert, Wrench } from 'lucide-react'
import { Button, Card, Modal, Spinner } from './ui'
import { useOffline } from '../context/OfflineContext'
import { useVersion } from '../context/VersionContext'
import { hayTrabajoSinSubir, recargarApp, resumenLocal, restaurarApp, type ResumenAlmacenamiento } from '../lib/restore'
import { BUILD_ACTUAL, versionCorta } from '../lib/version'

export function TarjetaVersionApp() {
  const { pendientes, sincronizando, sync } = useOffline()
  const { hayActualizacion, versionRemota, actualizando, actualizarAhora } = useVersion()
  const [abierto, setAbierto] = useState(false)
  const [resumen, setResumen] = useState<ResumenAlmacenamiento | null>(null)
  const [trabajo, setTrabajo] = useState(false)
  const [restaurando, setRestaurando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    void (async () => {
      setResumen(await resumenLocal())
      setTrabajo(await hayTrabajoSinSubir())
    })()
  }, [abierto])

  const restaurar = async () => {
    setRestaurando(true)
    await restaurarApp()
    recargarApp()
  }

  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800">
        <Wrench className="h-4 w-4 text-primary" />
        Versión de la app
      </h3>

      <p className="font-mono text-sm font-semibold text-slate-800" title={BUILD_ACTUAL.buildId}>
        {versionCorta()}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        Cuando reportes una falla, mandá una foto de esta línea: dice exactamente con qué build estás.
      </p>

      {hayActualizacion && versionRemota ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">
          <span className="min-w-0 flex-1">Hay una versión nueva: {versionCorta(versionRemota)}</span>
          <Button variant="secondary" onClick={() => void actualizarAhora()} disabled={actualizando}>
            {actualizando ? 'Actualizando…' : 'Actualizar ahora'}
          </Button>
        </div>
      ) : null}

      {pendientes > 0 ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Tenés {pendientes} evaluación(es) sin subir. Sincronizá antes de restaurar: al restaurar se borra la cola del
          dispositivo.
          <Button variant="ghost" className="ml-2" onClick={() => void sync()} disabled={sincronizando}>
            {sincronizando ? 'Subiendo…' : 'Sincronizar ahora'}
          </Button>
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={() => setAbierto(true)}>
          <RefreshCw className="h-4 w-4" />
          Restaurar app
        </Button>
      </div>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Restaurar app"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)} disabled={restaurando}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={() => void restaurar()} disabled={restaurando}>
              {restaurando ? 'Restaurando…' : 'Borrar y recargar'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Borra la copia de la app que quedó guardada en este teléfono (service worker, caché y base local) y la vuelve a
            bajar. Es lo que resuelve una app trabada o que muestra cosas raras.
          </p>
          <p className="font-semibold text-slate-800">En este dispositivo hay:</p>
          {!resumen ? (
            <p className="flex items-center gap-2 text-slate-500">
              <Spinner size={14} /> Contando…
            </p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              <li>{resumen.borradores} borrador(es) de evaluación</li>
              <li>{resumen.cola} evaluación(es) en la cola de subida</li>
              <li>{resumen.incidentes} incidencia(s) sin subir</li>
              <li>{resumen.fotos} foto(s)</li>
            </ul>
          )}
          {trabajo ? (
            <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-700">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
              Hay avance guardado en este teléfono que todavía no llegó a la nube. Si borrás ahora, se pierde: primero
              sincronizá y esperá a que quede todo subido.
            </p>
          ) : (
            <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-green-800">
              No hay nada sin subir. Podés restaurar sin riesgo.
            </p>
          )}
          <p className="text-xs text-slate-500">No se cierra tu sesión: no vas a tener que volver a entrar.</p>
        </div>
      </Modal>
    </Card>
  )
}

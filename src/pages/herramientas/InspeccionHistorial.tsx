import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, FileDown, Trash2 } from 'lucide-react'
import { useCatalog, useModuloHerramienta } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { avisar } from '../../lib/aviso'
import {
  eliminarRevisionPreEntrega,
  listarRevisionesPreEntrega
} from '../../lib/data/revisionPreEntrega'
import {
  CLAVE_INSPECCION,
  RUTA_INSPECCION,
  fechaLegible,
  fusionarHistorial,
  personaDe,
  registroDesdeServidor,
  type FilaHistorial
} from '../../lib/inspeccionVehiculo'
import { exportarInspeccion, nombresEnCarpeta } from '../../lib/pdf/exportarInspeccion'
import { obtenerRevisionPreEntrega } from '../../lib/data/revisionPreEntrega'
import { deletePhoto, eliminarPreEntrega, getPreEntrega, listarPreEntregas } from '../../lib/offline/db'
import { useAuth } from '../../context/AuthContext'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { Button, Card, Confirmar, EmptyState, Spinner, cn } from '../../components/ui'

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
 * Cada fila lleva su papelera, que pide confirmación antes de borrar: saca la
 * inspección de las dos orillas (el equipo con sus fotos y el servidor si hay
 * conexión). Misma puerta que la herramienta: `/evaluar`, EVALUADOR/LIDER, sin
 * sucursal.
 */
export function InspeccionHistorial() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { cargado } = useCatalog()
  const { online } = useOffline()
  const { modulo, items } = useModuloHerramienta(CLAVE_INSPECCION)

  const [filas, setFilas] = useState<FilaHistorial[] | null>(null)
  const [aBorrar, setABorrar] = useState<FilaHistorial | null>(null)
  const [borrando, setBorrando] = useState(false)
  /** Id de la inspección que se está descargando, para girar su ícono. */
  const [generando, setGenerando] = useState<string | null>(null)

  /**
   * Vuelve a juntar las dos orillas.
   *
   * Se lee `modulo` completo, pero sólo interesa su id. Va en un `useCallback`
   * (y no adentro del `useEffect`) porque la misma carga se repite después de
   * borrar una fila: sin esto el historial quedaría mostrando la inspección
   * ya borrada hasta que alguien recargue la pantalla.
   */
  const recargar = useCallback(async () => {
    if (!cargado || !modulo) return
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
  }, [cargado, modulo])

  useEffect(() => {
    void recargar()
  }, [recargar])

  /**
   * Borra una inspección de las dos orillas, empezando por el equipo.
   *
   * El orden importa: primero IndexedDB (es la única que no depende de red) y
   * después el servidor, que sólo se intenta con conexión —sin ella el delete
   * rechazaría y quedaría un aviso de error para algo que es sólo temporal—.
   *
   * Las fotos locales se borran junto con el registro. `eliminarPreEntrega`
   * no las toca (en la subida se quedan porque ya están en el bucket), pero
   * acá nadie las va a volver a pedir: dejarlas sería peso muerto en el
   * teléfono sin ningún registro que las referencie.
   *
   * Si el servidor rechaza el borrado (RLS: cada evaluador sólo borra las
   * suyas) se avisa y la fila se queda en la nube, que es la verdad.
   */
  async function borrar() {
    if (!aBorrar || borrando) return
    setBorrando(true)
    try {
      const registro = await getPreEntrega(aBorrar.id).catch(() => undefined)
      await eliminarPreEntrega(aBorrar.id)
      for (const id of registro?.photoIds ?? []) {
        await deletePhoto(id).catch(() => {})
      }

      if (online) {
        try {
          await eliminarRevisionPreEntrega(aBorrar.id)
          avisar('Inspección borrada.')
        } catch {
          avisar('Se borró de este equipo, pero el servidor rechazó el borrado. Vuelve a intentarlo.', 'error')
        }
      } else {
        avisar('Sin conexión: se borró de este equipo. La copia del servidor sigue ahí.', 'aviso')
      }

      setABorrar(null)
      await recargar()
    } finally {
      setBorrando(false)
    }
  }

  /**
   * Descarga el PDF de una inspección SIN pasar por su pantalla.
   *
   * Usa el mismo pipeline que la herramienta (`exportarInspeccion`): registro
   * del equipo o del servidor, fotos del equipo o del bucket, y el registro
   * finalizado y subido. Reimplementarlo acá daría un segundo PDF que se
   * diverge del primero — ése sin las fotos del bucket, o sin marcar la
   * inspección como hecha.
   */
  async function descargarPdf(f: FilaHistorial) {
    if (!modulo || generando) return
    setGenerando(f.id)
    try {
      const local = await getPreEntrega(f.id).catch(() => undefined)
      let registro = local
      if (!registro) {
        // Ya no está en el equipo: se trae la del servidor y con ella el PDF
        // sale igual (las fotos van desde el bucket por las `paths`).
        const fila = await obtenerRevisionPreEntrega(f.id).catch(() => null)
        registro = fila
          ? registroDesdeServidor(fila, await nombresEnCarpeta(fila.id).catch(() => []))
          : undefined
      }
      if (!registro || registro.modulo_id !== modulo.id) {
        avisar('No se pudo abrir la inspección para generar el PDF.', 'error')
        return
      }

      const { resultado } = await exportarInspeccion({
        registro,
        items,
        persona: personaDe(registro.chofer),
        moduloNombre: modulo.nombre,
        evaluador: profile?.nombre ?? null,
        online
      })
      avisar(
        resultado === 'subida'
          ? 'PDF generado.'
          : 'PDF generado. La inspección queda en el equipo hasta que vuelva la señal.',
        resultado === 'subida' ? 'ok' : 'aviso'
      )
      // La exportación la deja finalizada: la fila tiene que reflejarlo.
      await recargar()
    } catch (e) {
      console.error('Error exportando PDF desde el historial:', e)
      avisar('No se pudo generar el PDF.', 'error')
    } finally {
      setGenerando(null)
    }
  }

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
                <li key={f.id} className="flex items-stretch gap-1">
                  {/* Abrir la inspección. Es un botón y no un <Link> para que
                      la papelera de al lado pueda ser hermano suyo: dos botones
                      anidados no se pueden tocar por separado. */}
                  <button
                    type="button"
                    onClick={() => navigate(`${RUTA_INSPECCION}?registro=${f.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
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
                  {/* Descargar el PDF en el acto: no se navega a la
                      inspección, la fila arma el documento con el mismo
                      pipeline que la herramienta y se queda en esta lista. */}
                  <button
                    type="button"
                    onClick={() => void descargarPdf(f)}
                    disabled={generando === f.id || borrando}
                    title={`Descargar el PDF de la inspección ${f.placa || 'sin placa'}`}
                    aria-label={`Descargar el PDF de la inspección ${f.placa || 'sin placa'}`}
                    className="my-2 shrink-0 self-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary disabled:opacity-50"
                  >
                    {generando === f.id ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <FileDown className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setABorrar(f)}
                    disabled={borrando}
                    title={`Borrar la inspección ${f.placa || 'sin placa'}`}
                    aria-label={`Borrar la inspección ${f.placa || 'sin placa'}`}
                    className="my-2 mr-2 shrink-0 self-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* Borrar es definitivo y la inspección puede estar en dos lados, así que
          el texto dice los dos: la del equipo se pierde siempre y la del
          servidor sólo si hay conexión. Si nunca subió, se va entera. */}
      <Confirmar
        open={!!aBorrar}
        texto={
          aBorrar
            ? `Se borrará la inspección ${aBorrar.placa ? `de ${aBorrar.placa}` : 'sin placa'} (${fechaLegible(aBorrar.fecha)}). ` +
              (aBorrar.pendiente
                ? 'Todavía no se había subido: se pierde para siempre.'
                : online
                  ? 'Se quita también del servidor y no se puede deshacer.'
                  : 'Sin conexión se borra de este equipo; la copia del servidor seguirá ahí.')
            : ''
        }
        textoConfirmar={borrando ? 'Borrando…' : 'Borrar inspección'}
        onConfirm={() => void borrar()}
        onCancel={() => setABorrar(null)}
      />
    </MobileLayout>
  )
}

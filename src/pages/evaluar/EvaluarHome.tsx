import { Link } from 'react-router-dom'
import { CalendarClock, Car, ChevronRight, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { deleteDraft, getDraft } from '../../lib/offline/db'
import { listarEvaluacionesActivas } from '../../lib/data/indicadores'
import type { VistaEvaluacion } from '../../lib/types'
import { Confirmar, EmptyState, cn } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { useEffect, useState } from 'react'

export function EvaluarHome() {
  const { profile } = useAuth()
  const { sucursales, departamentos } = useCatalog()
  const { pendientes } = useOffline()
  // Fecha del borrador LOCAL de cada unidad, o null si no hay. Va la fecha y no
  // un booleano porque con más de una evaluación abierta hace falta saber de
  // CUÁL es: «Continuar» sólo puede decirse en la fila que lo tiene.
  const [conDraft, setConDraft] = useState<Record<string, string | null>>({})
  // Evaluaciones abiertas por UNIDAD (id de sucursal o de departamento: son de
  // tablas distintas, así que conviven en el mismo mapa sin chocar).
  //
  // Va en una LISTA y no en una fecha suelta porque una unidad puede tener MÁS
  // DE UNA abierta — al Líder se le quedó sin cerrar una— y el listado tiene
  // que mostrarlas todas con su fecha: es la única forma de enterarse de que
  // falta cerrar una. Cada fila abre la SUYA (?ev=), no la que elija el azar.
  const [activas, setActivas] = useState<Record<string, VistaEvaluacion[]>>({})
  const [confirmarBorrador, setConfirmarBorrador] = useState<{ id: string; nombre: string } | null>(null)
  const [borrando, setBorrando] = useState(false)

  useEffect(() => {
    void (async () => {
      const map: Record<string, string | null> = {}
      for (const s of sucursales) {
        const d = await getDraft(s.id)
        if (d && d.evaluador_id === profile?.id) map[s.id] = d.fecha
      }
      for (const dep of departamentos) {
        const d = await getDraft(dep.id)
        if (d && d.evaluador_id === profile?.id) map[dep.id] = d.fecha
      }
      setConDraft(map)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursales.length, departamentos.length, pendientes, profile?.id])

  useEffect(() => {
    void (async () => {
      const evals = await listarEvaluacionesActivas().catch(() => [])
      const map: Record<string, VistaEvaluacion[]> = {}
      for (const e of evals) {
        const unidad = e.departamento_id ?? e.sucursal_id
        if (!unidad) continue
        const lista = map[unidad]
        if (lista) lista.push(e)
        else map[unidad] = [e]
      }
      // La más reciente arriba: si alguien entra sin elegir fila, esa es la
      // que abre `EvaluarSucursal`, así que el orden del listado tiene que
      // ser el mismo que el de la pantalla siguiente.
      for (const lista of Object.values(map)) {
        lista.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
      }
      setActivas(map)
    })()
  }, [pendientes])

  const fechaBonita = (fecha: string) =>
    new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
  const sucursalesAbiertas = sucursales.filter((sucursal) => !!activas[sucursal.id])
  const departamentosAbiertos = departamentos.filter((departamento) => !!activas[departamento.id])

  const borrarBorrador = async () => {
    if (!confirmarBorrador || borrando) return
    setBorrando(true)
    try {
      await deleteDraft(confirmarBorrador.id)
      setConDraft((actual) => ({ ...actual, [confirmarBorrador.id]: null }))
      setConfirmarBorrador(null)
    } finally {
      setBorrando(false)
    }
  }

  return (
    <MobileLayout titulo="Evaluar" subtitulo="Selecciona la unidad">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-primary-900">Hola, {profile?.nombre?.split(' ')[0] || 'evaluador'}</h2>
          <p className="text-sm text-slate-500">Selecciona la sucursal o el departamento con evaluación abierta por el Líder.</p>
        </div>

        {Object.keys(activas).length === 0 && sucursales.length === 0 && departamentos.length === 0 ? (
          <EmptyState
            title="No hay sucursales activas"
            subtitle="El Líder debe crear sucursales para poder evaluar."
          />
        ) : Object.keys(activas).length === 0 ? (
          <EmptyState
            title="No hay evaluaciones abiertas"
            subtitle="El Líder debe abrir una evaluación para que la unidad aparezca aquí."
          />
        ) : !sucursalesAbiertas.length && !departamentosAbiertos.length ? (
          <EmptyState
            title="No hay evaluaciones abiertas"
            subtitle="El Líder debe abrir una evaluación para que la unidad aparezca aquí."
          />
        ) : (
          <div className="space-y-3">
            {sucursalesAbiertas.map((s) => {
              const abiertas = activas[s.id] ?? []
              const draft = conDraft[s.id] ?? null
              return (
                <div
                  key={s.id}
                  className={cn(
                    'sup sup-activo group p-4',
                    draft ? 'border-2 border-amber-400' : 'border-2 border-transparent'
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-bold text-primary-900">{s.nombre}</p>
                    <p className="text-xs text-slate-500">
                      {s.shop_id ? `Tienda Nº ${s.shop_id}` : 'Sin nº de tienda'}
                    </p>
                  </div>
                  {/* Una fila por evaluación abierta: si quedaron dos, las dos
                      se ven con su fecha y cada una abre la SUYA (?ev=). Antes
                      había una sola fila con una fecha arbitraria —la primera
                      que traía la consulta— y la otra quedaba invisible. */}
                  <ul className="mt-2 space-y-1.5">
                    {abiertas.map((ev) => (
                      <li key={ev.id}>
                        <Link
                          to={`/evaluar/${s.id}?ev=${ev.id}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-primary hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
                        >
                          <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-green-600">
                            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">Evaluación abierta · {fechaBonita(ev.fecha)}</span>
                          </span>
                          {/* «Continuar» sólo en la fila que tiene el borrador
                              local: es el único dato que sigue vivo sin red. */}
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                            {draft === ev.fecha ? (
                              <>
                                Continuar <ChevronRight className="h-3.5 w-3.5" />
                              </>
                            ) : (
                              'Evaluar'
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {draft ? (
                    <div className="mt-2 flex items-center justify-between gap-2 pt-2">
                      <p className="text-[11px] font-medium text-amber-700">Borrador guardado en este dispositivo.</p>
                      <button
                        type="button"
                        onClick={() => setConfirmarBorrador({ id: s.id, nombre: s.nombre })}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50"
                        title={`Borrar el borrador local de ${s.nombre}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Borrar borrador
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
            {departamentosAbiertos.map((d) => {
              const abiertas = activas[d.id] ?? []
              const draft = conDraft[d.id] ?? null
              return (
                <div
                  key={d.id}
                  className={cn(
                    'sup sup-activo group p-4',
                    draft ? 'border-2 border-amber-400' : 'border-2 border-transparent'
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-bold text-primary-900">
                      {d.nombre}
                      {/* La etiqueta es la que distingue la tarjeta de una
                          sucursal: ambas comparten la misma lista. */}
                      <span className="ml-2 inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-primary-700">
                        Departamento
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">Departamento centralizado</p>
                  </div>
                  {/* Igual que en las sucursales: una fila por evaluación
                      abierta, cada una con su fecha y con la suya. */}
                  <ul className="mt-2 space-y-1.5">
                    {abiertas.map((ev) => (
                      <li key={ev.id}>
                        <Link
                          to={`/evaluar/departamento/${d.id}?ev=${ev.id}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-primary hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
                        >
                          <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-green-600">
                            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">Evaluación abierta · {fechaBonita(ev.fecha)}</span>
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                            {draft === ev.fecha ? (
                              <>
                                Continuar <ChevronRight className="h-3.5 w-3.5" />
                              </>
                            ) : (
                              'Evaluar'
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {draft ? (
                    <div className="mt-2 flex items-center justify-between gap-2 pt-2">
                      <p className="text-[11px] font-medium text-amber-700">Borrador guardado en este dispositivo.</p>
                      <button
                        type="button"
                        onClick={() => setConfirmarBorrador({ id: d.id, nombre: d.nombre })}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50"
                        title={`Borrar el borrador local de ${d.nombre}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Borrar borrador
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Herramienta sin evaluación detrás: se llena con el vehículo en el
          taller o en la calle, y no depende de que el Líder abra una unidad. */}
      <div>
        <h2 className="mb-2 text-sm font-bold text-primary-900">Herramientas</h2>
        <Link
          to="/evaluar/inspeccion-vehiculo"
          className="sup flex items-center justify-between gap-3 p-4 focus:outline-none focus:ring-2 focus:ring-primary-300"
        >
          <span className="flex min-w-0 items-center gap-3">
            <Car className="h-5 w-5 shrink-0 text-primary-900" />
            <span className="min-w-0">
              <span className="block font-bold text-primary-900">Inspección de vehículo</span>
              <span className="block text-xs text-slate-500">
                Estética, mecánica y gas vehicular · fotos, incidencias y PDF
              </span>
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
        </Link>
      </div>

      <Confirmar
        open={!!confirmarBorrador}
        texto={confirmarBorrador
          ? `Se borrará el borrador local de ${confirmarBorrador.nombre} en este dispositivo. Las respuestas no sincronizadas se perderán; las que ya están en la nube podrán volver a cargarse al abrir la evaluación.`
          : ''}
        textoConfirmar={borrando ? 'Borrando…' : 'Borrar borrador'}
        onConfirm={() => void borrarBorrador()}
        onCancel={() => setConfirmarBorrador(null)}
      />
    </MobileLayout>
  )
}
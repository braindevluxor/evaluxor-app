import { Fragment, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonFilas,
  cn
} from '../../components/ui'
import {
  consultarEvaluaciones,
  hallazgosDeCargo,
  seguimientoResponsables,
  type ConjuntoDatos,
  type HallazgoResponsable,
  type SeguimientoResponsables
} from '../../lib/data/indicadores'
import { claveNormalizada } from '../../lib/data/responsables'
import { valorPorResponsable } from '../../lib/scoring'
import { setKpisGlobal, type EstadoKpis } from '../../lib/kpisGlobal'

/**
 * SEGUIMIENTO POR CARGO
 * ---------------------
 * Responde a dos preguntas que hasta ahora sólo se podían contestar evaluación
 * por evaluación: «¿qué cargo acumula más puntos sin cumplir?» y «¿en qué
 * sucursal se le acumulan?».
 *
 * Es una superficie NUEVA del dashboard, no una variante de Indicadores: esa
 * pantalla mide unidades (sucursales, módulos), ésta mide responsables. El
 * cálculo es el mismo de siempre (`incumplimientosPorResponsable`, el de las
 * tarjetas «Puntaje por responsable» de EvaluacionDetalle), sólo que agregado
 * sobre TODO el histórico en vez de sobre una sola evaluación.
 *
 * Visible sólo para el LÍDER: un gerente de sucursal no tiene por qué leer el
 * ranking de cargos de las tiendas ajenas.
 */

type Orden = 'puntos' | 'nombre' | 'cobertura'

/** `2025-03-08` → `8/3/2025`. La fecha llega como string ISO desde Postgres. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-')
  if (!a || !m || !d) return iso
  return `${Number(d)}/${Number(m)}/${a}`
}

/**
 * La banda de color de una celda: el rojo es intenso proporcional a lo peor de
 * la matriz, no a un número fijo. Con un máximo fijo, el día que mejoren todas
 * juntas la matriz se volvería toda verde aunque siguiera habiendo 20 puntos
 * en una sucursal; escalando contra el pico de la propia tabla, el color
 * siempre señala DÓNDE está el problema dentro de lo que hay hoy.
 *
 * El pico (rojo sólido con cifra blanca) es aparte: es la celda que concentra
 * la mirada, y si estuviera sólo un escalón por encima del resto la escala se
 * aplanaría y no habría lugar adonde ir a mirar.
 */
function bandaCelda(puntos: number, maximo: number): string {
  if (!puntos) return 'bg-slate-50 text-slate-500'
  const r = maximo ? puntos / maximo : 1
  if (r >= 1) return 'bg-red-700 text-white'
  if (r <= 0.34) return 'bg-green-50 text-green-700'
  if (r <= 0.67) return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-700'
}

interface Seleccion {
  clave: string
  cargo: string
  unidadId?: string
  unidadNombre?: string
}

/**
 * La pantalla, sin la carga de datos: recibe todo ya agregado.
 *
 * Está separada del `useEffect` que consulta Supabase porque la matriz es puro
 * render sobre datos y así se puede renderizar en un test sin red y sin
 * simular el ciclo de vida del componente.
 */
export interface SeguimientoVistaProps {
  datos: ConjuntoDatos | null
  cargando: boolean
  /** La consulta falló: no se puede decir «no hay puntos», porque no se sabe. */
  error: boolean
  onReintentar: () => void
  seguimiento: SeguimientoResponsables | null
}

export function SeguimientoVista({
  datos,
  cargando,
  error,
  onReintentar,
  seguimiento
}: SeguimientoVistaProps) {
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<Orden>('puntos')
  const [sel, setSel] = useState<Seleccion | null>(null)
  const [visibles, setVisibles] = useState(40)

  // El detalle se recalcula al cambiar de celda y el tope de filas vuelve a 40:
  // si no, abrir un cargo chico dejaba la lista scrolleada a mitad de camino.
  useEffect(() => {
    setVisibles(40)
  }, [sel])

  // Memoizado: un `[]` nuevo en cada render re-dispara los useMemo que dependen
  // de las columnas (los totales por unidad y el pico de la escala).
  const unidades = useMemo(() => seguimiento?.unidades ?? [], [seguimiento])

  const filas = useMemo(() => {
    if (!seguimiento) return []
    const q = claveNormalizada(busqueda.trim())
    const base = q ? seguimiento.filas.filter((f) => f.clave.includes(q)) : [...seguimiento.filas]
    // 'puntos' ya viene ordenado desde la capa de datos (desempate alfabético).
    if (orden === 'nombre') base.sort((a, b) => a.cargo.localeCompare(b.cargo, 'es'))
    if (orden === 'cobertura') base.sort((a, b) => b.unidades - a.unidades || b.puntos - a.puntos)
    return base
  }, [seguimiento, busqueda, orden])

  const maxCelda = useMemo(() => {
    let m = 0
    for (const f of filas) for (const u of unidades) m = Math.max(m, f.porUnidad[u.id] ?? 0)
    return m
  }, [filas, unidades])

  // Los totales por columna salen de las filas VISIBLES: con una búsqueda activa
  // el pie tiene que cerrar contra la suma de las celdas de arriba, y si cada
  // columna contara su matriz entera el renglón no cerraría.
  const totalesPorUnidad = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of filas) for (const u of unidades) m[u.id] = (m[u.id] ?? 0) + (f.porUnidad[u.id] ?? 0)
    return m
  }, [filas, unidades])

  const total = useMemo(() => filas.reduce((a, f) => a + f.puntos, 0), [filas])

  const hallazgos = useMemo(
    () => (datos && sel ? hallazgosDeCargo(datos, sel.clave, sel.unidadId) : []),
    [datos, sel]
  )
  const mostrados = useMemo(() => hallazgos.slice(0, visibles), [hallazgos, visibles])

  // El subtotal de cada módulo se calcula sobre TODOS los hallazgos: la lista se
  // corta en 40 para no renderizar miles de renglones, pero el número del
  // encabezado tiene que decir cuántos puntos hay en ese módulo, no cuántos de
  // los que por ahora se están mostrando.
  const grupos = useMemo(() => {
    const mapa = new Map<string, { modulo: string; puntos: number }>()
    for (const h of hallazgos) {
      const g = mapa.get(h.modulo) ?? { modulo: h.modulo, puntos: 0 }
      g.puntos += h.puntos
      mapa.set(h.modulo, g)
    }
    return Array.from(mapa.values()).sort((a, b) => b.puntos - a.puntos)
  }, [hallazgos])

  const porModulo = useMemo(() => {
    const mapa = new Map<string, typeof mostrados>()
    for (const h of mostrados) {
      const arr = mapa.get(h.modulo) ?? []
      arr.push(h)
      mapa.set(h.modulo, arr)
    }
    return mapa
  }, [mostrados])

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Matriz cargo × sucursal
            </span>
            <h2 className="mt-1 text-lg font-bold text-primary-900">
              Puntos no cumplidos acumulados
            </h2>
            <p className="text-sm text-slate-500">
              Tocá una celda para ver los puntos concretos de ese cargo en esa sucursal.
            </p>
            {seguimiento && seguimiento.filas.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-slate-50" /> sin puntos
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-green-50" /> bajo
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-amber-100" /> medio
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-red-100" /> alto
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-red-700" /> crítico
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  {filas.length}
                  {busqueda.trim() ? ` de ${seguimiento.filas.length}` : ''} cargos ·{' '}
                  {unidades.length} sucursales
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Buscar cargo" className="w-56">
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Ej.: Depositaría"
              />
            </Field>
            <Field label="Ordenar" className="w-52">
              <Select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
                <option value="puntos">Puntos acumulados</option>
                <option value="cobertura">Sucursales alcanzadas</option>
                <option value="nombre">Cargo (A-Z)</option>
              </Select>
            </Field>
          </div>
        </div>

        {cargando ? (
          <div className="mt-4">
            <SkeletonFilas n={8} />
          </div>
        ) : error ? (
          <div className="mt-4">
            <EmptyState
              title="No se pudieron cargar los datos"
              subtitle="No se muestran ceros porque no se sabe si los hay: volvé a intentar."
            />
            <Button className="mt-3" variant="secondary" onClick={onReintentar}>
              Reintentar
            </Button>
          </div>
        ) : !seguimiento || !seguimiento.filas.length ? (
          <div className="mt-4">
            <EmptyState
              title="Todavía no hay puntos sin cumplir"
              subtitle="Cuando se cierre alguna evaluación con ítems asignados a cargos, van a aparecer acá, acumulados por sucursal."
            />
          </div>
        ) : !filas.length ? (
          <div className="mt-4">
            <EmptyState
              title="Ningún cargo coincide con la búsqueda"
              subtitle={`«${busqueda}» no está en los ${seguimiento.filas.length} cargos con hallazgos.`}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-1">
              <caption className="sr-only">
                Puntos no cumplidos acumulados por cargo y sucursal. El total de la fila se abre en
                detalle.
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 min-w-[210px] bg-white px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Cargo
                  </th>
                  {unidades.map((u) => (
                    <th
                      key={u.id}
                      scope="col"
                      className="min-w-[78px] rounded-lg bg-primary-900 px-2 py-2 text-center align-bottom"
                    >
                      <span
                        className="block truncate text-[10px] font-bold uppercase tracking-wider text-white"
                        title={u.nombre}
                      >
                        {u.nombre}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-white/70">
                        {totalesPorUnidad[u.id] ?? 0}
                      </span>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="min-w-[68px] rounded-lg bg-primary-100 px-2 py-2 text-center align-bottom text-[10px] font-bold uppercase tracking-wider text-primary-900"
                  >
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <Fragment key={f.clave}>
                    <tr>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-white px-3 py-2 text-left align-middle"
                      >
                        <span className="block text-sm font-semibold text-slate-900">
                          {f.cargo}
                        </span>
                        <span className="block text-xs font-normal text-slate-500">
                          {f.evaluaciones} {f.evaluaciones === 1 ? 'evaluación' : 'evaluaciones'} ·{' '}
                          {f.unidades} {f.unidades === 1 ? 'sucursal' : 'unidades'}
                          {f.ultima ? ` · última ${fechaCorta(f.ultima)}` : ''}
                        </span>
                      </th>
                      {unidades.map((u) => {
                        const p = f.porUnidad[u.id] ?? 0
                        const activa = sel?.clave === f.clave && sel.unidadId === u.id
                        if (!p) {
                          // Vacío no es un botón: con muchas sucursales serían
                          // cientos de tabulaciones para llegar a la única celda
                          // que importa.
                          return (
                            <td key={u.id} className="p-0">
                              <span className="flex items-center justify-center rounded-lg bg-slate-50 px-2 py-3 text-sm font-medium text-slate-500">
                                <span aria-hidden>—</span>
                                <span className="sr-only">
                                  {f.cargo} en {u.nombre}: sin puntos sin cumplir
                                </span>
                              </span>
                            </td>
                          )
                        }
                        return (
                          <td key={u.id} className="p-0">
                            <button
                              type="button"
                              onClick={() =>
                                setSel({
                                  clave: f.clave,
                                  cargo: f.cargo,
                                  unidadId: u.id,
                                  unidadNombre: u.nombre
                                })
                              }
                              aria-pressed={activa}
                              aria-label={`${f.cargo} en ${u.nombre}: ${p} puntos sin cumplir. Ver detalle.`}
                              className={cn(
                                'flex w-full items-center justify-center rounded-lg border-2 px-2 py-3 text-sm font-black tabular-nums transition-colors',
                                bandaCelda(p, maxCelda),
                                activa
                                  ? 'border-primary'
                                  : 'border-transparent hover:border-slate-300'
                              )}
                            >
                              {p}
                            </button>
                          </td>
                        )
                      })}
                      <td className="p-0">
                        <button
                          type="button"
                          onClick={() => setSel({ clave: f.clave, cargo: f.cargo })}
                          aria-pressed={sel?.clave === f.clave && !sel.unidadId}
                          aria-label={`${f.cargo}: ${f.puntos} puntos sin cumplir en todas las unidades. Ver detalle.`}
                          className={cn(
                            'flex w-full items-center justify-center rounded-lg border-2 px-2 py-3 text-sm font-black tabular-nums transition-colors',
                            sel?.clave === f.clave && !sel.unidadId
                              ? 'border-primary bg-primary-100 text-primary-900'
                              : 'border-transparent bg-primary-50 text-primary-900 hover:border-slate-300'
                          )}
                        >
                          {f.puntos}
                        </button>
                      </td>
                    </tr>

                    {/* El detalle se abre DENTRO de la tabla, justo debajo de la
                        fila del cargo elegido: si viviera en un card aparte al
                        final de la página, el usuario tendría que ir a buscarlo
                        y perdería de vista la matriz que lo seleccionó. */}
                    {sel?.clave === f.clave && (
                      <tr>
                        <td colSpan={unidades.length + 2} className="p-0">
                          <DetalleCargo
                            cargo={sel.cargo}
                            alcance={sel.unidadNombre}
                            hallazgos={hallazgos}
                            grupos={grupos}
                            porModulo={porModulo}
                            visibles={visibles}
                            onVerMas={() => setVisibles((v) => v + 40)}
                            onCerrar={() => setSel(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Total por sucursal
                  </th>
                  {unidades.map((u) => (
                    <td
                      key={u.id}
                      className="rounded-lg bg-primary-50 px-2 py-2 text-center text-sm font-black tabular-nums text-primary-900"
                    >
                      {totalesPorUnidad[u.id] ?? 0}
                    </td>
                  ))}
                  <td className="rounded-lg bg-primary-100 px-2 py-2 text-center text-sm font-black tabular-nums text-primary-900">
                    {total}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

interface DetalleCargoProps {
  cargo: string
  /** Sucursal concreta si se pulsó una celda; vacío si se pulsó el total de la fila. */
  alcance?: string
  hallazgos: HallazgoResponsable[]
  /** Subtotales por módulo sobre TODOS los hallazgos, no sobre los visibles. */
  grupos: { modulo: string; puntos: number }[]
  porModulo: Map<string, HallazgoResponsable[]>
  visibles: number
  onVerMas: () => void
  onCerrar: () => void
}

/**
 * El panel que se despliega bajo la fila del cargo elegido.
 *
 * Va en un panel tonal y no en blanco: adentro del `<td>` de una tabla que ya
 * está sobre una card blanca, el blanco no dibuja nada y el detalle se confundiría
 * con el resto de la matriz. Al ser `bg-slate-50` el panel se lee como una
 * capa de abajo, que es exactamente lo que es.
 */
export function DetalleCargo({
  cargo,
  alcance,
  hallazgos,
  grupos,
  porModulo,
  visibles,
  onVerMas,
  onCerrar
}: DetalleCargoProps) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Detalle del cargo
          </span>
          <h3 className="mt-1 text-base font-bold text-primary-900">{cargo}</h3>
          <p className="text-sm text-slate-600">
            <strong className="text-red-600">{hallazgos.length}</strong>{' '}
            {hallazgos.length === 1 ? 'punto sin cumplir' : 'puntos sin cumplir'}
            {alcance ? (
              <>
                {' '}
                en <strong>{alcance}</strong>
              </>
            ) : (
              ' en todas las unidades'
            )}
          </p>
        </div>
        <Button variant="ghost" onClick={onCerrar}>
          <X className="h-4 w-4" />
          Cerrar detalle
        </Button>
      </div>

      {hallazgos.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Sin hallazgos en este alcance: probá con otra sucursal de la matriz.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {grupos.map((g) => (
            <section key={g.modulo}>
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                  {g.modulo}
                </span>
                <span className="text-xs font-bold tabular-nums text-slate-600">
                  {g.puntos} pts
                </span>
              </div>
              <ul>
                {(porModulo.get(g.modulo) ?? []).map((h, i) => (
                  <li
                    key={`${h.evaluacion_id}-${i}`}
                    className="flex items-start justify-between gap-4 border-b border-slate-200 py-2.5 last:border-b-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{h.item}</p>
                      <p className="text-xs text-slate-500">
                        {h.unidad} · {fechaCorta(h.fecha)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold tabular-nums text-red-700">
                      {h.puntos} pts
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {hallazgos.length > visibles && (
            <button
              type="button"
              onClick={onVerMas}
              className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50"
            >
              Ver más ({hallazgos.length - visibles} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function Responsables() {
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [recargar, setRecargar] = useState(0)

  useEffect(() => {
    let activo = true
    setCargando(true)
    setError(false)
    void (async () => {
      try {
        // Sin recorte de fechas: el seguimiento es histórico. Sólo cerradas,
        // por el mismo motivo que en Indicadores — una evaluación abierta tiene
        // las respuestas a medias y sus puntos son un borrador, no un resultado.
        const d = await consultarEvaluaciones({ sucursal_ids: null, soloCerradas: true })
        if (activo) setDatos(d)
      } catch {
        // No se deja `datos` como lista vacía: eso se renderiza como «no hay
        // puntos sin cumplir», que es un falso cuando lo que falló fue la red.
        if (activo) {
          setDatos(null)
          setError(true)
        }
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => {
      activo = false
    }
  }, [recargar])

  const seguimiento = useMemo(() => (datos ? seguimientoResponsables(datos) : null), [datos])
  // Cargos configurados (con al menos un punto posible en la ponderación): de
  // aquí sale «cuántos cargos no tienen NINGÚN hallazgo», el dato que sólo se
  // puede saber con el universo completo, no sólo con los que fallaron.
  const cargosConfigurados = useMemo(
    () => (datos ? valorPorResponsable(datos.items).filter((v) => v.posible > 0).length : 0),
    [datos]
  )

  // La franja azul (BarraKpis) muestra los KPIs de esta pantalla en vez de los
  // globales, igual que Indicadores y el dashboard de módulo.
  const kpis = useMemo<EstadoKpis | null>(() => {
    if (!seguimiento) return null
    const puntos = seguimiento.filas.reduce((a, f) => a + f.puntos, 0)
    return {
      global: null,
      completadas: datos?.evaluaciones.length ?? 0,
      cobertura: 0,
      incumplimientos: puntos,
      items: [
        { etiqueta: 'Puntos no cumplidos', valor: puntos, icono: 'alerta' },
        { etiqueta: 'Cargos con desvío', valor: seguimiento.filas.length, icono: 'lista' },
        { etiqueta: 'Sucursales con desvío', valor: seguimiento.unidades.length, icono: 'store' },
        {
          etiqueta: 'Cargos sin hallazgos',
          valor: Math.max(0, cargosConfigurados - seguimiento.filas.length),
          icono: 'check'
        }
      ]
    }
  }, [datos, seguimiento, cargosConfigurados])

  useEffect(() => {
    setKpisGlobal(kpis)
  }, [kpis])

  return (
    <SeguimientoVista
      datos={datos}
      cargando={cargando}
      error={error}
      onReintentar={() => setRecargar((n) => n + 1)}
      seguimiento={seguimiento}
    />
  )
}

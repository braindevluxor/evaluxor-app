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
  notaDe,
  resumirFallasPorItem,
  seguimientoResponsables,
  type ConjuntoDatos,
  type ResumenItemFalla,
  type SeguimientoResponsables
} from '../../lib/data/indicadores'
import { claveNormalizada } from '../../lib/data/responsables'
import { setKpisGlobal, type EstadoKpis } from '../../lib/kpisGlobal'

/**
 * SEGUIMIENTO POR CARGO
 * ---------------------
 * Responde a dos preguntas que hasta ahora sólo se podían contestar evaluación
 * por evaluación: «¿qué cargo está sacando peor nota?» y «¿en qué sucursal se
 * le va?».
 *
 * La matriz muestra el PROMEDIO PORCENTUAL de la nota de cada cargo —logrado
 * sobre posible, ponderado con los mismos pesos que usa el resto de la app— y
 * no el conteo de incidencias: a un gerente le sirve «87%» antes que «14
 * puntos», porque el número ya viene comparado con lo que había que hacer. Las
 * incidencias no desaparecen, quedan para el detalle: al pulsar una celda se
 * abre la lista concreta de qué le está quitando nota en ese cargo.
 *
 * Es una superficie NUEVA del dashboard, no una variante de Indicadores: esa
 * pantalla mide unidades (sucursales, módulos), ésta mide responsables.
 *
 * Visible sólo para el LÍDER: un gerente de sucursal no tiene por qué leer el
 * ranking de cargos de las tiendas ajenas.
 */

type Orden = 'nota' | 'nombre' | 'cobertura'

/** `2025-03-08` → `8/3/2025`. La fecha llega como string ISO desde Postgres. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-')
  if (!a || !m || !d) return iso
  return `${Number(d)}/${Number(m)}/${a}`
}

/**
 * `87` → `87%`; sin nota, un guion largo. Nunca `0%`: eso sería decir «sacó
 * cero» de un cargo al que no se le midió nada, que es un dato distinto y
 * bastante más grave.
 */
function pct(nota: number | null): string {
  return nota == null ? '—' : `${nota}%`
}

/**
 * `1` → «vez», cualquier otra cosa → «veces». Es un detalle mínimo, pero
 * «1 veces» es la clase de cosa que hace notar que el texto lo escribió una
 * máquina y no una persona.
 */
function veces(n: number): string {
  return n === 1 ? 'vez' : 'veces'
}

/**
 * Las bandas son absolutas y no relativas al pico de la matriz. Eso se
 * resolvía escalando contra lo peor de la tabla cuando la escala eran PUNTOS,
 * porque «lo peor de hoy» no tenía número propio: dependía de cuánto hubiera
 * pasado. Un porcentaje sí lo tiene. 79% es malo el día que el resto esté en
 * 95 y también el día que esté en 60; pintarlo de verde porque sea el mejor de
 * la tabla sería mentirle al Líder justo cuando peor está.
 *
 * Sólo la celda más baja de la matriz —y sólo si de verdad está por debajo de
 * 80— sube a rojo sólido: es el ancla, el lugar adonde mirar primero.
 */
function bandaCelda(nota: number | null, peor: number | null): string {
  if (nota == null) return 'bg-slate-50 text-slate-500'
  if (nota >= 90) return 'bg-green-50 text-green-700'
  if (nota >= 80) return 'bg-amber-100 text-amber-800'
  if (nota === peor) return 'bg-red-700 text-white'
  return 'bg-red-100 text-red-700'
}

/**
 * El color del texto de la nota, para el detalle que se abre bajo la fila.
 * Sin el rojo sólido: ese recurso es de la celda ancla y usarlo dos veces en
 * la misma pantalla los diluye.
 */
function textoNota(nota: number | null): string {
  if (nota == null) return 'text-slate-500'
  if (nota >= 90) return 'text-green-700'
  if (nota >= 80) return 'text-amber-700'
  return 'text-red-700'
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
  const [orden, setOrden] = useState<Orden>('nota')
  const [sel, setSel] = useState<Seleccion | null>(null)
  const [visibles, setVisibles] = useState(40)

  // El detalle se recalcula al cambiar de celda y el tope de filas vuelve a 40:
  // si no, abrir un cargo chico dejaba la lista scrolleada a mitad de camino.
  useEffect(() => {
    setVisibles(40)
  }, [sel])

  // Memoizado: un `[]` nuevo en cada render re-dispara los useMemo que dependen
  // de las columnas (los totales por unidad y la celda ancla de la escala).
  const unidades = useMemo(() => seguimiento?.unidades ?? [], [seguimiento])

  const filas = useMemo(() => {
    if (!seguimiento) return []
    const q = claveNormalizada(busqueda.trim())
    const base = q ? seguimiento.filas.filter((f) => f.clave.includes(q)) : [...seguimiento.filas]
    // 'nota' ya viene ordenado desde la capa de datos (lo peor primero, sin
    // nota al final); sólo los otros dos órdenes reordenan.
    if (orden === 'nombre') base.sort((a, b) => a.cargo.localeCompare(b.cargo, 'es'))
    if (orden === 'cobertura')
      base.sort((a, b) => b.unidades - a.unidades || b.puntos - a.puntos || a.cargo.localeCompare(b.cargo, 'es'))
    return base
  }, [seguimiento, busqueda, orden])

  // La celda ancla: la nota más baja de lo que se está mirando. Se calcula sobre
  // las filas visibles para que, con una búsqueda activa, el rojo sólido caiga
  // en lo peor de lo que el Líder está viendo y no de la matriz entera.
  const peor = useMemo(() => {
    let m: number | null = null
    for (const f of filas) {
      for (const u of unidades) {
        const c = f.porUnidad[u.id]
        if (!c) continue
        const n = notaDe(c.logrado, c.posible)
        if (n == null) continue
        if (m == null || n < m) m = n
      }
    }
    return m
  }, [filas, unidades])

  // Las notas por columna salen de las filas VISIBLES: con una búsqueda activa
  // el pie tiene que cerrar contra las celdas de arriba. Se ponderan logrado y
  // posible por separado —no se promedian los porcentajes— por el mismo motivo
  // que en la capa de datos: una sucursal con un solo ítem pesaría igual que
  // otra con cuarenta.
  const totalesPorUnidad = useMemo<Record<string, number | null>>(() => {
    const acum: Record<string, { logrado: number; posible: number }> = {}
    for (const f of filas) {
      for (const u of unidades) {
        const c = f.porUnidad[u.id]
        if (!c) continue
        const t = acum[u.id] ?? { logrado: 0, posible: 0 }
        t.logrado += c.logrado
        t.posible += c.posible
        acum[u.id] = t
      }
    }
    const out: Record<string, number | null> = {}
    for (const id of Object.keys(acum)) {
      const t = acum[id]
      out[id] = notaDe(t.logrado, t.posible)
    }
    return out
  }, [filas, unidades])

  const notaTotal = useMemo(() => {
    let logrado = 0
    let posible = 0
    for (const f of filas) {
      logrado += f.logrado
      posible += f.posible
    }
    return notaDe(logrado, posible)
  }, [filas])

  // La nota de lo que se pulsó: la de la celda si se eligió una sucursal, la
  // de la fila entera si se eligió el total. El detalle la repite arriba para
  // que no haya que volver a la matriz para saber qué número se está mirando.
  const notaSeleccion = useMemo(() => {
    if (!sel) return null
    const f = filas.find((x) => x.clave === sel.clave)
    if (!f) return null
    if (!sel.unidadId) return f.nota
    const c = f.porUnidad[sel.unidadId]
    return c ? notaDe(c.logrado, c.posible) : null
  }, [sel, filas])

  const hallazgos = useMemo(
    () => (datos && sel ? hallazgosDeCargo(datos, sel.clave, sel.unidadId) : []),
    [datos, sel]
  )
  // Un renglón por ítem, no uno por evaluación: con un histórico largo la lista
  // cruda son cientos de líneas y nadie cuenta a mano cuántas veces se cayó lo
  // mismo.
  const itemsFalla = useMemo(() => resumirFallasPorItem(hallazgos), [hallazgos])
  const vecesTotal = useMemo(() => itemsFalla.reduce((a, f) => a + f.veces, 0), [itemsFalla])

  // El subtotal de cada módulo se calcula sobre TODOS los ítems: la lista se
  // corta en 40 para no renderizar miles de renglones, pero el número del
  // encabezado tiene que decir cuántas veces se cayó ese módulo, no cuántas de
  // las que por ahora se están mostrando.
  const grupos = useMemo(() => {
    const mapa = new Map<string, { modulo: string; veces: number }>()
    for (const f of itemsFalla) {
      const g = mapa.get(f.modulo) ?? { modulo: f.modulo, veces: 0 }
      g.veces += f.veces
      mapa.set(f.modulo, g)
    }
    return Array.from(mapa.values()).sort((a, b) => b.veces - a.veces)
  }, [itemsFalla])

  const porModulo = useMemo(() => {
    const mapa = new Map<string, ResumenItemFalla[]>()
    for (const f of itemsFalla.slice(0, visibles)) {
      const arr = mapa.get(f.modulo) ?? []
      arr.push(f)
      mapa.set(f.modulo, arr)
    }
    return mapa
  }, [itemsFalla, visibles])

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Matriz cargo × sucursal
            </span>
            <h2 className="mt-1 text-lg font-bold text-primary-900">Nota promedio por cargo</h2>
            <p className="text-sm text-slate-500">
              Tocá una celda para ver qué le está quitando nota a ese cargo en esa sucursal.
            </p>
            {seguimiento && seguimiento.filas.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-slate-50" /> sin nota
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-green-50" /> 90% o más
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-amber-100" /> 80–89%
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-red-100" /> menos de 80%
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-red-700" /> la peor celda
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
                <option value="nota">Nota más baja</option>
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
              title="Todavía no hay notas por cargo"
              subtitle="Cuando se cierre alguna evaluación con ítems asignados a cargos, van a aparecer acá, con su nota por sucursal."
            />
          </div>
        ) : !filas.length ? (
          <div className="mt-4">
            <EmptyState
              title="Ningún cargo coincide con la búsqueda"
              subtitle={`«${busqueda}» no está en los ${seguimiento.filas.length} cargos evaluados.`}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-1">
              <caption className="sr-only">
                Nota promedio de cada cargo por sucursal, en porcentaje. El total de la fila se
                abre en detalle.
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
                        {pct(totalesPorUnidad[u.id] ?? null)}
                      </span>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="min-w-[68px] rounded-lg bg-primary-100 px-2 py-2 text-center align-bottom text-[10px] font-bold uppercase tracking-wider text-primary-900"
                  >
                    Nota total
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
                        const celda = f.porUnidad[u.id]
                        const n = celda ? notaDe(celda.logrado, celda.posible) : null
                        const activa = sel?.clave === f.clave && sel.unidadId === u.id
                        if (n == null) {
                          // Sin nota no es un botón: con muchas sucursales serían
                          // cientos de tabulaciones para atravesar columnas donde
                          // no hay nada que abrir.
                          return (
                            <td key={u.id} className="p-0">
                              <span className="flex items-center justify-center rounded-lg bg-slate-50 px-2 py-3 text-sm font-medium text-slate-500">
                                <span aria-hidden>—</span>
                                <span className="sr-only">
                                  {f.cargo} en {u.nombre}: sin nota, no se lo evaluó
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
                              aria-label={`${f.cargo} en ${u.nombre}: nota ${n}%. Ver detalle.`}
                              className={cn(
                                'flex w-full items-center justify-center rounded-lg border-2 px-2 py-3 text-sm font-black tabular-nums transition-colors',
                                bandaCelda(n, peor),
                                activa
                                  ? 'border-primary'
                                  : 'border-transparent hover:border-slate-300'
                              )}
                            >
                              {n}%
                            </button>
                          </td>
                        )
                      })}
                      <td className="p-0">
                        <button
                          type="button"
                          onClick={() => setSel({ clave: f.clave, cargo: f.cargo })}
                          aria-pressed={sel?.clave === f.clave && !sel.unidadId}
                          aria-label={
                            f.nota == null
                              ? `${f.cargo}: sin nota, nunca se lo evaluó. Ver detalle de sus puntos.`
                              : `${f.cargo}: nota ${f.nota}% en todas las unidades. Ver detalle.`
                          }
                          className={cn(
                            'flex w-full items-center justify-center rounded-lg border-2 px-2 py-3 text-sm font-black tabular-nums transition-colors',
                            sel?.clave === f.clave && !sel.unidadId
                              ? 'border-primary bg-primary-100 text-primary-900'
                              : 'border-transparent bg-primary-50 text-primary-900 hover:border-slate-300'
                          )}
                        >
                          {pct(f.nota)}
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
                            nota={notaSeleccion}
                            items={itemsFalla}
                            vecesTotal={vecesTotal}
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
                    Nota por sucursal
                  </th>
                  {unidades.map((u) => (
                    <td
                      key={u.id}
                      className="rounded-lg bg-primary-50 px-2 py-2 text-center text-sm font-black tabular-nums text-primary-900"
                    >
                      {pct(totalesPorUnidad[u.id] ?? null)}
                    </td>
                  ))}
                  <td className="rounded-lg bg-primary-100 px-2 py-2 text-center text-sm font-black tabular-nums text-primary-900">
                    {pct(notaTotal)}
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
  /** La nota de lo que se pulsó: la de la celda o la de la fila entera. */
  nota: number | null
  /** Los ítems en los que le falló: uno por ítem, con sus checks y sus veces. */
  items: ResumenItemFalla[]
  /** Veces sin cumplir en todos los ítems juntos, para el subtítulo del panel. */
  vecesTotal: number
  /** Subtotales por módulo sobre TODOS los ítems, no sobre los visibles. */
  grupos: { modulo: string; veces: number }[]
  porModulo: Map<string, ResumenItemFalla[]>
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
  nota,
  items,
  vecesTotal,
  grupos,
  porModulo,
  visibles,
  onVerMas,
  onCerrar
}: DetalleCargoProps) {
  /**
   * Dónde y cuándo pasó. Con una celda pulsada la sucursal ya está en el título
   * del panel, así que repetirla en cada renglón sería ruido: allí sólo hace
   * falta la fecha.
   */
  const donde = (f: ResumenItemFalla): string => {
    const ultima = f.ultima ? fechaCorta(f.ultima) : 'sin fecha'
    if (alcance) return `Última vez: ${ultima}`
    const porUnidad = f.unidades.map((u) => `${u.nombre} (${u.veces})`).join(' · ')
    return `${porUnidad} · última ${ultima}`
  }

  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Detalle del cargo
          </span>
          <h3 className="mt-1 text-base font-bold text-primary-900">{cargo}</h3>
          <p className="text-sm text-slate-600">
            <strong className={cn('font-black', textoNota(nota))}>
              {nota == null ? 'Sin nota' : `${nota}% de nota`}
            </strong>
            {alcance ? (
              <>
                {' '}
                en <strong>{alcance}</strong>
              </>
            ) : (
              ' en todas las unidades'
            )}
            {' · '}
            <strong className="text-red-600">{items.length}</strong>{' '}
            {items.length === 1 ? 'ítem sin cumplir' : 'ítems sin cumplir'}
            {' · '}
            <strong className="text-red-600">{vecesTotal}</strong> {veces(vecesTotal)} sin cumplir
          </p>
        </div>
        <Button variant="ghost" onClick={onCerrar}>
          <X className="h-4 w-4" />
          Cerrar detalle
        </Button>
      </div>

      {items.length === 0 ? (
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
                  {g.veces} {veces(g.veces)} sin cumplir
                </span>
              </div>
              <ul>
                {(porModulo.get(g.modulo) ?? []).map((f) => (
                  <li
                    key={f.item_id}
                    className="flex items-start justify-between gap-4 border-b border-slate-200 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{f.item}</p>
                      {/*
                        Los checks concretos: es la única respuesta posible a
                        «¿en qué le falló?». Decir «Checklist de higiene — 3» no
                        dice nada; «sin EPP completo — 3 veces» sí.
                      */}
                      {f.checks.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {f.checks.map((c) => (
                            <li key={c.texto} className="flex gap-1.5 text-xs text-slate-600">
                              <span aria-hidden>·</span>
                              <span className="min-w-0">
                                <span className="font-semibold text-slate-700">{c.texto}</span>
                                <span className="text-slate-500">
                                  {' — '}
                                  {c.veces} {veces(c.veces)} sin cumplir
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-slate-500">{donde(f)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold tabular-nums text-red-700">
                      {f.veces} {veces(f.veces)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {items.length > visibles && (
            <button
              type="button"
              onClick={onVerMas}
              className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50"
            >
              Ver más ({items.length - visibles} restantes)
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
        // No se deja `datos` como lista vacía: eso se renderiza como «todavía no
        // hay notas por cargo», que es un falso cuando lo que falló fue la red.
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

  // La franja azul (BarraKpis) muestra los KPIs de esta pantalla en vez de los
  // globales, igual que Indicadores y el dashboard de módulo. El primero es la
  // nota global PONDERADA —logrado sobre posible de todo junto— y no el
  // promedio de las notas de las filas: un cargo evaluado en una sola sucursal
  // con un solo ítem pesaría lo mismo que otro con 40 ítems en 12 tiendas, y el
  // número no cerraría con la matriz.
  const kpis = useMemo<EstadoKpis | null>(() => {
    if (!seguimiento) return null
    const sinHallazgos = seguimiento.filas.filter((f) => f.puntos === 0).length
    return {
      global: null,
      completadas: datos?.evaluaciones.length ?? 0,
      cobertura: 0,
      incumplimientos: seguimiento.puntos,
      items: [
        { etiqueta: 'Nota promedio', valor: seguimiento.nota, sufijo: '%', icono: 'target' },
        { etiqueta: 'Cargos evaluados', valor: seguimiento.filas.length, icono: 'lista' },
        { etiqueta: 'Sucursales con datos', valor: seguimiento.unidades.length, icono: 'store' },
        { etiqueta: 'Cargos sin hallazgos', valor: sinHallazgos, icono: 'check' }
      ]
    }
  }, [datos, seguimiento])

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

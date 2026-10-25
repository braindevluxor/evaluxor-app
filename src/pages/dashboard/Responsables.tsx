import { Fragment, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
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
import {
  UMBRAL_AMONESTACION,
  UMBRAL_LLAMADO,
  filasDeAlertas,
  listarAlertas,
  mapaDeAlertas,
  marcarAtendida,
  nivelDeNota,
  registrarAlerta,
  type AlertaAARegistrar,
  type AlertaCargo,
  type FilaAlerta,
  type NivelAlerta
} from '../../lib/data/alertasCargo'
import { claveNormalizada } from '../../lib/data/responsables'
import { avisar } from '../../lib/aviso'
import { useAuth } from '../../context/AuthContext'
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
 * Sobre eso corre ALERTAS: por debajo de 80% la celda pide amonestación y por
 * debajo de 70% llamado de atención (los mismos cortes que pintan el rojo). El
 * Líder las registra —quedan PENDIENTES— y después las atiende con fecha y
 * nombre; el panel de abajo es el listado de seguimiento, agrupado por unidad.
 * El nivel se calcula siempre desde la matriz; el registro es lo que se decidió
 * hacer y persiste en `alertas_cargo`.
 *
 * Es una superficie NUEVA del dashboard, no una variante de Indicadores: esa
 * pantalla mide unidades (sucursales, módulos), ésta mide responsables.
 *
 * Visible sólo para el LÍDER: un gerente de sucursal no tiene por qué leer el
 * ranking de cargos de las tiendas ajenas.
 */

type Orden = 'nota' | 'nombre' | 'cobertura'

const ETIQUETA_NIVEL: Record<NivelAlerta, string> = {
  AMONESTACION: 'Amonestación',
  LLAMADO: 'Llamado de atención'
}

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
 * Las bandas SON los umbrales de las alertas: el color de la celda y el nivel
 * que se le pide al cargo son la misma regla, y decir dos cosas distintas con
 * el mismo número sería mentirle al Líder en la pantalla justa.
 *
 * Son absolutas y no relativas al pico de la matriz. Eso se resolvía escalando
 * contra lo peor de la tabla cuando la escala eran PUNTOS, porque «lo peor de
 * hoy» no tenía número propio: dependía de cuánto hubiera pasado. Un porcentaje
 * sí lo tiene. 79% es malo el día que el resto esté en 95 y también el día que
 * esté en 60; pintarlo de verde porque sea el mejor de la tabla sería mentirle
 * al Líder justo cuando peor está.
 *
 * El rojo sólido quedó reservado para el llamado de atención (lo más grave):
 * antes lo usaba «la celda más baja», que era un ancla relativa y con el
 * nivel ya no hacía falta.
 */
function bandaCelda(nota: number | null): string {
  if (nota == null) return 'bg-slate-50 text-slate-500'
  if (nota >= 90) return 'bg-green-50 text-green-700'
  if (nota >= UMBRAL_AMONESTACION) return 'bg-amber-100 text-amber-800'
  if (nota >= UMBRAL_LLAMADO) return 'bg-red-100 text-red-700'
  return 'bg-red-700 text-white'
}

/**
 * El color del texto de la nota, para el detalle que se abre bajo la fila.
 */
function textoNota(nota: number | null): string {
  if (nota == null) return 'text-slate-500'
  if (nota >= 90) return 'text-green-700'
  if (nota >= UMBRAL_AMONESTACION) return 'text-amber-700'
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
  /**
   * Las alertas registradas. `null` = todavía no se cargaron (o fallaron): el
   * panel lo dice en vez de jurar que no hay alertas. Sin `onRegistrar` la
   * pantalla queda en modo sólo lectura: los chips y las filas se ven, los
   * botones no.
   */
  alertas?: AlertaCargo[] | null
  alertasCargando?: boolean
  alertasError?: boolean
  onReintentarAlertas?: () => void
  onRegistrar?: (a: AlertaAARegistrar) => void
  onAtender?: (id: string) => void
  /** Clave de la fila (o id de la alerta) con una acción en vuelo, para no apretar dos veces. */
  ocupado?: string | null
}

export function SeguimientoVista({
  datos,
  cargando,
  error,
  onReintentar,
  seguimiento,
  alertas,
  alertasCargando,
  alertasError,
  onReintentarAlertas,
  onRegistrar,
  onAtender,
  ocupado
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
  // de las columnas (los totales por unidad).
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

  const listaAlertas = useMemo(() => alertas ?? [], [alertas])
  const mapaAlertas = useMemo(() => mapaDeAlertas(listaAlertas), [listaAlertas])

  // El panel de seguimiento: cargo × unidad en nivel o con registro, lo peor
  // primero. Va aparte de la matriz porque es una lectura distinta: la matriz
  // muestra TODO lo medido, ésta sólo lo que está pidiendo atención.
  const filasAlerta = useMemo(
    () => (seguimiento ? filasDeAlertas(seguimiento, listaAlertas) : []),
    [seguimiento, listaAlertas]
  )

  // Nivel de lo que se pulsó: con la nota del alcance (celda o total). El
  // registro sólo existe con alcance de unidad —la alerta se guarda por
  // unidad—, así que desde el total de la fila no hay nada que atender.
  const nivelSeleccion = nivelDeNota(notaSeleccion)
  const registroSeleccion = useMemo(
    () => (sel?.unidadId ? mapaAlertas.get(`${sel.clave}|${sel.unidadId}`) ?? null : null),
    [sel, mapaAlertas]
  )
  const unidadSeleccion = useMemo(
    () => (sel?.unidadId ? unidades.find((u) => u.id === sel.unidadId) : undefined),
    [sel, unidades]
  )

  // Las acciones del detalle se arman acá: el panel de detalle no conoce la
  // clave ni el tipo de unidad, sólo qué tiene que hacer.
  const registrarSeleccion: (() => void) | undefined =
    onRegistrar && sel?.unidadId && unidadSeleccion && nivelSeleccion && notaSeleccion != null
      ? () =>
          onRegistrar({
            clave: sel.clave,
            cargo: sel.cargo,
            unidadId: sel.unidadId as string,
            unidadTipo: unidadSeleccion.tipo,
            nivel: nivelSeleccion,
            nota: notaSeleccion
          })
      : undefined
  const atenderSeleccion: (() => void) | undefined =
    onAtender && registroSeleccion?.estado === 'PENDIENTE'
      ? () => onAtender(registroSeleccion.id)
      : undefined
  const ocupadoSeleccion = registroSeleccion
    ? ocupado === registroSeleccion.id
    : ocupado === `${sel?.clave}|${sel?.unidadId}`

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
                  <span aria-hidden className="h-3 w-6 rounded bg-red-100" /> 70–79% · amonestación
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-6 rounded bg-red-700" /> menos de 70% · llamado
                  de atención
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
                        const nivel = nivelDeNota(n)
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
                              aria-label={`${f.cargo} en ${u.nombre}: nota ${n}%${
                                nivel ? `, ${ETIQUETA_NIVEL[nivel].toLowerCase()}` : ''
                              }. Ver detalle.`}
                              className={cn(
                                'flex w-full items-center justify-center rounded-lg border-2 px-2 py-3 text-sm font-black tabular-nums transition-colors',
                                bandaCelda(n),
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
                              : `${f.cargo}: nota ${f.nota}% en todas las unidades${
                                  nivelDeNota(f.nota)
                                    ? `, ${ETIQUETA_NIVEL[nivelDeNota(f.nota) as NivelAlerta].toLowerCase()}`
                                    : ''
                                }. Ver detalle.`
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
                            nivel={nivelSeleccion}
                            registro={registroSeleccion}
                            onRegistrar={registrarSeleccion}
                            onAtender={atenderSeleccion}
                            ocupado={ocupadoSeleccion}
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

      <PanelAlertas
        filas={filasAlerta}
        cargando={alertasCargando}
        error={alertasError}
        onReintentar={onReintentarAlertas}
        onRegistrar={onRegistrar}
        onAtender={onAtender}
        ocupado={ocupado}
      />
    </div>
  )
}

/**
 * El chip de nivel: lo que la nota está pidiendo AHORA, recién calculado desde
 * la matriz. No depende de ningún registro: es la regla (80% / 70%) aplicada
 * al número que se está mirando.
 */
export function ChipNivel({ nivel }: { nivel: NivelAlerta | null }) {
  if (!nivel) {
    return <span className="text-xs font-semibold text-slate-400">Sin alerta</span>
  }
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-1 text-[11px] font-bold',
        nivel === 'LLAMADO' ? 'bg-red-700 text-white' : 'bg-red-100 text-red-700'
      )}
    >
      {ETIQUETA_NIVEL[nivel]}
    </span>
  )
}

/**
 * El estado del registro: qué se hizo con la alerta. «Sin registrar» es el
 * estado de lo que todavía no pasó por la base, no un error: el nivel ya está
 * en la columna de al lado.
 */
export function ChipEstado({ registro }: { registro: AlertaCargo | null }) {
  if (!registro) {
    return (
      <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
        Sin registrar
      </span>
    )
  }
  if (registro.estado === 'PENDIENTE') {
    return (
      <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
        Pendiente
      </span>
    )
  }
  const fecha = registro.atendida_en ? fechaCorta(registro.atendida_en.slice(0, 10)) : ''
  const quien = registro.atendida?.nombre
  return (
    <span className="inline-block rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold text-green-800">
      {fecha ? `Atendida el ${fecha}` : 'Atendida'}
      {quien ? ` por ${quien}` : ''}
    </span>
  )
}

/**
 * La acción que corresponde en este momento, y ninguna cuando no la hay.
 *
 * Con una alerta pendiente manda atender —es lo que cierra el ciclo— aunque la
 * nota haya mejorado; sin pendiente y en nivel, registrar. Fuera de las dos,
 * no se pinta botón: no hay nada que hacer y un botón que no hace nada es
 * ruido en una pantalla de seguimiento.
 */
export function AccionAlerta({
  nivel,
  registro,
  onRegistrar,
  onAtender,
  ocupado,
  className
}: {
  nivel: NivelAlerta | null
  registro: AlertaCargo | null
  onRegistrar?: (() => void) | null
  onAtender?: (() => void) | null
  ocupado?: boolean
  className?: string
}) {
  if (registro?.estado === 'PENDIENTE' && onAtender) {
    return (
      <Button type="button" variant="secondary" className={className} disabled={ocupado} onClick={onAtender}>
        {ocupado ? 'Atendiendo…' : 'Marcar atendida'}
      </Button>
    )
  }
  if (nivel && onRegistrar) {
    return (
      <Button type="button" variant="primary" className={className} disabled={ocupado} onClick={onRegistrar}>
        {ocupado ? 'Registrando…' : `Registrar ${ETIQUETA_NIVEL[nivel].toLowerCase()}`}
      </Button>
    )
  }
  return null
}

interface DetalleCargoProps {
  cargo: string
  /** Sucursal concreta si se pulsó una celda; vacío si se pulsó el total de la fila. */
  alcance?: string
  /** La nota de lo que se pulsó: la de la celda o la de la fila entera. */
  nota: number | null
  /** El nivel que corresponde a esa nota: lo que la celda está pidiendo. */
  nivel?: NivelAlerta | null
  /** El registro persistido de esa celda (sólo con alcance de unidad). */
  registro?: AlertaCargo | null
  /** Registrar la alerta de esta celda: sin unidad no hay a qué registro. */
  onRegistrar?: (() => void) | null
  onAtender?: (() => void) | null
  ocupado?: boolean
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
  nivel,
  registro,
  onRegistrar,
  onAtender,
  ocupado,
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
          {/* La alerta de esta celda: nivel (lo que pide hoy), estado (lo que
              se hizo) y la acción que corresponde. Sólo hay acción con alcance
              de unidad —la alerta se guarda por sucursal o departamento—, así
              que desde el total de la fila el detalle informa y el panel de
              abajo es donde se actúa. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ChipNivel nivel={nivel ?? null} />
            <ChipEstado registro={registro ?? null} />
            <AccionAlerta
              nivel={nivel ?? null}
              registro={registro ?? null}
              onRegistrar={onRegistrar}
              onAtender={onAtender}
              ocupado={ocupado}
            />
          </div>
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

interface PanelAlertasProps {
  filas: FilaAlerta[]
  cargando?: boolean
  /** La consulta falló: decir «sin alertas» sería un falso. */
  error?: boolean
  onReintentar?: () => void
  onRegistrar?: (a: AlertaAARegistrar) => void
  onAtender?: (id: string) => void
  ocupado?: string | null
}

/**
 * El listado de seguimiento: los cargos × unidad que están en nivel o ya
 * tienen alerta registrada, lo peor primero.
 *
 * Va en su propia card y debajo de la matriz porque responde otra pregunta: la
 * matriz dice «cómo está todo», ésta dice «qué hay que hacer». Por eso se
 * puede filtrar por unidad y por estado, y por eso las filas que exigirían
 * atención (nivel sin registrar, alerta pendiente) se distinguen de un vistazo
 * sin recorrer la matriz celda por celda.
 */
export function PanelAlertas({
  filas,
  cargando,
  error,
  onReintentar,
  onRegistrar,
  onAtender,
  ocupado
}: PanelAlertasProps) {
  const [unidad, setUnidad] = useState('todas')
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [visibles, setVisibles] = useState(40)

  const unidades = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const f of filas) if (!mapa.has(f.unidadId)) mapa.set(f.unidadId, f.unidadNombre)
    return Array.from(mapa.entries())
  }, [filas])

  const pendientes = filas.filter((f) => f.registro?.estado === 'PENDIENTE').length
  const sinRegistrar = filas.filter((f) => !f.registro && f.nivel != null).length
  const atendidas = filas.filter((f) => f.registro?.estado === 'ATENDIDA').length

  const filtradas = useMemo(
    () =>
      filas.filter((f) => {
        if (unidad !== 'todas' && f.unidadId !== unidad) return false
        if (estadoFiltro === 'pendientes') return f.registro?.estado === 'PENDIENTE'
        if (estadoFiltro === 'sin_registrar') return !f.registro && f.nivel != null
        if (estadoFiltro === 'atendidas') return f.registro?.estado === 'ATENDIDA'
        return true
      }),
    [filas, unidad, estadoFiltro]
  )

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Seguimiento por unidad
          </span>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-primary-900">
            <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
            Alertas de seguimiento
          </h2>
          <p className="text-sm text-slate-500">
            Por debajo de {UMBRAL_AMONESTACION}% el cargo queda en amonestación; por debajo de{' '}
            {UMBRAL_LLAMADO}%, en llamado de atención. Registrá la alerta y marcala atendida cuando
            se hable con el cargo.
          </p>
          {filas.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-red-100 px-3 py-1 font-bold text-red-700">
                {sinRegistrar} sin registrar
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-800">
                {pendientes} pendientes
              </span>
              <span className="rounded-full bg-green-100 px-3 py-1 font-bold text-green-800">
                {atendidas} atendidas
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Unidad" className="w-52">
            <Select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
              <option value="todas">Todas las unidades</option>
              {unidades.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado" className="w-48">
            <Select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
              <option value="todos">Todos</option>
              <option value="sin_registrar">Sin registrar ({sinRegistrar})</option>
              <option value="pendientes">Pendientes ({pendientes})</option>
              <option value="atendidas">Atendidas ({atendidas})</option>
            </Select>
          </Field>
        </div>
      </div>

      {cargando ? (
        <div className="mt-4">
          <SkeletonFilas n={4} />
        </div>
      ) : error ? (
        <div className="mt-4">
          <EmptyState
            title="No se pudieron cargar las alertas"
            subtitle="La matriz de arriba es confiable (sale de las evaluaciones), pero el estado de las alertas no se sabe: volvé a intentar."
          />
          {onReintentar && (
            <Button className="mt-3" variant="secondary" onClick={onReintentar}>
              Reintentar
            </Button>
          )}
        </div>
      ) : filas.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Ningún cargo está en alerta"
            subtitle={`Ninguna nota bajó de ${UMBRAL_AMONESTACION}% y no hay alertas registradas: el seguimiento empieza cuando una celda entre en rojo.`}
          />
        </div>
      ) : filtradas.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Nada coincide con el filtro"
            subtitle="Probá con otra unidad u otro estado."
          />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0">
            <caption className="sr-only">
              Cargos que requieren amonestación o llamado de atención, con su nota actual y el
              estado de su alerta, por unidad.
            </caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Unidad</th>
                <th scope="col" className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Cargo</th>
                <th scope="col" className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Nota</th>
                <th scope="col" className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Nivel</th>
                <th scope="col" className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Estado</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtradas.slice(0, visibles).map((f) => {
                const claveFila = `${f.clave}|${f.unidadId}`
                const ocupada =
                  ocupado === claveFila || (f.registro != null && ocupado === f.registro.id)
                // Capturado fuera del closure: TS no sigue el estrechamiento de
                // `f.registro?.estado` dentro de la flecha.
                const pendiente = f.registro?.estado === 'PENDIENTE' ? f.registro : null
                return (
                  <tr key={claveFila} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2.5 text-sm font-medium text-slate-600">{f.unidadNombre}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-slate-900">{f.cargo}</td>
                    <td className={cn('px-3 py-2.5 text-sm font-black tabular-nums', textoNota(f.nota))}>
                      {pct(f.nota)}
                    </td>
                    <td className="px-3 py-2.5">
                      <ChipNivel nivel={f.nivel} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ChipEstado registro={f.registro} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <AccionAlerta
                        nivel={f.nivel}
                        registro={f.registro}
                        ocupado={ocupada}
                        onRegistrar={
                          onRegistrar && f.nivel != null && f.nota != null
                            ? () =>
                                onRegistrar({
                                  clave: f.clave,
                                  cargo: f.cargo,
                                  unidadId: f.unidadId,
                                  unidadTipo: f.unidadTipo,
                                  nivel: f.nivel as NivelAlerta,
                                  nota: f.nota as number
                                })
                            : null
                        }
                        onAtender={onAtender && pendiente ? () => onAtender(pendiente.id) : null}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtradas.length > visibles && (
            <button
              type="button"
              onClick={() => setVisibles((v) => v + 40)}
              className="mt-3 w-full rounded-lg bg-slate-50 px-4 py-2.5 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50"
            >
              Ver más ({filtradas.length - visibles} restantes)
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

export function Responsables() {
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [recargar, setRecargar] = useState(0)

  // Las alertas van en su propio estado: si fallan, la matriz sigue siendo
  // confiable (sale de las evaluaciones cerradas) y sólo el panel de
  // seguimiento tiene que decir que no sabe. `null` = sin cargar todavía.
  const [alertas, setAlertas] = useState<AlertaCargo[] | null>(null)
  const [alertasError, setAlertasError] = useState(false)
  const [recargarAlertas, setRecargarAlertas] = useState(0)
  // La fila (o la alerta) con una acción en vuelo: sin esto se podía apretar
  // «Registrar» dos veces y crear dos alertas iguales en el peor de los casos.
  const [ocupado, setOcupado] = useState<string | null>(null)

  const { profile } = useAuth()

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

  useEffect(() => {
    let activo = true
    setAlertasError(false)
    void (async () => {
      try {
        const a = await listarAlertas()
        if (activo) setAlertas(a)
      } catch {
        // Igual que con los datos: `null` + error, no `[]`, para no jurar que
        // no hay alertas cuando lo que falló fue la red.
        if (activo) {
          setAlertas(null)
          setAlertasError(true)
        }
      }
    })()
    return () => {
      activo = false
    }
  }, [recargarAlertas])

  const recargarTodoAlertas = () => setRecargarAlertas((n) => n + 1)

  const registrar = (a: AlertaAARegistrar) => {
    const clave = `${a.clave}|${a.unidadId}`
    setOcupado(clave)
    void (async () => {
      try {
        await registrarAlerta(a)
        avisar(`Alerta registrada: ${a.cargo} · ${ETIQUETA_NIVEL[a.nivel]}.`)
      } catch {
        avisar('No se pudo registrar la alerta.', 'error')
      } finally {
        setOcupado(null)
        recargarTodoAlertas()
      }
    })()
  }

  const atender = (id: string) => {
    setOcupado(id)
    void (async () => {
      try {
        if (!profile) throw new Error('sin perfil')
        await marcarAtendida(id, profile.id)
        avisar('Alerta marcada como atendida.')
      } catch {
        avisar('No se pudo marcar la alerta como atendida.', 'error')
      } finally {
        setOcupado(null)
        recargarTodoAlertas()
      }
    })()
  }

  const seguimiento = useMemo(() => (datos ? seguimientoResponsables(datos) : null), [datos])

  // La franja azul (BarraKpis) muestra los KPIs de esta pantalla en vez de los
  // globales, igual que Indicadores y el dashboard de módulo. El primero es la
  // nota global PONDERADA —logrado sobre posible de todo junto— y no el
  // promedio de las notas de las filas: un cargo evaluado en una sola sucursal
  // con un solo ítem pesaría lo mismo que otro con 40 ítems en 12 tiendas, y el
  // número no cerraría con la matriz.
  const kpis = useMemo<EstadoKpis | null>(() => {
    if (!seguimiento) return null
    // Las pendientes salen de lo que se registró, no del nivel: el nivel es
    // un cálculo que ya está en la matriz y este KPI cuenta trabajo abierto.
    const pendientes = (alertas ?? []).filter((a) => a.estado === 'PENDIENTE').length
    return {
      global: null,
      completadas: datos?.evaluaciones.length ?? 0,
      cobertura: 0,
      incumplimientos: seguimiento.puntos,
      items: [
        { etiqueta: 'Nota promedio', valor: seguimiento.nota, sufijo: '%', icono: 'target' },
        { etiqueta: 'Cargos evaluados', valor: seguimiento.filas.length, icono: 'lista' },
        { etiqueta: 'Sucursales con datos', valor: seguimiento.unidades.length, icono: 'store' },
        { etiqueta: 'Alertas pendientes', valor: pendientes, icono: 'alerta' }
      ]
    }
  }, [datos, seguimiento, alertas])

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
      alertas={alertas}
      alertasCargando={alertas === null && !alertasError}
      alertasError={alertasError}
      onReintentarAlertas={recargarTodoAlertas}
      onRegistrar={registrar}
      onAtender={atender}
      ocupado={ocupado}
    />
  )
}

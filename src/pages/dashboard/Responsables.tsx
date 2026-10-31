import { useEffect, useMemo, useState } from 'react'
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
import { consultarEvaluaciones, type ConjuntoDatos } from '../../lib/data/indicadores'
import {
  puntosFalladosDeCargo,
  seguimientoPorEvaluacion,
  UMBRAL_AMONESTACION,
  UMBRAL_LLAMADO,
  type CeldaSeguimiento,
  type NivelAlerta,
  type PuntoFalla
} from '../../lib/data/seguimientoEvaluaciones'
import {
  filasDeAlertas,
  filtrarFilas,
  gruposPorUnidad,
  listarAlertas,
  marcarAtendida,
  registrarAlerta,
  type AlertaAARegistrar,
  type AlertaCargo,
  type FilaAlerta,
  type GrupoUnidad
} from '../../lib/data/alertasCargo'
import { avisar } from '../../lib/aviso'
import { useAuth } from '../../context/AuthContext'
import { setKpisGlobal, type EstadoKpis } from '../../lib/kpisGlobal'

/**
 * SEGUIMIENTO POR UNIDAD
 * ----------------------
 * Responde a «¿qué cargo hay que atender y en qué visita se le cayó?», con una
 * fila por EVALUACIÓN y no un promedio histórico: cada visita cerrada que deja
 * a un cargo por debajo del umbral pide su propio llamado de atención, y al
 * atenderlo esa combinación queda limpia hasta la próxima visita.
 *
 * La próxima evaluación entra con SUS fallas y el sistema dice cuáles son
 * reincidencias —el mismo punto caído en la inmediata anterior— y cuáles son
 * cosas nuevas, que es lo que hace útil el historial: no es lo mismo un cargo
 * que se le arregló y volvió a caer que uno que nunca se arregló.
 *
 * El nivel se calcula siempre desde las celdas (80% amonestación, 70% llamado
 * de atención); el registro es lo que el Líder decidió hacer y persiste en
 * `alertas_cargo`. Visible sólo para el LÍDER.
 */

const ETIQUETA_NIVEL_LOCAL: Record<NivelAlerta, string> = {
  AMONESTACION: 'Amonestación',
  LLAMADO: 'Llamado de atención'
}

/** `2025-03-08` → `8/3/2025`. La fecha llega como string ISO desde Postgres. */
function fechaCorta(iso: string | null): string {
  if (!iso) return 'sin fecha'
  const [a, m, d] = iso.split('-')
  if (!a || !m || !d) return iso
  return `${Number(d)}/${Number(m)}/${a}`
}

/** `87` → `87%`; sin nota, un guion largo: que no se lea como «sacó cero». */
function pct(nota: number | null): string {
  return nota == null ? '—' : `${nota}%`
}

/** `1` → «vez», cualquier otra cosa → «veces». */
function veces(n: number): string {
  return n === 1 ? 'vez' : 'veces'
}

/** El color de la nota, para las filas del panel. */
function textoNota(nota: number | null): string {
  if (nota == null) return 'text-slate-500'
  if (nota >= 90) return 'text-green-700'
  if (nota >= UMBRAL_AMONESTACION) return 'text-amber-700'
  return 'text-red-700'
}

/** La clave de ocupado de una fila: cargo, unidad y visita. */
function claveFila(f: Pick<FilaAlerta, 'clave' | 'unidadId' | 'evaluacionId'>): string {
  return `${f.clave}|${f.unidadId}|${f.evaluacionId}`
}

export interface SeguimientoVistaProps {
  datos: ConjuntoDatos | null
  cargando: boolean
  /** La consulta falló: no se puede decir «no hay puntos», porque no se sabe. */
  error: boolean
  onReintentar: () => void
  /** Las celdas en nivel (cargo × evaluación), ya calculadas. `null` = sin datos todavía. */
  celdas: CeldaSeguimiento[] | null
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
  celdas,
  alertas,
  alertasCargando,
  alertasError,
  onReintentarAlertas,
  onRegistrar,
  onAtender,
  ocupado
}: SeguimientoVistaProps) {
  const [busqueda, setBusqueda] = useState('')
  const [unidad, setUnidad] = useState('todas')
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [sel, setSel] = useState<FilaAlerta | null>(null)

  const listaAlertas = useMemo(() => alertas ?? [], [alertas])

  // El panel: cada cargo × visita que está en nivel o tiene registro. Se
  // recalcula con las alertas porque el registro cambia el pedido de acción.
  const filas = useMemo(
    () => (celdas ? filasDeAlertas(celdas, listaAlertas) : []),
    [celdas, listaAlertas]
  )

  const unidades = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const f of filas) if (!mapa.has(f.unidadId)) mapa.set(f.unidadId, f.unidadNombre)
    return Array.from(mapa.entries())
  }, [filas])

  const sinRegistrar = filas.filter((f) => !f.registro && f.nivel != null).length
  const pendientes = filas.filter((f) => f.registro?.estado === 'PENDIENTE').length
  const atendidas = filas.filter((f) => f.registro?.estado === 'ATENDIDA').length

  const filtradas = useMemo(
    () =>
      filtrarFilas(filas, {
        busqueda,
        unidadId: unidad === 'todas' ? undefined : unidad,
        estado: estadoFiltro
      }),
    [filas, busqueda, unidad, estadoFiltro]
  )

  // Los grupos salen de las filas filtradas: con un filtro activo el encabezado
  // de la unidad tiene que cerrar contra lo que se está mostrando.
  const gruposFiltrados = useMemo(() => gruposPorUnidad(filtradas), [filtradas])

  /**
   * Las acciones de una fila se arman acá: el panel no conoce la clave ni el
   * tipo de unidad, sólo qué tiene que hacer.
   */
  const registrarDe = (f: FilaAlerta): (() => void) | undefined =>
    onRegistrar && f.nivel != null && f.nota != null
      ? () =>
          onRegistrar({
            clave: f.clave,
            cargo: f.cargo,
            unidadId: f.unidadId,
            unidadTipo: f.unidadTipo,
            evaluacionId: f.evaluacionId,
            nivel: f.nivel as NivelAlerta,
            nota: f.nota as number
          })
      : undefined

  return (
    <div className="space-y-6">
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
              Cada visita cerrada con un cargo por debajo de {UMBRAL_AMONESTACION}% pide amonestación y
              por debajo de {UMBRAL_LLAMADO}%, llamado de atención. Tocá el cargo para ver qué le
              falló en ESA evaluación; el llamado registrado queda cerrado hasta la próxima visita.
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
            <Field label="Buscar cargo" className="w-52">
              <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej.: Depositaría" />
            </Field>
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
            <SkeletonFilas n={6} />
          </div>
        ) : error ? (
          <div className="mt-4">
            <EmptyState
              title="No se pudieron cargar los datos"
              subtitle="Sin las evaluaciones cerradas no se puede saber qué cargo quedó en nivel: volvé a intentar."
            />
            <Button className="mt-3" variant="secondary" onClick={onReintentar}>
              Reintentar
            </Button>
          </div>
        ) : alertasError ? (
          <div className="mt-4">
            <EmptyState
              title="No se pudieron cargar las alertas"
              subtitle="El nivel de cada visita se calcula igual (sale de las evaluaciones), pero el estado de los llamados no se sabe: volvé a intentar."
            />
            {onReintentarAlertas && (
              <Button className="mt-3" variant="secondary" onClick={onReintentarAlertas}>
                Reintentar
              </Button>
            )}
          </div>
        ) : !filas.length ? (
          <div className="mt-4">
            <EmptyState
              title="Ningún cargo está en alerta"
              subtitle={`Ninguna visita bajó de ${UMBRAL_AMONESTACION}% y no hay llamados registrados: el seguimiento empieza cuando un cargo entre en rojo.`}
            />
          </div>
        ) : filtradas.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Nada coincide con el filtro" subtitle="Probá con otra unidad, otro estado u otro cargo." />
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            {gruposFiltrados.map((g) => (
              <GrupoUnidadPanel
                key={g.unidadId}
                grupo={g}
                datos={datos}
                sel={sel}
                onSel={setSel}
                onAtender={onAtender}
                ocupado={ocupado}
                registrarDe={registrarDe}
              />
            ))}
          </div>
        )}

        {alertasCargando && !cargando && !error && (
          <p className="mt-3 text-xs text-slate-500">Cargando el estado de los llamados…</p>
        )}
      </Card>
    </div>
  )
}

/**
 * Una unidad con sus visitas: cada evaluación cierra en su propio bloque, con
 * la fecha a la vista. Ese es el punto de la pantalla — el llamado de atención
 * es de ESA visita—, y por eso la fecha no se esconde en un tooltip.
 */
function GrupoUnidadPanel({
  grupo,
  datos,
  sel,
  onSel,
  onAtender,
  ocupado,
  registrarDe
}: {
  grupo: GrupoUnidad
  datos: ConjuntoDatos | null
  sel: FilaAlerta | null
  onSel: (f: FilaAlerta | null) => void
  onAtender?: (id: string) => void
  ocupado?: string | null
  registrarDe: (f: FilaAlerta) => (() => void) | undefined
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-wider text-primary-900">{grupo.nombre}</h3>
        <span className="text-xs font-semibold text-slate-500">
          {grupo.evaluaciones.length} {grupo.evaluaciones.length === 1 ? 'visita' : 'visitas'}
          {grupo.pendientes > 0 ? ` · ${grupo.pendientes} por atender` : ' · al día'}
        </span>
      </div>

      <div className="mt-3 space-y-4">
        {grupo.evaluaciones.map((ev) => (
          <div key={ev.evaluacionId}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Visita del {fechaCorta(ev.fecha)}
            </p>
            <ul className="mt-1 divide-y divide-slate-100">
              {ev.filas.map((f) => {
                const activa = sel?.clave === f.clave && sel.unidadId === f.unidadId && sel.evaluacionId === f.evaluacionId
                return (
                  <li key={claveFila(f)}>
                    <FilaSeguimiento
                      fila={f}
                      activa={activa}
                      onDetallar={() => onSel(activa ? null : f)}
                      onRegistrar={registrarDe(f)}
                      onAtender={onAtender && f.registro?.estado === 'PENDIENTE' ? () => onAtender(f.registro!.id) : null}
                      ocupado={ocupado === claveFila(f) || (f.registro != null && ocupado === f.registro.id)}
                    />
                    {activa && datos && (
                      <DetalleVisita fila={f} datos={datos} onCerrar={() => onSel(null)} />
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Una fila del panel: el cargo en esta visita, con su nota, su nivel, el estado
 * del llamado y las dos cosas que se pueden hacer —atender el que está pendiente
 * o registrar el que falta— más el detalle de qué le falló.
 */
function FilaSeguimiento({
  fila,
  activa,
  onDetallar,
  onRegistrar,
  onAtender,
  ocupado
}: {
  fila: FilaAlerta
  activa: boolean
  onDetallar: () => void
  onRegistrar?: (() => void) | null
  onAtender?: (() => void) | null
  ocupado?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{fila.cargo}</p>
        <p className="text-xs text-slate-500">
          <span className={cn('font-black tabular-nums', textoNota(fila.nota))}>{pct(fila.nota)}</span>
          {' de nota en esta visita'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ChipNivel nivel={fila.nivel} />
        <ChipEstado registro={fila.registro} />
        {onAtender && (
          <Button type="button" variant="secondary" disabled={ocupado} onClick={onAtender}>
            {ocupado ? 'Atendiendo…' : 'Marcar atendida'}
          </Button>
        )}
        {onRegistrar && (
          <Button type="button" variant="primary" disabled={ocupado} onClick={onRegistrar}>
            {ocupado ? 'Registrando…' : `Registrar ${ETIQUETA_NIVEL_LOCAL[fila.nivel as NivelAlerta].toLowerCase()}`}
          </Button>
        )}
        <Button type="button" variant="ghost" aria-expanded={activa} onClick={onDetallar}>
          {activa ? (
            <>
              <X className="h-4 w-4" /> Cerrar
            </>
          ) : (
            'Ver qué le falló'
          )}
        </Button>
      </div>
    </div>
  )
}

/**
 * El detalle que se despliega bajo la fila: lo que le salió mal a ESTE cargo
 * en ESTA visita, con la historia de cada punto en la unidad.
 *
 * Los puntos reincidentes van arriba: son los que el Líder tiene que mirar
 * primero, porque vienen de una visita anterior en la que ya se habló.
 */
export function DetalleVisita({
  fila,
  datos,
  onCerrar
}: {
  fila: FilaAlerta
  datos: ConjuntoDatos
  onCerrar: () => void
}) {
  const puntos = useMemo(
    () => puntosFalladosDeCargo(datos, fila.cargo, fila.unidadId, fila.evaluacionId),
    [datos, fila]
  )
  const reincidencias = puntos.filter((p) => p.esReincidente).length

  return (
    <div className="mt-1 rounded-xl bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Qué le falló en esta visita
          </span>
          <h4 className="mt-1 text-base font-bold text-primary-900">
            {fila.cargo} · {fila.unidadNombre} · {fechaCorta(fila.fecha)}
          </h4>
          <p className="text-sm text-slate-600">
            <strong className={cn('font-black', textoNota(fila.nota))}>
              {fila.nota == null ? 'Sin nota' : `${fila.nota}% de nota`}
            </strong>
            {' · '}
            <strong className="text-red-600">{puntos.length}</strong>{' '}
            {puntos.length === 1 ? 'punto sin cumplir' : 'puntos sin cumplir'}
            {reincidencias > 0 && (
              <>
                {' · '}
                <strong className="text-red-700">{reincidencias}</strong>{' '}
                {reincidencias === 1 ? 'reincidente' : 'reincidentes'}
              </>
            )}
          </p>
        </div>
        <Button variant="ghost" onClick={onCerrar}>
          <X className="h-4 w-4" />
          Cerrar detalle
        </Button>
      </div>

      {puntos.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Sin puntos caídos atribuidos a este cargo en esta visita: si la nota bajó igual, revisá los
          responsables elegidos en la evaluación.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200">
          {puntos.map((p) => (
            <PuntoFallaFila key={`${p.item_id}|${p.check ?? ''}`} punto={p} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Un punto caído, con su historia en la unidad. */
function PuntoFallaFila({ punto }: { punto: PuntoFalla }) {
  return (
    <li className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">
          {punto.check ? punto.check : `${punto.item} (ítem completo)`}
        </p>
        {punto.check && <p className="text-xs text-slate-500">{punto.item}</p>}
        <p className="mt-0.5 text-xs text-slate-500">
          {punto.faltas} {veces(punto.faltas)} sin cumplir en esta unidad
          {punto.reincidencias > 0 ? ` · ${punto.reincidencias} ${veces(punto.reincidencias)} reincidente(s)` : ''}
        </p>
      </div>
      {punto.esReincidente ? (
        <span className="shrink-0 rounded-full bg-red-700 px-2.5 py-1 text-[11px] font-bold text-white">
          Reincidente
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700">
          Nueva falla
        </span>
      )}
    </li>
  )
}

/**
 * El chip de nivel: lo que la nota está pidiendo AHORA, recién calculado desde
 * la celda. No depende de ningún registro: es la regla (80% / 70%) aplicada al
 * número que se está mirando.
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
      {ETIQUETA_NIVEL_LOCAL[nivel]}
    </span>
  )
}

/**
 * El estado del registro: qué se hizo con el llamado de ESTA visita. «Sin
 * registrar» es el estado de lo que todavía no pasó por la base, no un error.
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

export function Responsables() {
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [recargar, setRecargar] = useState(0)

  // Las alertas van en su propio estado: si fallan, las celdas siguen siendo
  // confiables (salen de las evaluaciones cerradas) y sólo el estado de los
  // llamados tiene que decir que no se sabe. `null` = sin cargar todavía.
  const [alertas, setAlertas] = useState<AlertaCargo[] | null>(null)
  const [alertasError, setAlertasError] = useState(false)
  const [recargarAlertas, setRecargarAlertas] = useState(0)
  // La fila (o la alerta) con una acción en vuelo: sin esto se podía apretar
  // «Registrar» dos veces y crear dos llamados iguales en el peor de los casos.
  const [ocupado, setOcupado] = useState<string | null>(null)

  const { profile } = useAuth()

  useEffect(() => {
    let activo = true
    setCargando(true)
    setError(false)
    void (async () => {
      try {
        // Sin recorte de fechas: el seguimiento mira todas las visitas. Sólo
        // cerradas, por el mismo motivo que en Indicadores — una evaluación
        // abierta tiene las respuestas a medias y sus puntos son un borrador.
        const d = await consultarEvaluaciones({ sucursal_ids: null, soloCerradas: true })
        if (activo) setDatos(d)
      } catch {
        // No se deja `datos` como lista vacía: eso se renderiza como «todavía no
        // hay visitas», que es un falso cuando lo que falló fue la red.
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
        // no hay llamados cuando lo que falló fue la red.
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
    setOcupado(`${a.clave}|${a.unidadId}|${a.evaluacionId}`)
    void (async () => {
      try {
        await registrarAlerta(a)
        avisar(`${ETIQUETA_NIVEL_LOCAL[a.nivel]} registrado para ${a.cargo}.`)
      } catch {
        avisar('No se pudo registrar el llamado de atención.', 'error')
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
        avisar('Llamado de atención marcado como atendido.')
      } catch {
        avisar('No se pudo marcar el llamado como atendido.', 'error')
      } finally {
        setOcupado(null)
        recargarTodoAlertas()
      }
    })()
  }

  const celdas = useMemo(() => (datos ? seguimientoPorEvaluacion(datos) : null), [datos])

  // La franja azul (BarraKpis) muestra los KPIs de esta pantalla en vez de los
  // globales, igual que Indicadores y el dashboard de módulo.
  const kpis = useMemo<EstadoKpis | null>(() => {
    if (!celdas) return null
    const listaAlertas = alertas ?? []
    const pendientes = listaAlertas.filter((a) => a.estado === 'PENDIENTE').length
    return {
      global: null,
      completadas: datos?.evaluaciones.length ?? 0,
      cobertura: 0,
      incumplimientos: 0,
      items: [
        { etiqueta: 'Cargos en alerta', valor: celdas.length, icono: 'alerta' },
        { etiqueta: 'Visitas con alertas', valor: new Set(celdas.map((c) => c.evaluacion_id)).size, icono: 'lista' },
        { etiqueta: 'Unidades', valor: new Set(celdas.map((c) => c.unidad.id)).size, icono: 'store' },
        { etiqueta: 'Llamados pendientes', valor: pendientes, icono: 'alerta' }
      ]
    }
  }, [datos, celdas, alertas])

  useEffect(() => {
    setKpisGlobal(kpis)
  }, [kpis])

  return (
    <SeguimientoVista
      datos={datos}
      cargando={cargando}
      error={error}
      onReintentar={() => setRecargar((n) => n + 1)}
      celdas={celdas}
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

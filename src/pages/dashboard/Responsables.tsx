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
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { chipPastel } from '../../lib/diseno'
import { cedula, listarColaboradores, nombreCompleto, trabajadoresParaCargo, type ColaboradorAPI } from '../../lib/data/colaboradores'
import { claveNormalizada } from '../../lib/data/responsables'
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
  cargarNomina,
  celdasEnNomina,
  filasDeAlertas,
  filasEnNomina,
  filtrarFilas,
  gruposPorUnidad,
  listarAlertas,
  listarTrabajadoresPorAlerta,
  marcarAtendida,
  registrarAlerta,
  type AlertaAARegistrar,
  type AlertaCargo,
  type FilaAlerta,
  type GrupoUnidad,
  type NominaUnidades,
  type TrabajadorAlerta
} from '../../lib/data/alertasCargo'
import { descargarAmonestacion } from '../../lib/pdf/amonestacionTrabajador'
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

/**
 * El motivo técnico del fallo, traducido a lo que le toca hacer a la persona:
 * el error de PostgREST por una tabla inexistente no dice «andá al SQL Editor».
 */
function motivoLegible(motivo: string): string {
  if (/does not exist|schema cache|not found/i.test(motivo)) {
    return 'falta aplicar la tabla alerta_trabajadores (pegá supabase/schema.sql en el SQL Editor de Supabase).'
  }
  return motivo
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
  /**
   * A quién se le aplicó cada alerta, por id de alerta. Viene de una consulta
   * aparte: si la tabla nueva todavía no está aplicada, se pierden los nombres
   * y el resto del panel sigue funcionando.
   */
  trabajadoresPorAlerta?: Map<string, TrabajadorAlerta[]> | null
  /**
   * La nómina de las unidades del panel, contra la que se decide qué cargos
   * entran a la lista. `null` todavía no se pidió: hasta que llegue no se
   * esconde nada (ver `filasEnNomina`).
   */
  nomina?: NominaUnidades | null
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
  trabajadoresPorAlerta,
  nomina,
  onRegistrar,
  onAtender,
  ocupado
}: SeguimientoVistaProps) {
  const [busqueda, setBusqueda] = useState('')
  const [unidad, setUnidad] = useState('todas')
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [sel, setSel] = useState<FilaAlerta | null>(null)
  /** La fila cuyo registro está en curso: su detalle abierto con el selector de personas. */
  const [registrando, setRegistrando] = useState<FilaAlerta | null>(null)

  const listaAlertas = useMemo(() => alertas ?? [], [alertas])

  // El panel: cada cargo × visita que está en nivel o tiene registro. Se
  // recalcula con las alertas porque el registro cambia el pedido de acción.
  const filasTodas = useMemo(
    () => (celdas ? filasDeAlertas(celdas, listaAlertas) : []),
    [celdas, listaAlertas]
  )
  // …y recortadas a los cargos que EXISTEN en la nómina de su unidad: no todos
  // los cargos aplican en todas las sucursales, y un cargo sin nadie en la
  // tienda no pide llamado (ver `filasEnNomina`). La diferencia entre las dos
  // listas es lo que la nómina descartó, que la pantalla tiene que decir.
  const filas = useMemo(() => filasEnNomina(filasTodas, nomina ?? null), [filasTodas, nomina])
  const ocultasPorNomina = filasTodas.length - filas.length

  const unidades = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const f of filas) if (!mapa.has(f.unidadId)) mapa.set(f.unidadId, f.unidadNombre)
    return Array.from(mapa.entries())
  }, [filas])

  const sinRegistrar = filas.filter((f) => !f.registro && f.nivel != null).length
  const pendientes = filas.filter((f) => f.registro?.estado === 'PENDIENTE').length
  const atendidas = filas.filter((f) => f.registro?.estado === 'ATENDIDA').length

  // El resumen de lo que está recortando la lista: el filtro vive en el panel
  // de la cabecera, así que la vista tiene que decirlo con sus palabras.
  const ETIQUETA_ESTADO_FILTRO: Record<string, string> = {
    sin_registrar: 'sin registrar',
    pendientes: 'pendientes',
    atendidas: 'atendidas'
  }
  const hayFiltro = !!busqueda.trim() || unidad !== 'todas' || estadoFiltro !== 'todos'
  const resumenFiltro = [
    busqueda.trim() ? `cargo «${busqueda.trim()}»` : '',
    unidad !== 'todas' ? (unidades.find(([id]) => id === unidad)?.[1] ?? '') : '',
    estadoFiltro !== 'todos' ? (ETIQUETA_ESTADO_FILTRO[estadoFiltro] ?? '') : ''
  ]
    .filter(Boolean)
    .join(' · ')

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
   * Registrar YA NO es un toque directo: abre el detalle de la visita con el
   * selector de personas. El llamado se aplica a trabajadores concretos y hay
   * que poder elegirlos antes de que exista el registro (y de que se baje el
   * PDF de amonestación, que es por persona).
   */
  const registrarDe = (f: FilaAlerta): (() => void) | undefined =>
    onRegistrar && f.nivel != null && f.nota != null
      ? () => {
          setSel(f)
          setRegistrando(f)
        }
      : undefined

  /** El toque final del selector: registra con las personas elegidas y baja el PDF. */
  const confirmarRegistro = (elegidos: TrabajadorAlerta[]) => {
    const f = registrando
    if (!f || !onRegistrar || f.nivel == null || f.nota == null) return
    onRegistrar({
      clave: f.clave,
      cargo: f.cargo,
      unidadId: f.unidadId,
      unidadTipo: f.unidadTipo,
      evaluacionId: f.evaluacionId,
      nivel: f.nivel,
      nota: f.nota,
      trabajadores: elegidos
    })
    // Un PDF por persona, sólo para amonestaciones (decisión de producto): el
    // llamado de atención queda en la base y en la pantalla, sin documento.
    if (f.nivel === 'AMONESTACION' && datos && elegidos.length) {
      const puntos = puntosFalladosDeCargo(datos, f.cargo, f.unidadId, f.evaluacionId)
      const visita = datos.evaluaciones.find((e) => e.id === f.evaluacionId)
      for (const t of elegidos) {
        descargarAmonestacion({
          trabajador: t,
          cargo: f.cargo,
          unidad: f.unidadNombre,
          fechaVisita: visita?.fecha ?? f.fecha ?? '',
          nota: f.nota,
          puntos
        })
      }
    }
    setRegistrando(null)
    setSel(null)
  }

  return (
    <div className="space-y-6">
      {/* Los filtros van al panel de la cabecera (botón «Filtros»): el mismo
          hueco al que se cuelgan Historial, Indicadores y Comparativas. */}
      <DashboardFiltersPortal>
        <FiltrosSeguimiento
          busqueda={busqueda}
          setBusqueda={setBusqueda}
          unidad={unidad}
          setUnidad={setUnidad}
          unidades={unidades}
          estadoFiltro={estadoFiltro}
          setEstadoFiltro={setEstadoFiltro}
          sinRegistrar={sinRegistrar}
          pendientes={pendientes}
          atendidas={atendidas}
        />
      </DashboardFiltersPortal>
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
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {[
                  { texto: `${sinRegistrar} sin registrar`, umbral: 'noCumple' as const },
                  { texto: `${pendientes} pendientes`, umbral: 'riesgo' as const },
                  { texto: `${atendidas} atendidas`, umbral: 'cumple' as const }
                ].map((c) => {
                  const p = chipPastel(c.umbral)
                  return (
                    <span
                      key={c.texto}
                      className="rounded-full px-2.5 py-1 font-semibold"
                      style={{ background: p.fondo, color: p.tinta }}
                    >
                      {c.texto}
                    </span>
                  )
                })}
                {/* Lo que la nómina sacó de la lista se anuncia en vez de
                    esconderse: una fila que no aparece no se puede buscar. El
                    número es de FILAS (cargo × visita), igual que los chips de
                    al lado, no de cargos distintos. */}
                {ocultasPorNomina > 0 && (
                  <span
                    className="rounded-full px-2.5 py-1 font-semibold"
                    style={{ background: chipPastel('sinDato').fondo, color: chipPastel('sinDato').tinta }}
                  >
                    {ocultasPorNomina} ocultos: sin trabajadores en su unidad
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Los filtros NO viven más en la vista: van al panel del botón
              «Filtros» de la cabecera, igual que en las otras vistas del
              dashboard. Acá sólo queda el aviso de que hay un filtro puesto,
              para que una lista corta no se lea como «ya no hay nada». */}
          {hayFiltro ? (
            <div className="flex flex-wrap items-center gap-2 self-end text-xs">
              <span
                className="rounded-full px-2.5 py-1 font-semibold"
                style={{ background: chipPastel('riesgo').fondo, color: chipPastel('riesgo').tinta }}
              >
                Filtro activo
              </span>
              <span className="text-slate-500">{resumenFiltro}</span>
            </div>
          ) : null}
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
            {ocultasPorNomina > 0 ? (
              // Sí hubo visitas en rojo, pero ningún cargo de esa lista tiene
              // trabajadores en su tienda: decir «nada en alerta» sería mentir.
              <EmptyState
                title="Ningún cargo en alerta tiene trabajadores en su unidad"
                subtitle={`Las ${ocultasPorNomina} visitas que bajaron de ${UMBRAL_AMONESTACION}% son de cargos que no figuran en la nómina de su sucursal: no todos los cargos aplican en todas las tiendas.`}
              />
            ) : (
              <EmptyState
                title="Ningún cargo está en alerta"
                subtitle={`Ninguna visita bajó de ${UMBRAL_AMONESTACION}% y no hay llamados registrados: el seguimiento empieza cuando un cargo entre en rojo.`}
              />
            )}
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
                trabajadoresPorAlerta={trabajadoresPorAlerta}
                registrando={registrando}
                onConfirmarRegistro={confirmarRegistro}
                onCancelarRegistro={() => setRegistrando(null)}
              />
            ))}
          </div>
        )}

        {alertasCargando && !cargando && !error && (
          <p className="mt-3 text-xs text-slate-500">Cargando el estado de los llamados…</p>
        )}
        {nomina?.cargando && !cargando && !error && (
          <p className="mt-3 text-xs text-slate-500">
            Verificando qué cargos existen en cada sucursal…
          </p>
        )}
        {nomina?.fallo && !cargando && !error && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No se pudo leer la nómina de alguna unidad: sus cargos se listan igual hasta que la
            consulta vuelva.
          </p>
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
  registrarDe,
  trabajadoresPorAlerta,
  registrando,
  onConfirmarRegistro,
  onCancelarRegistro
}: {
  grupo: GrupoUnidad
  datos: ConjuntoDatos | null
  sel: FilaAlerta | null
  onSel: (f: FilaAlerta | null) => void
  onAtender?: (id: string) => void
  ocupado?: string | null
  registrarDe: (f: FilaAlerta) => (() => void) | undefined
  trabajadoresPorAlerta?: Map<string, TrabajadorAlerta[]> | null
  /** La fila cuyo registro está en curso (su detalle abierto con el selector). */
  registrando?: FilaAlerta | null
  onConfirmarRegistro?: (elegidos: TrabajadorAlerta[]) => void
  onCancelarRegistro?: () => void
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
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Visita del {fechaCorta(ev.fecha)}
            </p>
            <ul className="mt-1 divide-y divide-slate-100">
              {ev.filas.map((f) => {
                const activa = sel?.clave === f.clave && sel.unidadId === f.unidadId && sel.evaluacionId === f.evaluacionId
                const aplicados = f.registro ? trabajadoresPorAlerta?.get(f.registro.id) : undefined
                return (
                  <li key={claveFila(f)}>
                    <FilaSeguimiento
                      fila={f}
                      activa={activa}
                      aplicados={aplicados}
                      onDetallar={() => onSel(activa ? null : f)}
                      onRegistrar={registrarDe(f)}
                      onAtender={onAtender && f.registro?.estado === 'PENDIENTE' ? () => onAtender(f.registro!.id) : null}
                      ocupado={ocupado === claveFila(f) || (f.registro != null && ocupado === f.registro.id)}
                    />
                    {activa && datos && (
                      <DetalleVisita
                        fila={f}
                        datos={datos}
                        registrando={registrando?.evaluacionId === f.evaluacionId && registrando.clave === f.clave && registrando.unidadId === f.unidadId}
                        onConfirmarRegistro={onConfirmarRegistro}
                        onCancelarRegistro={onCancelarRegistro}
                        onCerrar={() => {
                          onCancelarRegistro?.()
                          onSel(null)
                        }}
                      />
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
  aplicados,
  onDetallar,
  onRegistrar,
  onAtender,
  ocupado
}: {
  fila: FilaAlerta
  activa: boolean
  /** A quién se le aplicó el llamado, si se pudo saber. */
  aplicados?: TrabajadorAlerta[]
  onDetallar: () => void
  onRegistrar?: (() => void) | null
  onAtender?: (() => void) | null
  ocupado?: boolean
}) {
  return (
    // Dos tamaños en toda la fila: `text-sm` para el nombre del cargo y
    // `text-xs` para todo lo demás —nota, estados y botones—. Antes cada pieza
    // traía su propio peso y la fila se leía como cuatro cosas distintas.
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{fila.cargo}</p>
        <p className="text-xs text-slate-500">
          <span className={cn('font-bold tabular-nums', textoNota(fila.nota))}>{pct(fila.nota)}</span>
          {' de nota en esta visita'}
        </p>
        {aplicados?.length ? (
          <p className="mt-0.5 truncate text-xs text-slate-500">
            Aplicado a {aplicados.map((t) => t.nombre).join(', ')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ChipNivel nivel={fila.nivel} />
        <ChipEstado registro={fila.registro} />
        {onAtender && (
          <Button type="button" variant="secondary" className="text-xs" disabled={ocupado} onClick={onAtender}>
            {ocupado ? 'Atendiendo…' : 'Marcar atendida'}
          </Button>
        )}
        {onRegistrar && (
          <Button type="button" variant="primary" className="text-xs" disabled={ocupado} onClick={onRegistrar}>
            {ocupado ? 'Registrando…' : `Registrar ${ETIQUETA_NIVEL_LOCAL[fila.nivel as NivelAlerta].toLowerCase()}`}
          </Button>
        )}
        <Button type="button" variant="ghost" className="text-xs" aria-expanded={activa} onClick={onDetallar}>
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
  registrando = false,
  onConfirmarRegistro,
  onCancelarRegistro,
  onCerrar
}: {
  fila: FilaAlerta
  datos: ConjuntoDatos
  /** Este detalle está abierto en modo registro: abajo va el selector de personas. */
  registrando?: boolean
  onConfirmarRegistro?: (elegidos: TrabajadorAlerta[]) => void
  onCancelarRegistro?: () => void
  onCerrar: () => void
}) {
  const puntos = useMemo(
    () => puntosFalladosDeCargo(datos, fila.cargo, fila.unidadId, fila.evaluacionId),
    [datos, fila]
  )
  const reincidencias = puntos.filter((p) => p.esReincidente).length

  // --- Nómina de la unidad ---------------------------------------------------
  // Se pide recién al abrir el registro: es una llamada a la API externa de
  // trabajadores y no hace falta para mirar el detalle.
  const [trabajadores, setTrabajadores] = useState<ColaboradorAPI[] | null>(null)
  const [porCargo, setPorCargo] = useState(true)
  const [cargandoTrabajadores, setCargandoTrabajadores] = useState(false)
  const [errorTrabajadores, setErrorTrabajadores] = useState<string | null>(null)

  useEffect(() => {
    if (!registrando) {
      setTrabajadores(null)
      return
    }
    // El cruce es por la SUCURSAL de la visita (`shop_id`, con `branch_id` de
    // respaldo): es el mismo identificador que usa la app para pedir la nómina.
    const ev = datos.evaluaciones.find((e) => e.id === fila.evaluacionId)
    const branch = ev?.sucursal ? (ev.sucursal.shop_id ?? ev.sucursal.branch_id) : null
    if (!branch) {
      setTrabajadores([])
      setErrorTrabajadores(
        'Esta unidad no tiene nómina de trabajadores asociada: el llamado queda registrado contra el cargo, sin personas.'
      )
      return
    }
    let vivo = true
    setCargandoTrabajadores(true)
    setErrorTrabajadores(null)
    void listarColaboradores(branch).then((r) => {
      if (!vivo) return
      setCargandoTrabajadores(false)
      if (r.mensaje) {
        setTrabajadores([])
        setErrorTrabajadores(r.mensaje)
        return
      }
      const { trabajadores: lista, porCargo: encaja } = trabajadoresParaCargo(r.colaboradores, fila.cargo)
      setTrabajadores(lista)
      setPorCargo(encaja)
    })
    return () => {
      vivo = false
    }
  }, [registrando, datos, fila])

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

      {registrando && onConfirmarRegistro ? (
        <SelectorTrabajadores
          cargo={fila.cargo}
          unidad={fila.unidadNombre}
          nivel={fila.nivel}
          trabajadores={trabajadores}
          cargando={cargandoTrabajadores}
          error={errorTrabajadores}
          porCargo={porCargo}
          onConfirmar={onConfirmarRegistro}
          onCancelar={onCancelarRegistro ?? (() => {})}
        />
      ) : null}
    </div>
  )
}

/**
 * El selector de personas a las que se aplica el llamado o la amonestación.
 *
 * Puro de presentación: la nómina la trae el detalle (`listarColaboradores`) y
 * acá sólo se filtra y se tilda, para poder probarlo sin red. Sólo se muestran
 * trabajadores ACTIVOS —el detalle ya vino recortado— y, si el cruce por cargo
 * no encontró a nadie, el que llama decide igual: registrar sin personas es
 * mejor que no poder registrar.
 */
export function SelectorTrabajadores({
  cargo,
  unidad,
  nivel,
  trabajadores,
  cargando,
  error,
  porCargo,
  onConfirmar,
  onCancelar
}: {
  cargo: string
  unidad: string
  nivel: NivelAlerta | null
  trabajadores: ColaboradorAPI[] | null
  cargando: boolean
  error: string | null
  porCargo: boolean
  onConfirmar: (elegidos: TrabajadorAlerta[]) => void
  onCancelar: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [elegidos, setElegidos] = useState<Set<number>>(new Set())

  const q = claveNormalizada(busqueda.trim())
  const visibles = (trabajadores ?? []).filter(
    (t) => !q || claveNormalizada(`${t.name ?? ''} ${t.lastname ?? ''} ${cedula(t)}`).includes(q)
  )

  const alternar = (dni: number) =>
    setElegidos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(dni)) siguiente.delete(dni)
      else siguiente.add(dni)
      return siguiente
    })

  const listaElegida: TrabajadorAlerta[] = (trabajadores ?? [])
    .filter((t) => t.dni != null && elegidos.has(t.dni))
    .map((t) => ({
      dni: t.dni as number,
      nacionalidad: (t.nationality ?? 'V').trim() || 'V',
      nombre: nombreCompleto(t)
    }))

  const etiquetaConfirmar =
    nivel === 'AMONESTACION' ? 'Registrar amonestación y descargar PDF' : 'Registrar llamado de atención'

  /**
   * Las dos caras del mismo cierre: con lista, se elige y se registra (y si es
   * amonestación se baja el PDF); sin lista —nómina caída o unidad sin
   * trabajadores— se registra contra el cargo, que es lo que se hacía antes.
   */
  const acciones = (sinPersonas = false) => (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-semibold text-slate-500">
        {sinPersonas
          ? 'Sin personas: el registro queda contra el cargo.'
          : `${listaElegida.length} de ${(trabajadores ?? []).length} seleccionados`}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={!sinPersonas && !listaElegida.length}
          onClick={() => onConfirmar(sinPersonas ? [] : listaElegida)}
        >
          {sinPersonas ? 'Registrar igual' : etiquetaConfirmar}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        ¿A quién se le aplica?
      </span>
      <h5 className="mt-1 text-sm font-bold text-primary-900">
        {cargo} · {unidad}
      </h5>

      {cargando ? (
        <p className="mt-3 text-sm text-slate-500">Cargando trabajadores de la unidad…</p>
      ) : error ? (
        <>
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>
          {acciones(true)}
        </>
      ) : !trabajadores?.length ? (
        // Sin coincidencias el cargo NO está habilitado en esa unidad, que es
        // lo normal —no todos los cargos aplican en todas las sucursales—: la
        // lista se queda vacía a propósito en vez de mostrar a los demás y
        // terminar notificando a la persona equivocada.
        <>
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {porCargo
              ? 'No hay trabajadores activos en esta unidad.'
              : `«${cargo}» no figura en la nómina de ${unidad}: es normal, no todos los cargos aplican en todas las sucursales. El registro queda contra el cargo.`}
          </p>
          {acciones(true)}
        </>
      ) : (
        <>
          <Input
            className="mt-3"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o cédula"
            aria-label="Buscar persona"
          />
          {visibles.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nadie coincide con «{busqueda}».</p>
          ) : (
            <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto">
              {visibles.map((t) => {
                const marcado = t.dni != null && elegidos.has(t.dni)
                const nombre = nombreCompleto(t)
                return (
                  <li key={`${t.nationality ?? 'V'}-${t.dni}`}>
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={marcado}
                        onChange={() => alternar(t.dni as number)}
                      />
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-black text-primary">
                        {(nombre || 'U').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-800">{nombre}</span>
                        <span className="block text-xs text-slate-500">
                          {cedula(t)} · {t.role_name || 'Sin rol'}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {acciones()}
        </>
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
  // Pastel del sistema (ver `chipPastel`): el rojo sólido gritaba más de lo
  // que informaba en una lista con cincuenta filas. Fondo y tinta por
  // variable, para que en modo oscuro se oscurezcan los dos juntos.
  const { fondo, tinta } = chipPastel(nivel === 'LLAMADO' ? 'noCumple' : 'riesgo')
  return (
    <span
      className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: fondo, color: tinta }}
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
  // Los tres estados con los pasteles del sistema, todos del mismo tamaño: en
  // una lista larga el estado se compara de un vistazo, no se lee palabra a
  // palabra.
  const chip = (umbral: 'cumple' | 'riesgo' | 'sinDato', texto: string) => {
    const { fondo, tinta } = chipPastel(umbral)
    return (
      <span
        className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ background: fondo, color: tinta }}
      >
        {texto}
      </span>
    )
  }

  if (!registro) return chip('sinDato', 'Sin registrar')
  if (registro.estado === 'PENDIENTE') return chip('riesgo', 'Pendiente')

  const fecha = registro.atendida_en ? fechaCorta(registro.atendida_en.slice(0, 10)) : ''
  const quien = registro.atendida?.nombre
  return chip('cumple', `${fecha ? `Atendida el ${fecha}` : 'Atendida'}${quien ? ` por ${quien}` : ''}`)
}

/**
 * Los filtros del seguimiento, dentro del panel de la cabecera (botón
 * «Filtros»): las mismas piezas y la misma medida de campo que en Indicadores,
 * para que los tres paneles se sientan el mismo.
 */
function FiltrosSeguimiento(props: {
  busqueda: string
  setBusqueda: (v: string) => void
  unidad: string
  setUnidad: (v: string) => void
  unidades: [string, string][]
  estadoFiltro: string
  setEstadoFiltro: (v: string) => void
  sinRegistrar: number
  pendientes: number
  atendidas: number
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <Field label="Buscar cargo" className="w-56">
        <Input
          className="h-10"
          value={props.busqueda}
          onChange={(e) => props.setBusqueda(e.target.value)}
          placeholder="Ej.: Depositaría"
        />
      </Field>
      <Field label="Unidad" className="w-56">
        <Select className="h-10" value={props.unidad} onChange={(e) => props.setUnidad(e.target.value)}>
          <option value="todas">Todas las unidades</option>
          {props.unidades.map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Estado" className="w-52">
        <Select className="h-10" value={props.estadoFiltro} onChange={(e) => props.setEstadoFiltro(e.target.value)}>
          <option value="todos">Todos</option>
          <option value="sin_registrar">Sin registrar ({props.sinRegistrar})</option>
          <option value="pendientes">Pendientes ({props.pendientes})</option>
          <option value="atendidas">Atendidas ({props.atendidas})</option>
        </Select>
      </Field>
    </div>
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
  // A quién se le aplicó cada alerta. Mapa vacío = no se pudo saber (la tabla
  // nueva puede no estar aplicada todavía): el panel se ve igual, sin nombres.
  const [trabajadores, setTrabajadores] = useState<Map<string, TrabajadorAlerta[]> | null>(null)
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
      // Los trabajadores elegidos van en SU consulta: si esa tabla todavía no
      // existe (bloque nuevo sin aplicar), se pierden los nombres pero las
      // alertas siguen listándose. Un detalle no tumba la pantalla entera.
      try {
        const mapa = await listarTrabajadoresPorAlerta()
        if (activo) setTrabajadores(mapa)
      } catch {
        if (activo) setTrabajadores(new Map())
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
        const r = await registrarAlerta(a)
        if (r.motivo) {
          // La ALERTA quedó creada: lo único que falló fue guardar a las
          // personas, y el motivo más común es la tabla nueva sin aplicar.
          avisar(
            `${ETIQUETA_NIVEL_LOCAL[a.nivel]} registrado para ${a.cargo}. Personas sin guardar: ${motivoLegible(r.motivo)}`,
            'aviso'
          )
        } else {
          avisar(`${ETIQUETA_NIVEL_LOCAL[a.nivel]} registrado para ${a.cargo}.`)
        }
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

  // La nómina de las unidades con celdas: es lo que permite no listar cargos
  // que no existen en esa tienda. Se pide por separado de las evaluaciones
  // porque va a otra API, y mientras no vuelva no se recorta nada.
  const [nomina, setNomina] = useState<NominaUnidades | null>(null)
  useEffect(() => {
    if (!datos || !celdas?.length) {
      setNomina(null)
      return
    }
    let vivo = true
    setNomina({ porUnidad: new Map(), cargando: true, fallo: false })
    const unidades = new Set(celdas.map((c) => c.unidad.id))
    void cargarNomina(datos, unidades).then((n) => {
      if (vivo) setNomina(n)
    })
    return () => {
      vivo = false
    }
  }, [celdas, datos])

  // La franja azul (BarraKpis) muestra los KPIs de esta pantalla en vez de los
  // globales, igual que Indicadores y el dashboard de módulo.
  const kpis = useMemo<EstadoKpis | null>(() => {
    if (!celdas) return null
    // La MISMA regla que la lista (`celdasEnNomina`): un cargo sin trabajadores
    // en su unidad tampoco cuenta como alerta, y el que ya tiene llamado
    // registrado cuenta en los dos lados. Si no, el número de arriba y la lista
    // de abajo dirían cosas distintas de la misma pantalla.
    const listaAlertas = alertas ?? []
    const visibles = celdasEnNomina(celdas, nomina, listaAlertas)
    const pendientes = listaAlertas.filter((a) => a.estado === 'PENDIENTE').length
    return {
      global: null,
      completadas: datos?.evaluaciones.length ?? 0,
      cobertura: 0,
      incumplimientos: 0,
      items: [
        { etiqueta: 'Cargos en alerta', valor: visibles.length, icono: 'alerta' },
        { etiqueta: 'Visitas con alertas', valor: new Set(visibles.map((c) => c.evaluacion_id)).size, icono: 'lista' },
        { etiqueta: 'Unidades', valor: new Set(visibles.map((c) => c.unidad.id)).size, icono: 'store' },
        { etiqueta: 'Llamados pendientes', valor: pendientes, icono: 'alerta' }
      ]
    }
  }, [datos, celdas, alertas, nomina])

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
      trabajadoresPorAlerta={trabajadores}
      nomina={nomina}
      onRegistrar={registrar}
      onAtender={atender}
      ocupado={ocupado}
    />
  )
}

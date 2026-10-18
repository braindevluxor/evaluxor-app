import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import {
  consultarEvaluaciones,
  detalleDeEvaluacion,
  incumplimientosEnRango,
  medidoresPorModulo,
  puntajePorSucursalModulo,
  rankingDepartamentos,
  rankingResponsables,
  rankingSucursales,
  renglonesDrilldown
} from '../../lib/data/indicadores'
import type { AlcanceDrilldown, ConjuntoDatos } from '../../lib/data/indicadores'
import { Card, Field, Input, Select, Skeleton } from '../../components/ui'
import { subtituloMedidor } from '../../components/dashboard/subtituloMedidor'
import { ModalDrilldown, DetalleEvalCabecera, DetalleRespuestasLista } from '../../components/dashboard/ModalDrilldown'
import { verTodo } from '../../lib/roles'
import { setKpisGlobal } from '../../lib/kpisGlobal'
import { pct as pctComa } from '../../lib/numeros'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine
} from 'recharts'
import { COLORES_MODULOS, HEX_PRIMARY, HEX_CUMPLE, HEX_RIESGO, colorPuntajeHex } from '../../lib/diseno'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Gráfico "Ponderación por unidad y módulo": una curva por módulo con la barra
 * translúcida del promedio de la unidad. El mismo componente dibuja sucursales
 * y departamentos; solo cambian las filas y a qué unidad apunta el clic.
 */
function GraficoPonderacion({
  titulo,
  descripcion,
  filas,
  modulos,
  nombrePromedio,
  lineaActiva,
  setLineaActiva,
  onClic,
  sinDatos
}: {
  titulo: string
  descripcion: string
  filas: { nombre: string; porModulo: Record<string, number | null> }[]
  modulos: { modulo_id: string; nombre: string }[]
  /** Nombre de la barra en la leyenda ('Promedio por sucursal' / '… por departamento'). */
  nombrePromedio: string
  lineaActiva: string | null
  setLineaActiva: (valor: string | null) => void
  onClic: (data: unknown) => void
  sinDatos: string
}) {
  const filasGrafico = filas.map((f) => {
    const valores = Object.values(f.porModulo).filter((v): v is number => v != null)
    return {
      unidad: f.nombre,
      ...f.porModulo,
      promedio: valores.length ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100 : null
    }
  })
  return (
    <Card className="lg:col-span-2 border-0!">
      <h3 className="mb-1 font-bold text-primary-900">{titulo}</h3>
      <p className="mb-3 text-xs text-slate-400">{descripcion}</p>
      {modulos.length && filas.length ? (
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={filasGrafico} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="unidad" interval={0} angle={-38} textAnchor="end" height={90} tick={{ fontSize: 11, fill: '#475569' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <ReferenceLine y={80} stroke={HEX_CUMPLE} strokeDasharray="4 4" strokeOpacity={0.4} />
            <ReferenceLine y={60} stroke={HEX_RIESGO} strokeDasharray="4 4" strokeOpacity={0.4} />
            <Tooltip
              formatter={(v, nombre) => [pctComa(Number(v)), String(nombre)]}
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
            />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12 }}
              onMouseEnter={(d) => setLineaActiva(d.value === nombrePromedio ? null : (d.value ?? null))}
              onMouseLeave={() => setLineaActiva(null)}
            />
            {/* Barra translúcida: ponderación promedio de la unidad (detrás de las curvas) */}
            <Bar
              dataKey="promedio"
              name={nombrePromedio}
              fill={HEX_PRIMARY}
              fillOpacity={0.14}
              radius={[4, 4, 0, 0]}
              barSize={16}
              legendType="rect"
              onClick={onClic}
              style={{ cursor: 'pointer' }}
            />
            {modulos.map((m, i) => (
              <Line
                key={m.modulo_id}
                type="monotone"
                dataKey={m.nombre}
                stroke={COLORES_MODULOS[i % COLORES_MODULOS.length]}
                strokeWidth={lineaActiva === m.nombre ? 4 : 2}
                connectNulls
                dot={{ r: 3, strokeWidth: 1 }}
                activeDot={{ r: 5 }}
                opacity={lineaActiva && lineaActiva !== m.nombre ? 0.3 : 1}
                onClick={onClic}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      ) : <p className="text-sm text-slate-400">{sinDatos}</p>}
    </Card>
  )
}

/**
 * Lista de promedios por unidad: la misma pieza para sucursales y para
 * departamentos, porque sólo cambia qué filas recibe y a qué unidad apunta el
 * clic. Se queda con la fila entera como objetivo para que el listado no tenga
 * que saber cómo se abre el drilldown.
 */
function ListaUnidades({
  titulo,
  descripcion,
  filas,
  sinDatos,
  onClic
}: {
  titulo: string
  descripcion: string
  filas: { nombre: string; puntaje: number | null; completadas: number }[]
  sinDatos: string
  onClic: (fila: { nombre: string }) => void
}) {
  const max = Math.max(1, ...filas.map((f) => f.puntaje ?? 0))
  return (
    <Card className="border-0!">
      <h3 className="mb-1 font-bold text-primary-900">{titulo}</h3>
      <p className="mb-3 text-xs text-slate-400">{descripcion}</p>
      {filas.length ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {filas.map((f, i) => (
            <li key={f.nombre}>
              <button
                type="button"
                onClick={() => onClic(f)}
                title={`Ver evaluaciones de ${f.nombre} en el rango seleccionado`}
                className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-primary-50/40"
              >
                <span className="w-6 shrink-0 text-center text-xs font-black tabular-nums text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{f.nombre}</span>
                  <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full transition-all duration-500"
                      style={{ width: `${((f.puntaje ?? 0) / max) * 100}%`, background: colorPuntajeHex(f.puntaje) }}
                    />
                  </span>
                </span>
                <span className="w-24 shrink-0 text-right">
                  <span className="block text-sm font-black tabular-nums text-slate-900">
                    {f.puntaje == null ? '—' : pctComa(f.puntaje)}
                  </span>
                  <span className="block text-[10px] text-slate-400">{f.completadas} {f.completadas === 1 ? 'evaluación' : 'evaluaciones'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">{sinDatos}</p>
      )}
    </Card>
  )
}

/**
 * Cumplimiento por módulo en tarjeta chica: el porcentaje manda y el nombre lo
 * acompaña. Sin el reloj de antes, que dibujaba media pantalla por módulo y
 * empujaba los listados para abajo; acá entra todo de un vistazo.
 */
function TarjetaModulo({ nombre, promedio, sub }: { nombre: string; promedio: number | null; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <span
        className="shrink-0 text-2xl font-black tabular-nums leading-none"
        style={{ color: colorPuntajeHex(promedio) }}
      >
        {promedio == null ? '—' : pctComa(promedio, 0)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-800">{nombre}</span>
        <span className="block truncate text-[11px] text-slate-400">{sub}</span>
      </span>
    </div>
  )
}

export function DashboardHome() {
  const { profile } = useAuth()
  const { sucursales, departamentos, modulos, sucursalModulos } = useCatalog()

  const scope = useMemo(() => {
    if (!profile) return null
    if (profile.rol === 'GERENTE_S' && profile.sucursal_id) return [profile.sucursal_id]
    if (verTodo(profile.rol)) return null
    return null
  }, [profile])

  const [desde, setDesde] = useState(haceMeses(6))
  const [hasta, setHasta] = useState('')
  const [sucursalSel, setSucursalSel] = useState('')
  const [moduloSel, setModuloSel] = useState('')
  const [lineaActiva, setLineaActiva] = useState<string | null>(null)
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)

  const sucursalesVisibles = scope ? sucursales.filter((s) => scope.includes(s.id)) : sucursales
  // GERENTE_S (con `scope`) solo ve su sucursal: sin departamentos, como en Historial.
  // Se memoiza: el `[]` nuevo en cada render re-dispararía los useMemo que lo usan.
  const departamentosVisibles = useMemo(() => (scope ? [] : departamentos), [scope, departamentos])

  useEffect(() => {
    let activo = true
    setCargando(true)
    void (async () => {
      try {
        const d = await consultarEvaluaciones({
          sucursal_ids: sucursalSel ? [sucursalSel] : scope,
          desde: desde || undefined,
          hasta: hasta || undefined,
          modulo_id: moduloSel || undefined,
          // Los KPIs y los promedios dicen «completadas»: una evaluación que
          // sigue abierta no cuenta como tal. Las de departamento también
          // cuentan, porque este dashboard las lista por su propio promedio.
          soloCerradas: true
        })
        if (activo) setDatos(d)
      } catch {
        if (activo) setDatos({ evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [], sucursalOpciones: [], instancias: [] })
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sucursalSel, moduloSel, scope?.join(',')])

  const sucursalesRanking = useMemo(
    () => (datos ? rankingSucursales(datos, sucursalesVisibles) : []),
    [datos, sucursalesVisibles]
  )
  const departamentosRanking = useMemo(
    () => (datos ? rankingDepartamentos(datos, departamentosVisibles) : []),
    [datos, departamentosVisibles]
  )
  const cargosRanking = useMemo(() => (datos ? rankingResponsables(datos, 20) : []), [datos])
  const matrizModulos = useMemo(
    () => (datos ? puntajePorSucursalModulo(datos, sucursalesVisibles) : null),
    [datos, sucursalesVisibles]
  )
  const modulosOrden = useMemo(() => {
    const base = datos?.modulos.map((m) => ({ modulo_id: m.id, nombre: m.nombre })) ?? []
    if (!lineaActiva) return base
    // El módulo "hovered" se dibuja al final para quedar encima de los demás (z-index dinámico).
    return [...base].sort((a, b) => (a.nombre === lineaActiva ? 1 : 0) - (b.nombre === lineaActiva ? 1 : 0))
  }, [datos, lineaActiva])

  // Drilldown (modal): alcance clickeado y sus evaluaciones filtradas.
  const [drill, setDrill] = useState<{ titulo: string; subtitulo?: string; alcance: AlcanceDrilldown; etiquetaScope?: string } | null>(null)
  const drillFilas = useMemo(
    () => (datos && drill ? renglonesDrilldown(datos, drill.alcance) : []),
    [datos, drill]
  )
  const idPorNombreSucursal = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sucursalesVisibles) m.set(s.nombre, s.id)
    return m
  }, [sucursalesVisibles])
  const idPorNombreDepartamento = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of departamentosVisibles) m.set(d.nombre, d.id)
    return m
  }, [departamentosVisibles])

  const abrirDrill = (p: { titulo: string; subtitulo?: string; alcance: AlcanceDrilldown; etiquetaScope?: string }) => setDrill(p)

  /** Nombre de la fila clickeada en el gráfico de ponderación (payload de recharts). */
  const nombreClickeado = (data: unknown): string | null => {
    const d = data as { payload?: Record<string, unknown>; unidad?: unknown } | null | undefined
    const nombre = d?.payload?.unidad ?? d?.unidad
    return typeof nombre === 'string' ? nombre : null
  }

  const abrirDrillSucursal = (data: unknown) => {
    const nombre = nombreClickeado(data)
    if (!nombre) return
    const id = idPorNombreSucursal.get(nombre)
    if (id) abrirDrill({ titulo: nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: id } })
  }

  const detalleDe = (id: string) => {
    const r = drillFilas.find((x) => x.id === id)
    return (
      <div className="space-y-3">
        {r ? (
          <DetalleEvalCabecera
            fecha={r.fecha}
            sucursal={r.sucursal}
            estado={r.estado}
            puntaje={r.puntaje}
            puntajeScope={r.puntajeScope}
            etiquetaScope={drill?.etiquetaScope}
            muestras={r.muestras}
          />
        ) : null}
        <DetalleRespuestasLista filas={datos ? detalleDeEvaluacion(datos, id, drill?.alcance ?? {}) : []} />
      </div>
    )
  }

  const incumplimientos = useMemo(() => (datos ? incumplimientosEnRango(datos) : 0), [datos])

  const kpis = useMemo(() => {
    if (!datos) return { global: null as number | null, completadas: 0, cobertura: 0, incumplimientos: 0 }
    const conPuntaje = datos.evaluaciones.filter((e) => e.puntuacion != null)
    const global = conPuntaje.length
      ? Math.round((conPuntaje.reduce((a, e) => a + (e.puntuacion ?? 0), 0) / conPuntaje.length) * 100) / 100
      : null
    const totalSuc = sucursalesVisibles.length || 1
    // Cobertura = cuántas sucursales del alcance tienen evaluación en el rango.
    // Las de departamento no son de ninguna sucursal: meter su `null` en el set
    // sumaría una "tienda" que no existe y subiría el porcentaje de mentira.
    const cubiertas = new Set(
      datos.evaluaciones.map((e) => e.sucursal_id).filter((s): s is string => !!s)
    ).size
    return {
      global,
      completadas: datos.evaluaciones.length,
      cobertura: Math.round((cubiertas / totalSuc) * 100),
      incumplimientos
    }
  }, [datos, incumplimientos, sucursalesVisibles.length])

  // Publica los KPIs a la barra global (ancho completo, debajo de la barra de navegación).
  useEffect(() => {
    setKpisGlobal(kpis)
  }, [kpis])

  // Un reloj por módulo activo: promedio de la última evaluación de cada
  // UNIDAD —sucursal o departamento— que midió ese módulo.
  const medidores = useMemo(() => {
    if (!datos) return []
    const listaModulos = modulos.filter((m) => m.activo && (!moduloSel || m.id === moduloSel))
    return medidoresPorModulo(datos, listaModulos, sucursalesVisibles, sucursalModulos, departamentosVisibles)
  }, [datos, modulos, moduloSel, sucursalesVisibles, sucursalModulos, departamentosVisibles])

  // El rótulo debajo del reloj vive en `subtituloMedidor`, compartido con el
  // dashboard del módulo: eran dos textos distintos para la misma pieza.
  // "ver detalle" va acá y no adentro, porque es propio de esta pantalla.
  return (
    <div className="space-y-6">
      <DashboardFiltersPortal>
        <FiltrosBar
          desde={desde}
          setDesde={setDesde}
          hasta={hasta}
          setHasta={setHasta}
          sucursal={sucursalSel}
          setSucursal={setSucursalSel}
          modulo={moduloSel}
          setModulo={setModuloSel}
          sucursales={sucursalesVisibles}
          modulos={modulos}
          soloSucursal={!!scope}
        />
      </DashboardFiltersPortal>

      {cargando ? (
        <div className="space-y-6">
          <Card>
            <div className="mb-4 space-y-2">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-3 w-72" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-20 overflow-hidden rounded-xl border border-slate-200">
                  <Skeleton className="w-16 rounded-none sm:w-20" />
                  <Skeleton className="flex-1 rounded-none" />
                  <Skeleton className="w-16 rounded-none sm:w-20" />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="mb-4 space-y-2">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-3 w-80" />
            </div>
            <Skeleton className="h-80 w-full" />
          </Card>
        </div>
      ) : datos ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 1. Cumplimiento por módulo: tarjeta chica, porcentaje grande a la
              izquierda y nombre a la derecha. */}
          <Card className="lg:col-span-2 border-0!">
            <h3 className="mb-1 font-bold text-primary-900">Cumplimiento por módulo</h3>
            <p className="mb-3 text-xs text-slate-400">Promedio de la última evaluación de cada sucursal con el módulo activo y de cada departamento que lo midió, en el rango seleccionado · haz clic en un módulo para ver su dashboard por ítem</p>
            {medidores.length ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {medidores.map((m) => (
                  <Link
                    key={m.modulo_id}
                    to={`/dashboard/modulo/${m.modulo_id}`}
                    title={`Ver dashboard del módulo ${m.nombre}`}
                    className="rounded-xl transition-all hover:-translate-y-0.5 hover:bg-primary-50/60 hover:shadow-md hover:ring-2 hover:ring-primary/30"
                  >
                    <TarjetaModulo
                      nombre={m.nombre}
                      promedio={m.promedio}
                      sub={`${subtituloMedidor(m)} · ver detalle`}
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Sin módulos activos.</p>
            )}
          </Card>

          {/* 2. Promedio por sucursal, en lista. */}
          <ListaUnidades
            titulo="Promedio por sucursal"
            descripcion="Puntaje de cumplimiento promedio de cada sucursal en el rango, ordenado de mayor a menor · haz clic en una fila para ver sus evaluaciones"
            filas={sucursalesRanking.map((s) => ({ nombre: s.nombre, puntaje: s.puntaje, completadas: s.completadas }))}
            sinDatos="Sin sucursales en el rango."
            onClic={(fila) => {
              const id = idPorNombreSucursal.get(fila.nombre)
              if (id) abrirDrill({ titulo: fila.nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: id } })
            }}
          />

          {/* 3. Promedio por departamento, en lista. El filtro por sucursal no
              aplica a departamentos: con la sucursal elegida quedaría vacía. */}
          {!sucursalSel && departamentosVisibles.length ? (
            <ListaUnidades
              titulo="Promedio por departamento"
              descripcion="Puntaje de cumplimiento promedio de cada departamento en el rango, ordenado de mayor a menor · haz clic en una fila para ver sus evaluaciones"
              filas={departamentosRanking.map((d) => ({ nombre: d.nombre, puntaje: d.puntaje, completadas: d.completadas }))}
              sinDatos="Sin departamentos evaluados en el rango."
              onClic={(fila) => {
                const id = idPorNombreDepartamento.get(fila.nombre)
                if (id) abrirDrill({ titulo: fila.nombre, subtitulo: 'Evaluaciones de este departamento en el rango seleccionado', alcance: { departamento_id: id } })
              }}
            />
          ) : null}

          {/* 4. Ponderación por sucursal y módulo: se conserva igual. */}
          <GraficoPonderacion
            titulo="Ponderación por sucursal y módulo"
            descripcion="Curvas por módulo con la barra translúcida del promedio por sucursal; pasa el cursor por la leyenda para elevar una curva y haz clic en una barra o punto para ver las evaluaciones de esa sucursal"
            filas={matrizModulos?.sucursales ?? []}
            modulos={modulosOrden}
            nombrePromedio="Promedio por sucursal"
            lineaActiva={lineaActiva}
            setLineaActiva={setLineaActiva}
            onClic={abrirDrillSucursal}
            sinDatos="Sin datos de módulos para mostrar en el rango."
          />

          {/* 5. Los 20 cargos con más incidencias o fallas en el rango. */}
          <Card className="lg:col-span-2 border-0!">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-primary-900">20 cargos con más incidencias</h3>
                <p className="text-xs text-slate-400">Top 20 de cargos por puntos no cumplidos en el rango · el clic abre el detalle de cada evaluación donde fallaron</p>
              </div>
            </div>
            {cargosRanking.length ? (
              <ol className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {cargosRanking.map((c, i) => (
                  <li key={`${c.responsable}-${i}`} className="flex items-center gap-3 border-b border-slate-100 py-2">
                    <span className="w-6 shrink-0 text-center text-xs font-black tabular-nums text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{c.responsable}</span>
                    <span className="shrink-0 text-right text-sm font-black tabular-nums text-amber-600">{c.puntos}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-400">Sin fallas registradas en el rango.</p>
            )}
          </Card>
        </div>
      ) : null}

      <ModalDrilldown
        open={drill != null}
        onCerrar={() => setDrill(null)}
        titulo={drill?.titulo ?? 'Detalle'}
        subtitulo={drill?.subtitulo}
        filas={drillFilas}
        renderDetalle={detalleDe}
        urlDe={(id) => `/evaluaciones/${id}`}
      />
    </div>
  )
}

function FiltrosBar(props: {
  desde: string
  setDesde: (v: string) => void
  hasta: string
  setHasta: (v: string) => void
  sucursal: string
  setSucursal: (v: string) => void
  modulo: string
  setModulo: (v: string) => void
  sucursales: { id: string; nombre: string }[]
  modulos: { id: string; nombre: string }[]
  soloSucursal: boolean
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Desde">
        <Input type="date" value={props.desde} onChange={(e) => props.setDesde(e.target.value)} />
      </Field>
      <Field label="Hasta">
        <Input type="date" value={props.hasta} onChange={(e) => props.setHasta(e.target.value)} />
      </Field>
      <Field label="Sucursal">
        <Select value={props.sucursal} onChange={(e) => props.setSucursal(e.target.value)} disabled={props.soloSucursal}>
          <option value="">Todas</option>
          {props.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
      </Field>
      <Field label="Módulo">
        <Select value={props.modulo} onChange={(e) => props.setModulo(e.target.value)}>
          <option value="">Todos</option>
          {props.modulos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </Select>
      </Field>
    </div>
  )
}
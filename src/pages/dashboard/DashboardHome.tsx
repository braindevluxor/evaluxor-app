import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import {
  consultarEvaluaciones,
  detalleDeEvaluacion,
  evolucionMensual,
  medidoresPorModulo,
  peoresItems,
  puntajePorSucursalModulo,
  rankingSucursales,
  renglonesDrilldown
} from '../../lib/data/indicadores'
import type { AlcanceDrilldown, ConjuntoDatos } from '../../lib/data/indicadores'
import { Card, Field, Input, Select, Skeleton } from '../../components/ui'
import { MedidorModulo } from '../../components/dashboard/MedidorModulo'
import { ModalDrilldown, DetalleEvalCabecera, DetalleRespuestasLista } from '../../components/dashboard/ModalDrilldown'
import { verTodo } from '../../lib/roles'
import { setKpisGlobal } from '../../lib/kpisGlobal'
import { distribuirPorcentajes, num as numFormateado, pct as pctComa } from '../../lib/numeros'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine
} from 'recharts'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

const COLORES_MODULOS = ['#28315F', '#4f87c7', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#db2777']

export function DashboardHome() {
  const { profile } = useAuth()
  const { sucursales, modulos, sucursalModulos } = useCatalog()

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
  const [verMasRanking, setVerMasRanking] = useState(false)
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)

  const sucursalesVisibles = scope ? sucursales.filter((s) => scope.includes(s.id)) : sucursales

  useEffect(() => {
    let activo = true
    setCargando(true)
    void (async () => {
      try {
        const d = await consultarEvaluaciones({
          sucursal_ids: sucursalSel ? [sucursalSel] : scope,
          desde: desde || undefined,
          hasta: hasta || undefined,
          modulo_id: moduloSel || undefined
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

  const ranking = useMemo(() => (datos ? rankingSucursales(datos, sucursalesVisibles) : []), [datos, sucursalesVisibles])
  const matrizModulos = useMemo(
    () => (datos ? puntajePorSucursalModulo(datos, sucursalesVisibles) : null),
    [datos, sucursalesVisibles]
  )
  const modulosOrden = useMemo(() => {
    const base = matrizModulos?.modulos ?? []
    if (!lineaActiva) return base
    // El módulo "hovered" se dibuja al final para quedar encima de los demás (z-index dinámico).
    return [...base].sort((a, b) => (a.nombre === lineaActiva ? 1 : 0) - (b.nombre === lineaActiva ? 1 : 0))
  }, [matrizModulos, lineaActiva])
  const peores = useMemo(() => (datos ? peoresItems(datos) : []), [datos])

  // Dona de ítems con más incumplimientos: cada ítem aporta el equivalente a evaluaciones
  // completas sin cumplir (total − ok, redondeado a entero). Sin ruido flotante.
  const donaIncumplidos = useMemo(() => {
    const items = peores
      .map((p) => ({ ...p, fallos: Math.max(0, Math.round(p.total - p.ok)) }))
      .filter((p) => p.fallos > 0)
      .sort((a, b) => b.fallos - a.fallos || a.ratio - b.ratio)
      .slice(0, 8)
    const total = items.reduce((a, b) => a + b.fallos, 0)
    const shares = distribuirPorcentajes(items.map((p) => p.fallos))
    let acum = 0
    const zonas = items.map((p) => {
      const desde = (acum / Math.max(1, total)) * 360
      acum += p.fallos
      const hasta = (acum / Math.max(1, total)) * 360
      const color = p.ratio >= 0.8 ? '#16a34a' : p.ratio >= 0.6 ? '#d97706' : '#dc2626'
      return `${color} ${desde}deg ${hasta}deg`
    })
    return { items, shares, total, fondo: total ? `conic-gradient(${zonas.join(',')})` : '#e2e8f0' }
  }, [peores])
  const evolucion = useMemo(() => (datos ? evolucionMensual(datos) : []), [datos])

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

  const abrirDrill = (p: { titulo: string; subtitulo?: string; alcance: AlcanceDrilldown; etiquetaScope?: string }) => setDrill(p)

  const abrirDrillSucursal = (data: unknown) => {
    const d = data as { payload?: Record<string, unknown>; sucursal?: unknown } | null | undefined
    const nombre = d?.payload?.sucursal ?? d?.sucursal
    if (typeof nombre !== 'string') return
    const id = idPorNombreSucursal.get(nombre)
    if (id) abrirDrill({ titulo: nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: id } })
  }

  const abrirDrillMes = (data: unknown) => {
    const d = data as { payload?: Record<string, unknown> } | null | undefined
    const key = d?.payload?.key
    const mes = d?.payload?.mes
    if (typeof key === 'string') {
      abrirDrill({
        titulo: typeof mes === 'string' ? mes : key,
        subtitulo: 'Evaluaciones de ese mes en el rango seleccionado',
        alcance: { mes: key }
      })
    }
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

  const kpis = useMemo(() => {
    if (!datos) return { global: null as number | null, completadas: 0, cobertura: 0, incumplimientos: 0 }
    const conPuntaje = datos.evaluaciones.filter((e) => e.puntuacion != null)
    const global = conPuntaje.length
      ? Math.round((conPuntaje.reduce((a, e) => a + (e.puntuacion ?? 0), 0) / conPuntaje.length) * 100) / 100
      : null
    const totalSuc = sucursalesVisibles.length || 1
    const cubiertas = new Set(datos.evaluaciones.map((e) => e.sucursal_id)).size
    return {
      global,
      completadas: datos.evaluaciones.length,
      cobertura: Math.round((cubiertas / totalSuc) * 100),
      incumplimientos: peores.reduce((a, p) => a + (p.total - p.ok), 0)
    }
  }, [datos, peores, sucursalesVisibles.length])

  // Publica los KPIs a la barra global (ancho completo, debajo de la barra de navegación).
  useEffect(() => {
    setKpisGlobal(kpis)
  }, [kpis])

  // Un reloj por módulo activo: promedio de la última evaluación de cada sucursal con ese módulo activo.
  const medidores = useMemo(() => {
    if (!datos) return []
    const listaModulos = modulos.filter((m) => m.activo && (!moduloSel || m.id === moduloSel))
    return medidoresPorModulo(datos, listaModulos, sucursalesVisibles, sucursalModulos)
  }, [datos, modulos, moduloSel, sucursalesVisibles, sucursalModulos])

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
          <Card className="lg:col-span-2 border-0!">
            <h3 className="mb-1 font-bold text-primary-900">Cumplimiento por módulo</h3>
            <p className="mb-3 text-xs text-slate-400">Promedio de la última evaluación de cada sucursal que tenga el módulo activo, en el rango seleccionado · haz clic en un módulo para ver su dashboard por ítem</p>
            {medidores.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {medidores.map((m) => (
                  <Link
                    key={m.modulo_id}
                    to={`/dashboard/modulo/${m.modulo_id}`}
                    title={`Ver dashboard del módulo ${m.nombre}`}
                    className="rounded-xl bg-slate-50/50 p-3 transition-all hover:-translate-y-0.5 hover:bg-primary-50/60 hover:shadow-lg hover:ring-2 hover:ring-primary/30"
                  >
                    <div className="mx-auto w-full max-w-[150px]">
                      <MedidorModulo
                        nombre={m.nombre}
                        valor={m.promedio}
                        sub={
                          m.sucursales
                            ? `${m.sucursales} de ${m.sucursales + m.sinDatos} sucursales · ver detalle`
                            : m.sinDatos
                              ? `${m.sinDatos} sucursales sin evaluación · ver detalle`
                              : 'Sin sucursales activas'
                        }
                      />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Sin módulos activos.</p>
            )}
          </Card>

          <Card className="lg:col-span-2 border-0!">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-primary-900">Evolución del cumplimiento global</h3>
                <p className="text-xs text-slate-400">Promedio por mes en el rango y evaluaciones completadas · haz clic en un punto o barra para ver las evaluaciones de ese mes</p>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> Cumplimiento promedio</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky-300" /> Evaluaciones completadas</span>
              </div>
            </div>
            {evolucion.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={evolucion} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <defs>
                    <linearGradient id="gradEvolucion" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#28315F" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#28315F" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis yAxisId="l" domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" width={36} tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(v, nombre) => [nombre === 'Cumplimiento %' ? pctComa(Number(v)) : String(v), String(nombre)]}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                  />
                  <Area
                    yAxisId="l"
                    type="monotone"
                    dataKey="puntaje"
                    name="Cumplimiento %"
                    stroke="#28315F"
                    strokeWidth={3}
                    fill="url(#gradEvolucion)"
                    connectNulls
                    dot={{ r: 3.5, strokeWidth: 1, fill: '#28315F' }}
                    activeDot={{ r: 5.5 }}
                    onClick={abrirDrillMes}
                  />
                  <Bar
                    yAxisId="r"
                    dataKey="completadas"
                    name="Evaluaciones completadas"
                    fill="#bae6fd"
                    radius={[4, 4, 0, 0]}
                    barSize={18}
                    onClick={abrirDrillMes}
                    style={{ cursor: 'pointer' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400">Sin evaluaciones en el rango seleccionado.</p>
            )}
          </Card>

          <Card className="lg:col-span-2 border-0!">
            <h3 className="mb-1 font-bold text-primary-900">Ranking de sucursales</h3>
            <p className="mb-3 text-xs text-slate-400">Posiciones estilo F1: puntaje de cumplimiento de cada sucursal en el rango</p>
            {ranking.length ? (
              <div
                className="bg-white p-3 sm:p-4"
                style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgb(100 116 139 / 0.12) 0 1px, transparent 1px 12px)' }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {ranking.slice(0, 3).map((r, i) => (
                    <button
                      key={r.sucursal_id}
                      type="button"
                      onClick={() => abrirDrill({ titulo: r.nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: r.sucursal_id } })}
                      className="text-left"
                      title="Ver evaluaciones de esta sucursal"
                    >
                      <TarjetaRankingF1
                        posicion={i + 1}
                        nombre={r.nombre}
                        puntaje={r.puntaje}
                      />
                    </button>
                  ))}
                </div>

                {ranking.length > 3 ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setVerMasRanking((v) => !v)}
                      className="mx-auto flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-700"
                    >
                      {verMasRanking ? 'Ocultar resto' : `Ver resto (${ranking.length - 3})`}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${verMasRanking ? 'rotate-180' : ''}`} />
                    </button>
                    {verMasRanking ? (
                      <div className="mt-3 border border-slate-200 bg-white">
                        {ranking.slice(3).map((r, i) => (
                          <button
                            key={r.sucursal_id}
                            type="button"
                            onClick={() => abrirDrill({ titulo: r.nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: r.sucursal_id } })}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-primary-50/40 ${i % 2 ? 'bg-slate-50' : ''}`}
                          >
                            <span className="w-8 shrink-0 text-center text-sm font-black tabular-nums text-slate-500">{i + 4}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{r.nombre}</span>
                            <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                              {r.puntaje == null ? '—' : `${r.puntaje} pts`}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : <p className="text-sm text-slate-400">Sin sucursales.</p>}
          </Card>

          <Card className="lg:col-span-2 border-0!">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-primary-900">Ítems con más incumplimientos</h3>
                <p className="text-xs text-slate-400">Top 8 por incumplimientos en el rango (cada ítem equivale a evaluaciones completas sin cumplir) · haz clic en uno para ver en qué evaluaciones falló</p>
              </div>
            </div>
            {donaIncumplidos.items.length ? (
              <div className="flex flex-col gap-6 md:flex-row md:items-center">
                {/* Dona: cada segmento es un ítem, su tamaño son los fallos en el rango */}
                <div className="mx-auto flex shrink-0 flex-col items-center gap-3 md:mx-0">
                  <div
                    className="relative h-44 w-44 rounded-full shadow-sm ring-1 ring-slate-200"
                    style={{ background: donaIncumplidos.fondo }}
                    title="Cada segmento es un ítem; su tamaño es la cantidad de incumplimientos equivalentes en el rango"
                  >
                    <div className="absolute inset-[14%] grid place-items-center rounded-full bg-white text-center shadow-inner">
                      <div className="min-w-0 px-2">
                        <p className="text-xl font-black tabular-nums text-slate-800">
                          {numFormateado(donaIncumplidos.total, 0)}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {donaIncumplidos.total === 1 ? 'incumplimiento' : 'incumplimientos'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-center text-[11px] text-slate-400">Top {donaIncumplidos.items.length} ítems · cada segmento es un ítem</p>
                </div>

                {/* Leyenda clickeable */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  {donaIncumplidos.items.map((p, i) => {
                    const color = p.ratio >= 0.8 ? '#16a34a' : p.ratio >= 0.6 ? '#d97706' : '#dc2626'
                    return (
                      <button
                        key={p.item_id}
                        type="button"
                        onClick={() => abrirDrill({ titulo: p.texto, subtitulo: 'Evaluaciones del rango donde este ítem quedó sin cumplir', alcance: { item_id: p.item_id, soloNoCumple: true }, etiquetaScope: 'Nivel del ítem' })}
                        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/40"
                        title="Ver evaluaciones donde falló"
                      >
                        <span className="w-5 shrink-0 text-center text-xs font-black tabular-nums text-slate-400">{i + 1}</span>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 group-hover:text-amber-900">{p.texto}</span>
                        <span className="shrink-0 text-right text-xs tabular-nums text-slate-500">
                          <b className="text-slate-800">{p.fallos} {p.fallos === 1 ? 'fallo' : 'fallos'}</b> · {donaIncumplidos.shares[i]}%
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Sin respuestas puntuables en el rango.</p>
            )}
          </Card>

          <Card className="lg:col-span-2 border-0!">
            <h3 className="mb-1 font-bold text-primary-900">Ponderación por sucursal y módulo</h3>
            <p className="mb-3 text-xs text-slate-400">Curvas por módulo con la barra translúcida del promedio por sucursal; pasa el cursor por la leyenda para elevar una curva y haz clic en una barra o punto para ver las evaluaciones de esa sucursal</p>
            {matrizModulos && matrizModulos.modulos.length && matrizModulos.sucursales.length ? (
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart
                  data={matrizModulos.sucursales.map((s) => {
                    const valores = Object.values(s.porModulo).filter((v): v is number => v != null)
                    return {
                      sucursal: s.nombre,
                      ...s.porModulo,
                      promedio: valores.length
                        ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100
                        : null
                    }
                  })}
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="sucursal" interval={0} angle={-38} textAnchor="end" height={90} tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <ReferenceLine y={80} stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <ReferenceLine y={60} stroke="#d97706" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <Tooltip
                    formatter={(v, nombre) => [pctComa(Number(v)), String(nombre)]}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                  />
                  <Legend
                    iconType="plainline"
                    wrapperStyle={{ fontSize: 12 }}
                    onMouseEnter={(d) => setLineaActiva(d.value === 'Promedio por sucursal' ? null : (d.value ?? null))}
                    onMouseLeave={() => setLineaActiva(null)}
                  />
                  {/* Barra translúcida: ponderación promedio de la sucursal (detrás de las curvas) */}
                  <Bar
                    dataKey="promedio"
                    name="Promedio por sucursal"
                    fill="#28315F"
                    fillOpacity={0.14}
                    radius={[4, 4, 0, 0]}
                    barSize={16}
                    legendType="rect"
                    onClick={abrirDrillSucursal}
                    style={{ cursor: 'pointer' }}
                  />
                  {modulosOrden.map((m, i) => (
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
                      onClick={abrirDrillSucursal}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400">Sin datos de módulos para mostrar en el rango.</p>}
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

function TarjetaRankingF1({ posicion, nombre, puntaje }: { posicion: number; nombre: string; puntaje: number | null }) {
  return (
    <div className="flex items-stretch overflow-hidden border border-slate-200 bg-white shadow-sm">
      {/* Posición */}
      <div className="flex w-16 shrink-0 items-center justify-center bg-red-600 sm:w-20">
        <span className="text-2xl font-black text-white sm:text-3xl">{posicion}</span>
      </div>

      {/* Sucursal */}
      <div className="flex min-w-0 flex-1 items-center justify-center bg-slate-900 px-3 py-2.5 text-white sm:px-4">
        <p className="truncate text-xs font-black uppercase tracking-wide text-white sm:text-sm">{nombre}</p>
      </div>

      {/* Puntaje */}
      <div className="flex w-16 shrink-0 items-center justify-center bg-amber-400 sm:w-20">
        <span className="text-2xl font-black text-slate-900 sm:text-3xl">{puntaje == null ? '—' : puntaje}</span>
      </div>
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
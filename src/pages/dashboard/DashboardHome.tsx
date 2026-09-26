import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { consultarEvaluaciones, medidoresPorModulo, peoresItems, puntajePorSucursalModulo, rankingSucursales } from '../../lib/data/indicadores'
import type { ConjuntoDatos } from '../../lib/data/indicadores'
import { Card, Field, Input, Select, Skeleton } from '../../components/ui'
import { MedidorModulo } from '../../components/dashboard/MedidorModulo'
import { verTodo } from '../../lib/roles'
import { setKpisGlobal } from '../../lib/kpisGlobal'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend
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
            <p className="mb-3 text-xs text-slate-400">Promedio de la última evaluación de cada sucursal que tenga el módulo activo, en el rango seleccionado</p>
            {medidores.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {medidores.map((m) => (
                  <div key={m.modulo_id} className="rounded-xl bg-slate-50/50 p-3">
                    <div className="mx-auto w-full max-w-[150px]">
                      <MedidorModulo
                        nombre={m.nombre}
                        valor={m.promedio}
                        sub={
                          m.sucursales
                            ? `${m.sucursales} de ${m.sucursales + m.sinDatos} sucursales`
                            : m.sinDatos
                              ? `${m.sinDatos} sucursales sin evaluación`
                              : 'Sin sucursales activas'
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Sin módulos activos.</p>
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
                    <TarjetaRankingF1
                      key={r.sucursal_id}
                      posicion={i + 1}
                      nombre={r.nombre}
                      puntaje={r.puntaje}
                    />
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
                          <div key={r.sucursal_id} className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 ? 'bg-slate-50' : ''}`}>
                            <span className="w-8 shrink-0 text-center text-sm font-black tabular-nums text-slate-500">{i + 4}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{r.nombre}</span>
                            <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                              {r.puntaje == null ? '—' : `${r.puntaje} pts`}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : <p className="text-sm text-slate-400">Sin sucursales.</p>}
          </Card>

          <Card className="lg:col-span-2 border-0!">
            <h3 className="mb-1 font-bold text-primary-900">Ponderación por sucursal y módulo</h3>
            <p className="mb-3 text-xs text-slate-400">Curvas por módulo con la barra translúcida del promedio por sucursal; pasa el cursor por la leyenda para elevar una curva</p>
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
                  <Tooltip
                    formatter={(v, nombre) => [`${v}%`, String(nombre)]}
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
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400">Sin datos de módulos para mostrar en el rango.</p>}
          </Card>
        </div>
      ) : null}
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
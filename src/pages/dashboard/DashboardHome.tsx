import { useEffect, useMemo, useState } from 'react'
import { Target, CheckCircle2, Store, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { consultarEvaluaciones, peoresItems, puntajePorModulo, rankingSucursales } from '../../lib/data/indicadores'
import type { ConjuntoDatos } from '../../lib/data/indicadores'
import { KpiCard } from '../../components/dashboard/Kpi'
import { Card, Field, Input, Puntaje, Select, Spinner } from '../../components/ui'
import { verTodo } from '../../lib/roles'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

const RADAR_COLOR = '#ef4444'

export function DashboardHome() {
  const { profile } = useAuth()
  const { sucursales, modulos } = useCatalog()

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
        if (activo) setDatos({ evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [], sucursalOpciones: [] })
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sucursalSel, moduloSel, scope?.join(',')])

  const ranking = useMemo(() => (datos ? rankingSucursales(datos, sucursalesVisibles) : []), [datos, sucursalesVisibles])
  const porModulo = useMemo(() => (datos ? puntajePorModulo(datos) : []), [datos])
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-primary-900">Indicadores de gestión</h2>
          <p className="text-sm text-slate-500">Desempeño de las evaluaciones 360</p>
        </div>
        {profile?.rol === 'LIDER' || profile?.rol === 'GERENTE_C' || profile?.rol === 'GERENTE_TH' ? (
          <div className="flex gap-2">
            <LabelBtn activo={desde === haceMeses(3)} onClick={() => setDesde(haceMeses(3))}>3m</LabelBtn>
            <LabelBtn activo={desde === haceMeses(6)} onClick={() => setDesde(haceMeses(6))}>6m</LabelBtn>
            <LabelBtn activo={desde === haceMeses(12)} onClick={() => setDesde(haceMeses(12))}>12m</LabelBtn>
            <LabelBtn activo={desde === ''} onClick={() => setDesde('')}>Todo</LabelBtn>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard titulo="Cumplimiento global" valor={<Puntaje value={kpis.global} className="text-3xl text-white" />} icono={<Target className="h-4 w-4" />} />
        <KpiCard titulo="Evaluaciones completadas" valor={kpis.completadas} icono={<CheckCircle2 className="h-4 w-4" />} color="bg-slate-800 text-white" />
        <KpiCard titulo="Cobertura de sucursales" valor={`${kpis.cobertura}%`} icono={<Store className="h-4 w-4" />} color="bg-green-700 text-white" />
        <KpiCard titulo="Ítems incumplidos" valor={kpis.incumplimientos} icono={<AlertTriangle className="h-4 w-4" />} color="bg-red-600 text-white" />
      </div>

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

      {cargando ? (
        <div className="flex justify-center py-20"><Spinner className="h-10 w-10" /></div>
      ) : datos ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <h3 className="mb-1 font-bold text-primary-900">Ranking de sucursales</h3>
            <p className="mb-3 text-xs text-slate-400">Todas las sucursales, con o sin evaluaciones en el rango</p>
            {ranking.length ? (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={ranking} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="nombre" interval={0} angle={-38} textAnchor="end" height={90} tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v, _n, item) => {
                      const d = item?.payload as { puntaje?: number | null; completadas?: number }
                      return [`${v}%`, d?.puntaje == null ? `Sin evaluaciones (${d?.completadas ?? 0})` : 'Cumplimiento']
                    }}
                  />
                  <Bar dataKey="puntaje" radius={[6, 6, 0, 0]}>
                    {ranking.map((r, i) => (
                      <Cell key={r.sucursal_id} fill={r.puntaje == null ? '#e2e8f0' : i === 0 ? '#16a34a' : i === 1 ? '#0B2545' : '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400">Sin sucursales.</p>}
          </Card>

          <Card className="lg:col-span-2">
            <h3 className="mb-3 font-bold text-primary-900">Gráfico radial (o diagrama de araña)</h3>
            {porModulo.length >= 3 ? (
              <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={porModulo.map((m) => ({ categoria: m.nombre, valor: m.puntaje ?? 0 }))} cx="50%" cy="50%" outerRadius="75%">
                    <PolarGrid gridType="polygon" stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="categoria" tick={{ fontSize: 11, fill: '#334155' }} />
                    <PolarRadiusAxis
                      type="number"
                      domain={[0, 100]}
                      ticks={[0, 20, 40, 60, 80, 100]}
                      tickFormatter={(v) => String(Math.round(Number(v) / 20))}
                      axisLine={false}
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                    />
                    <Tooltip formatter={(v) => [`${v}%`, 'Cumplimiento']} />
                    <Radar dataKey="valor" stroke={RADAR_COLOR} fill={RADAR_COLOR} fillOpacity={0.25} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {porModulo.map((m) => (
                    <div key={m.modulo_id} className="flex items-center gap-2 text-sm">
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: RADAR_COLOR }} />
                      <span className="font-medium text-slate-700">{m.nombre}</span>
                      <span className="ml-auto pl-4 font-bold text-primary-900">{m.puntaje != null ? `${m.puntaje}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-sm text-slate-400">Se necesitan al menos 3 módulos con datos.</p>}
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function LabelBtn({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${activo ? 'bg-primary text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
    >
      {children}
    </button>
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
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { consultarEvaluaciones, evolucionMensual, peoresItems, puntajePorModulo, rankingSucursales } from '../../lib/data/indicadores'
import { valorBinario } from '../../lib/scoring'
import type { ConjuntoDatos } from '../../lib/data/indicadores'
import { KpiCard } from '../../components/dashboard/Kpi'
import { Fotogaleria } from '../../components/dashboard/Fotogaleria'
import { Card, Field, Input, Puntaje, Select, Spinner, Badge } from '../../components/ui'
import { verTodo } from '../../lib/roles'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Line, ComposedChart, Cell
} from 'recharts'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

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
        if (activo) setDatos({ evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [] })
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sucursalSel, moduloSel, scope?.join(',')])

  const ranking = useMemo(() => (datos ? rankingSucursales(datos) : []), [datos])
  const serie = useMemo(() => (datos ? evolucionMensual(datos) : []), [datos])
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
        <KpiCard titulo="Cumplimiento global" valor={<Puntaje value={kpis.global} className="text-3xl text-white" />} icono="🎯" />
        <KpiCard titulo="Evaluaciones completadas" valor={kpis.completadas} icono="✅" color="bg-slate-800 text-white" />
        <KpiCard titulo="Cobertura de sucursales" valor={`${kpis.cobertura}%`} icono="🏬" color="bg-green-700 text-white" />
        <KpiCard titulo="Ítems incumplidos" valor={kpis.incumplimientos} icono="⚠️" color="bg-red-600 text-white" />
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
      ) : !datos || datos.evaluaciones.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-lg font-bold text-primary-900">Sin datos en el rango seleccionado</p>
            <p className="text-sm text-slate-500">Ajusta los filtros o espera a que se sincronicen evaluaciones.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <h3 className="mb-3 font-bold text-primary-900">Evolución del cumplimiento</h3>
            {serie.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" />
                  <YAxis yAxisId="l" domain={[0, 100]} />
                  <YAxis yAxisId="r" orientation="right" />
                  <Tooltip />
                  <Line yAxisId="l" type="monotone" dataKey="puntaje" name="Cumplimiento %" stroke="#0B2545" strokeWidth={3} dot={{ r: 4 }} />
                  <Bar yAxisId="r" dataKey="completadas" name="Completadas" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400">Sin meses con datos.</p>}
          </Card>

          <Card>
            <h3 className="mb-3 font-bold text-primary-900">Ranking de sucursales</h3>
            {ranking.length ? (
              <ResponsiveContainer width="100%" height={Math.max(200, ranking.length * 42)}>
                <BarChart data={ranking} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis type="category" dataKey="nombre" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Cumplimiento']} />
                  <Bar dataKey="puntaje" radius={[0, 6, 6, 0]}>
                    {ranking.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#16a34a' : i === 1 ? '#0B2545' : '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400">Sin datos.</p>}
          </Card>

          <Card>
            <h3 className="mb-3 font-bold text-primary-900">Resultado por módulo</h3>
            {porModulo.length ? (
              <ResponsiveContainer width="100%" height={Math.max(160, porModulo.length * 36)}>
                <BarChart data={porModulo} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis type="category" dataKey="nombre" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Cumplimiento']} />
                  <Bar dataKey="puntaje" fill="#1D4ED8" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400">Sin datos.</p>}
          </Card>

          <Card className="lg:col-span-2">
            <h3 className="mb-3 font-bold text-primary-900">Matriz módulo × sucursal</h3>
            <MatrizTabla datos={datos} />
          </Card>

          <Card>
            <h3 className="mb-3 font-bold text-primary-900">Alertas: ítems con menor cumplimiento</h3>
            <div className="space-y-2">
              {peores.length ? peores.slice(0, 6).map((p) => (
                <div key={p.item_id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">{p.texto}</p>
                    <p className="text-xs text-slate-400">{p.ok} de {p.total} cumplen</p>
                  </div>
                  <Badge color={p.ratio > 0.6 ? 3 : 4}>{Math.round(p.ratio * 100)}%</Badge>
                </div>
              )) : <p className="text-sm text-slate-400">No hay datos binarios todavía.</p>}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 font-bold text-primary-900">Últimas evidencias fotográficas</h3>
            <Fotogaleria fotos={datos.fotos} />
          </Card>
        </div>
      )}
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

function MatrizTabla({ datos }: { datos: ConjuntoDatos }) {
  const modulos = datos.modulos
  const sucursales = Array.from(new Set(datos.evaluaciones.map((e) => e.sucursal_id)))
  const nombres: Record<string, string> = {}
  for (const ev of datos.evaluaciones) nombres[ev.sucursal_id] = ev.sucursal?.nombre ?? ev.sucursal_id

  const celdas: Record<string, Record<string, { ok: number; n: number }>> = {}
  for (const ev of datos.evaluaciones) {
    for (const r of datos.respuestas.filter((x) => x.evaluacion_id === ev.id)) {
      const item = datos.items.find((i) => i.id === r.item_id)
      if (!item) continue
      const bin = valorBinario(item, r.valor)
      if (bin === null) continue
      const c = celdas[ev.sucursal_id]?.[item.modulo_id] ?? { ok: 0, n: 0 }
      c.n++
      if (bin) c.ok++
      if (!celdas[ev.sucursal_id]) celdas[ev.sucursal_id] = {}
      celdas[ev.sucursal_id][item.modulo_id] = c
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="py-2 pr-4">Sucursal</th>
            {modulos.map((m) => <th key={m.id} className="px-2 py-2">{m.nombre}</th>)}
          </tr>
        </thead>
        <tbody>
          {sucursales.map((suc) => (
            <tr key={suc} className="border-t border-slate-100">
              <td className="py-2 pr-4 font-medium text-slate-700">{nombres[suc]}</td>
              {modulos.map((m) => {
                const c = celdas[suc]?.[m.id]
                const pct = c && c.n ? (c.ok / c.n) * 100 : null
                return (
                  <td key={m.id} className="px-2 py-2">
                    <span
                      className="inline-flex min-w-[52px] items-center justify-center rounded-lg px-2 py-1 text-xs font-bold text-white"
                      style={{ backgroundColor: colorPct(pct) }}
                    >
                      {pct == null ? '—' : `${Math.round(pct)}%`}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function colorPct(pct: number | null): string {
  if (pct == null) return '#e2e8f0'
  if (pct >= 80) return '#16a34a'
  if (pct >= 60) return '#d97706'
  return '#dc2626'
}
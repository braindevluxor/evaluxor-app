import { useEffect, useMemo, useState } from 'react'
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { consultarEvaluaciones, detalleDeEvaluacion, evolucionMensual, porEvaluador, renglonesDrilldown } from '../../lib/data/indicadores'
import type { AlcanceDrilldown, ConjuntoDatos } from '../../lib/data/indicadores'
import { Card, Field, Input, Select, Skeleton } from '../../components/ui'
import { ModalDrilldown, DetalleEvalCabecera, DetalleRespuestasLista } from '../../components/dashboard/ModalDrilldown'
import { pct as pctComa } from '../../lib/numeros'
import { BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ComposedChart, Legend, Cell, ReferenceLine } from 'recharts'

type Dimension = 'evaluador' | 'mes' | 'sucursal'
type Metrica = 'puntaje' | 'completadas'

const COLORES = ['#0B2545', '#1D4ED8', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#f59e0b']

export function Comparativas() {
  const { profile } = useAuth()
  const { sucursales } = useCatalog()
  const scope = profile?.rol === 'GERENTE_S' && profile.sucursal_id ? [profile.sucursal_id] : null

  const [dimension, setDimension] = useState<Dimension>('evaluador')
  const [metrica, setMetrica] = useState<Metrica>('puntaje')
  const [desde, setDesde] = useState(haceMeses(6))
  const [hasta, setHasta] = useState('')
  const [sucursalSel, setSucursalSel] = useState('')
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [drill, setDrill] = useState<{ titulo: string; subtitulo?: string; alcance: AlcanceDrilldown } | null>(null)

  useEffect(() => {
    let activo = true
    setCargando(true)
    void (async () => {
      try {
        const d = await consultarEvaluaciones({
          sucursal_ids: sucursalSel ? [sucursalSel] : scope,
          desde: desde || undefined,
          hasta: hasta || undefined
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
  }, [dimension, metrica, desde, hasta, sucursalSel, scope?.join(',')])

  const datosComparados = useMemo(() => {
    if (!datos) return []
    if (dimension === 'evaluador') {
      return porEvaluador(datos).map((e) => ({ nombre: e.nombre, puntaje: e.puntaje, completadas: e.evaluaciones, key: e.nombre }))
    }
    if (dimension === 'mes') {
      return evolucionMensual(datos).map((s) => ({ nombre: s.mes, puntaje: s.puntaje, completadas: s.completadas, key: s.key }))
    }
    const porSuc = new Map<string, { nombre: string; puntajes: (number | null)[]; completadas: number }>()
    for (const ev of datos.evaluaciones) {
      // La dimensión es por sucursal: las evaluaciones de departamento no tienen
      // sucursal y quedan fuera de este gráfico (las cubre la dimensión por mes).
      if (!ev.sucursal_id) continue
      const puntaje = ev.puntuacion
      const s = porSuc.get(ev.sucursal_id)
      if (s) {
        s.puntajes.push(puntaje)
        s.completadas++
      } else {
        porSuc.set(ev.sucursal_id, { nombre: ev.sucursal?.nombre ?? ev.sucursal_id, puntajes: [puntaje], completadas: 1 })
      }
    }
    return Array.from(porSuc.values()).map((s) => {
      const validos = s.puntajes.filter((p): p is number => p != null)
      return {
        nombre: s.nombre,
        puntaje: validos.length ? Math.round((validos.reduce((a, b) => a + b, 0) / validos.length) * 100) / 100 : null,
        completadas: s.completadas,
        key: s.nombre
      }
    })
  }, [datos, dimension])

  const datosF = datosComparados as { nombre: string; puntaje: number | null; completadas: number; key: string }[]

  const altura = Math.max(220, (dimension === 'evaluador' || dimension === 'sucursal' ? datosF.length * 44 : 60))

  // Drilldown (modal): mapas por dimensión + alcance clickeado.
  const mapas = useMemo(() => {
    const idPorNombreSuc = new Map<string, string>()
    const idPorEvaluador = new Map<string, string>()
    for (const ev of datos?.evaluaciones ?? []) {
      if (ev.sucursal_id) idPorNombreSuc.set(ev.sucursal?.nombre ?? ev.sucursal_id, ev.sucursal_id)
      const n = ev.aperturador?.nombre ?? 'Sin nombre'
      if (!idPorEvaluador.has(n)) idPorEvaluador.set(n, ev.aperturada_por || ev.id)
    }
    return { idPorNombreSuc, idPorEvaluador }
  }, [datos])

  const drillFilas = useMemo(
    () => (datos && drill ? renglonesDrilldown(datos, drill.alcance) : []),
    [datos, drill]
  )

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
            etiquetaScope="Puntaje global"
            muestras={r.muestras}
          />
        ) : null}
        <DetalleRespuestasLista filas={datos ? detalleDeEvaluacion(datos, id, drill?.alcance ?? {}) : []} />
      </div>
    )
  }

  const abrirDesdeGrafico = (data: unknown) => {
    const d = data as { payload?: Record<string, unknown> } | null | undefined
    const nombre = d?.payload?.nombre
    if (typeof nombre !== 'string') return
    if (dimension === 'mes') {
      const key = d?.payload?.key
      if (typeof key === 'string') {
        setDrill({ titulo: nombre, subtitulo: 'Evaluaciones de ese mes en el rango seleccionado', alcance: { mes: key } })
      }
    } else if (dimension === 'sucursal') {
      const id = mapas.idPorNombreSuc.get(nombre)
      if (id) setDrill({ titulo: nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: id } })
    } else {
      const id = mapas.idPorEvaluador.get(nombre)
      if (id) setDrill({ titulo: nombre, subtitulo: 'Evaluaciones aperturadas por este evaluador en el rango', alcance: { evaluador_id: id } })
    }
  }

  return (
    <div className="space-y-6">
      <DashboardFiltersPortal>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Comparar por">
            <Select value={dimension} onChange={(e) => setDimension(e.target.value as Dimension)}>
              <option value="evaluador">Evaluador</option>
              <option value="sucursal">Sucursal</option>
              <option value="mes">Mes</option>
            </Select>
          </Field>
          <Field label="Métrica">
            <Select value={metrica} onChange={(e) => setMetrica(e.target.value as Metrica)}>
              <option value="puntaje">Cumplimiento %</option>
              <option value="completadas">Evaluaciones completadas</option>
            </Select>
          </Field>
          <Field label="Desde">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          <Field label="Sucursal">
            <Select value={sucursalSel} onChange={(e) => setSucursalSel(e.target.value)} disabled={!!scope}>
              <option value="">Todas</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Select>
          </Field>
        </div>
      </DashboardFiltersPortal>

      {cargando ? (
        <Card>
          <div className="mb-4 space-y-2">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-80 w-full" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-3 w-3/4" />)}
          </div>
        </Card>
      ) : !datosF.length ? (
        <Card><div className="py-10 text-center text-slate-500">Sin datos en el rango seleccionado.</div></Card>
      ) : (
        <Card>
          <h3 className="mb-3 font-bold text-primary-900">
            {metrica === 'puntaje' ? 'Cumplimiento promedio' : 'Evaluaciones completadas'} por {labelDim(dimension)}
          </h3>
          {metrica === 'puntaje' && dimension !== 'mes' ? (
            <ResponsiveContainer width="100%" height={altura}>
              <BarChart data={datosF} layout="vertical" margin={{ left: 16, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis type="category" dataKey="nombre" width={140} tick={{ fontSize: 11 }} />
                <ReferenceLine x={80} stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.4} />
                <ReferenceLine x={60} stroke="#d97706" strokeDasharray="4 4" strokeOpacity={0.4} />
                <Tooltip
                  formatter={(v) => [v == null ? '—' : pctComa(Number(v)), 'Cumplimiento']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                  cursor={{ fill: 'rgba(40,49,95,0.06)' }}
                />
                <Bar dataKey="puntaje" radius={[0, 6, 6, 0]} onClick={abrirDesdeGrafico} activeBar={{ fillOpacity: 0.8 }}>
                  {datosF.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : dimension === 'mes' ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={datosF}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                <ReferenceLine yAxisId="l" y={80} stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.4} />
                <Tooltip
                  formatter={(v, nombre) => [nombre === 'Cumplimiento %' ? pctComa(Number(v)) : String(v), String(nombre)]}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                  cursor={{ fill: 'rgba(40,49,95,0.06)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="l" type="monotone" dataKey="puntaje" name="Cumplimiento %" stroke="#0B2545" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 5.5 }} onClick={abrirDesdeGrafico} style={{ cursor: 'pointer' }} />
                <Bar yAxisId="r" dataKey="completadas" name="Completadas" fill="#93c5fd" radius={[4, 4, 0, 0]} onClick={abrirDesdeGrafico} style={{ cursor: 'pointer' }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={altura}>
              <BarChart data={datosF}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                  cursor={{ fill: 'rgba(40,49,95,0.06)' }}
                />
                <Bar dataKey="completadas" name="Completadas" radius={[6, 6, 0, 0]} maxBarSize={56} onClick={abrirDesdeGrafico} activeBar={{ fillOpacity: 0.8 }}>
                  {datosF.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}

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

function labelDim(d: Dimension): string {
  return d === 'evaluador' ? 'evaluador' : d === 'mes' ? 'mes' : 'sucursal'
}

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}
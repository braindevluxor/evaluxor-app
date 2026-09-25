import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { consultarEvaluaciones, evolucionMensual, porEvaluador } from '../../lib/data/indicadores'
import type { ConjuntoDatos } from '../../lib/data/indicadores'
import { Card, Field, Input, Select, Spinner } from '../../components/ui'
import { BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ComposedChart, Legend, Cell } from 'recharts'

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
      return evolucionMensual(datos).map((s) => ({ nombre: s.mes, puntaje: s.puntaje, completadas: s.completadas, key: s.mes }))
    }
    const porSuc = new Map<string, { nombre: string; puntajes: (number | null)[]; completadas: number }>()
    for (const ev of datos.evaluaciones) {
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-primary-900">Comparativas</h2>
        <p className="text-sm text-slate-500">Analiza el desempeño por evaluador, mes o sucursal</p>
      </div>

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

      {cargando ? (
        <div className="flex justify-center py-20"><Spinner size={40} /></div>
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
                <Tooltip formatter={(v) => [`${v}%`, 'Cumplimiento']} />
                <Bar dataKey="puntaje" radius={[0, 6, 6, 0]}>
                  {datosF.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : dimension === 'mes' ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={datosF}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="nombre" />
                <YAxis yAxisId="l" domain={[0, 100]} />
                <YAxis yAxisId="r" orientation="right" />
                <Tooltip />
                <Legend />
                <Line yAxisId="l" type="monotone" dataKey="puntaje" name="Cumplimiento %" stroke="#0B2545" strokeWidth={3} dot={{ r: 4 }} />
                <Bar yAxisId="r" dataKey="completadas" name="Completadas" fill="#93c5fd" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={altura}>
              <BarChart data={datosF}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="completadas" name="Completadas" radius={[6, 6, 0, 0]}>
                  {datosF.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}
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
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, FileDown, History, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { consultarEvaluaciones, eliminarEvaluacion } from '../../lib/data/indicadores'
import type { VistaEvaluacion } from '../../lib/types'
import { descargarPdf } from '../../lib/pdf'
import { puedeConfigurar, verTodo } from '../../lib/roles'
import { Badge, Button, Card, Confirmar, Field, Input, Puntaje, Select, Spinner } from '../../components/ui'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

export function Historial() {
  const { profile } = useAuth()
  const { sucursales } = useCatalog()

  const scope = useMemo(() => {
    if (!profile) return null
    if (profile.rol === 'GERENTE_S' && profile.sucursal_id) return [profile.sucursal_id]
    if (verTodo(profile.rol)) return null
    return null
  }, [profile])

  const [desde, setDesde] = useState(haceMeses(6))
  const [hasta, setHasta] = useState('')
  const [sucursalSel, setSucursalSel] = useState('')
  const [evals, setEvals] = useState<VistaEvaluacion[] | null>(null)
  const [descargando, setDescargando] = useState<string | null>(null)
  const [aEliminar, setAEliminar] = useState<VistaEvaluacion | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sucursalesVisibles = scope ? sucursales.filter((s) => scope.includes(s.id)) : sucursales

  useEffect(() => {
    let activo = true
    setEvals(null)
    void (async () => {
      try {
        const d = await consultarEvaluaciones({
          sucursal_ids: sucursalSel ? [sucursalSel] : scope,
          desde: desde || undefined,
          hasta: hasta || undefined
        })
        if (activo) setEvals(d.evaluaciones)
      } catch {
        if (activo) setEvals([])
      }
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sucursalSel, scope?.join(',')])

  const descargar = async (ev: VistaEvaluacion) => {
    setError(null)
    setDescargando(ev.id)
    try {
      await descargarPdf(ev.id)
    } catch {
      setError('No se pudo generar el PDF. Intenta de nuevo en unos segundos.')
    }
    setDescargando(null)
  }

  const eliminar = async () => {
    if (!aEliminar) return
    setError(null)
    const id = aEliminar.id
    try {
      await eliminarEvaluacion(id)
      setEvals((prev) => (prev ? prev.filter((e) => e.id !== id) : prev))
      setAEliminar(null)
    } catch {
      setError('No se pudo eliminar la evaluación.')
      setAEliminar(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-extrabold text-primary-900">
          <History className="h-5 w-5" /> Historial de evaluaciones
        </h2>
        <p className="text-sm text-slate-500">Todas las evaluaciones enviadas y sus resultados</p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Desde">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Field>
        <Field label="Sucursal">
          <Select value={sucursalSel} onChange={(e) => setSucursalSel(e.target.value)} disabled={!!scope}>
            <option value="">Todas</option>
            {sucursalesVisibles.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </Select>
        </Field>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {evals === null ? (
        <div className="flex justify-center py-20"><Spinner className="h-10 w-10" /></div>
      ) : evals.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-lg font-bold text-primary-900">Sin evaluaciones en el rango</p>
            <p className="text-sm text-slate-500">Ajusta los filtros o espera a que se sincronicen evaluaciones.</p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-400">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Sucursal</th>
                  <th className="px-4 py-3">Evaluador</th>
                  <th className="px-4 py-3 text-right">Puntaje</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {evals.map((ev) => (
                  <tr key={ev.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {new Date(`${ev.fecha}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-primary-900">{ev.sucursal?.nombre ?? 'Sucursal'}</p>
                      {ev.sucursal?.direccion ? <p className="text-xs text-slate-400">{ev.sucursal.direccion}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{ev.evaluador?.nombre ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Puntaje value={ev.puntuacion} />
                        <Badge color={ev.puntuacion != null && ev.puntuacion >= 80 ? 2 : ev.puntuacion != null && ev.puntuacion >= 60 ? 3 : 4}>
                          {ev.puntuacion != null ? (ev.puntuacion >= 80 ? 'Cumple' : ev.puntuacion >= 60 ? 'Riesgo' : 'No cumple') : 'Sin puntaje'}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/evaluaciones/${ev.id}`}
                          className="inline-flex min-h-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                          <Eye className="h-4 w-4" /> Ver
                        </Link>
                        <Button
                          variant="secondary"
                          className="min-h-0 gap-1.5 px-3 py-1.5"
                          disabled={descargando === ev.id}
                          onClick={() => void descargar(ev)}
                        >
                          {descargando === ev.id ? <Spinner className="h-4 w-4" /> : <FileDown className="h-4 w-4" />}
                          {descargando === ev.id ? 'Generando…' : 'PDF'}
                        </Button>
                        {puedeConfigurar(profile?.rol ?? 'SIN_ROL') ? (
                          <button
                            onClick={() => setAEliminar(ev)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Eliminar evaluación"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Confirmar
        open={aEliminar != null}
        texto={`¿Eliminar la evaluación de ${aEliminar?.sucursal?.nombre ?? 'esta sucursal'} (${aEliminar?.evaluador?.nombre ?? '…'})? Se borrarán sus respuestas y fotografías.`}
        onConfirm={() => void eliminar()}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  )
}
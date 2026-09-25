import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, Eye, FileDown, History, Lock, Pencil, Play, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import {
  consultarEvaluaciones,
  eliminarEvaluacion,
  crearEvaluacion,
  abrirEvaluacion,
  cerrarEvaluacion,
  obtenerEvaluacion,
  resumirEvaluacion
} from '../../lib/data/indicadores'
import type { EstadoEvaluacion, VistaEvaluacion } from '../../lib/types'
import { descargarPdf } from '../../lib/pdf'
import { verTodo } from '../../lib/roles'
import { Badge, Button, Card, Confirmar, Field, Input, Puntaje, Select, Skeleton, SkeletonFilas, Spinner } from '../../components/ui'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

const COLOR_ESTADO: Record<EstadoEvaluacion, number> = {
  PROGRAMADA: 4,
  ACTIVA: 2,
  CERRADA: 3
}

const ETIQUETA_ESTADO: Record<EstadoEvaluacion, string> = {
  PROGRAMADA: 'Programada',
  ACTIVA: 'Activa',
  CERRADA: 'Cerrada'
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

  const esLider = profile?.rol === 'LIDER'

  const [desde, setDesde] = useState(haceMeses(6))
  const [hasta, setHasta] = useState('')
  const [sucursalSel, setSucursalSel] = useState('')
  const [evals, setEvals] = useState<VistaEvaluacion[] | null>(null)
  const [descargando, setDescargando] = useState<string | null>(null)
  const [aEliminar, setAEliminar] = useState<VistaEvaluacion | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Apertura / programación
  const [sucursalAbrir, setSucursalAbrir] = useState('')
  const [fechaAbrir, setFechaAbrir] = useState(new Date().toISOString().slice(0, 10))
  const [gestionando, setGestionando] = useState(false)

  const sucursalesVisibles = scope ? sucursales.filter((s) => scope.includes(s.id)) : sucursales

  const cargar = async () => {
    setEvals(null)
    try {
      const d = await consultarEvaluaciones({
        sucursal_ids: sucursalSel ? [sucursalSel] : scope,
        desde: desde || undefined,
        hasta: hasta || undefined
      })
      setEvals(d.evaluaciones)
    } catch {
      setEvals([])
    }
  }

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

  const hoy = new Date().toISOString().slice(0, 10)

  const aperturar = async () => {
    if (!profile || !sucursalAbrir || !fechaAbrir) {
      setError('Selecciona la sucursal y la fecha.')
      return
    }
    setError(null)
    setGestionando(true)
    try {
      const esHoy = fechaAbrir === hoy
      await crearEvaluacion({
        sucursal_id: sucursalAbrir,
        fecha: fechaAbrir,
        estado: esHoy ? 'ACTIVA' : 'PROGRAMADA',
        aperturada_por: profile.id
      })
      setSucursalAbrir('')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la evaluación.')
    }
    setGestionando(false)
  }

  const abrir = async (ev: VistaEvaluacion) => {
    setError(null)
    setGestionando(true)
    try {
      await abrirEvaluacion(ev.id)
      await cargar()
    } catch {
      setError('No se pudo abrir la evaluación.')
    }
    setGestionando(false)
  }

  const cerrar = async (ev: VistaEvaluacion) => {
    setError(null)
    setGestionando(true)
    try {
      const det = await obtenerEvaluacion(ev.id)
      const puntaje = det ? resumirEvaluacion(det.evaluacion, det.respuestas, det.items, det.sucursalOpciones).puntaje : ev.puntuacion
      const comentario = window.prompt('Comentario de cierre (opcional):', '') ?? ''
      await cerrarEvaluacion(ev.id, puntaje, comentario.trim() || null)
      await cargar()
    } catch {
      setError('No se pudo cerrar la evaluación.')
    }
    setGestionando(false)
  }

  const activas = useMemo(() => evals?.filter((e) => e.estado === 'ACTIVA').length ?? 0, [evals])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-extrabold text-primary-900">
          <History className="h-5 w-5" /> Historial de evaluaciones
        </h2>
        <p className="text-sm text-slate-500">
          El Lider apertura/programa la evaluación; los evaluadores llenan sus módulos en la misma evaluación.
        </p>
      </div>

      {esLider ? (
        <Card>
          <div className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary" />
            <h3 className="font-bold text-primary-900">Aperturar evaluación</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Si la fecha es de hoy la evaluación queda <b>Activa</b> para que los evaluadores llenen; si es futura queda <b>Programada</b>. Una por sucursal y fecha.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Sucursal">
              <Select value={sucursalAbrir} onChange={(e) => setSucursalAbrir(e.target.value)} disabled={!!scope}>
                <option value="">Selecciona…</option>
                {sucursalesVisibles.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Fecha">
              <Input type="date" value={fechaAbrir} onChange={(e) => setFechaAbrir(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" className="w-full" disabled={gestionando || !sucursalAbrir} onClick={() => void aperturar()}>
                {gestionando ? 'Guardando…' : fechaAbrir === hoy ? 'Aperturar ahora' : 'Programar'}
              </Button>
            </div>
          </div>
          {activas > 0 ? (
            <p className="mt-2 text-xs font-medium text-green-600">
              Hay {activas} evaluación(es) activa(s) en el rango mostrado.
            </p>
          ) : null}
        </Card>
      ) : null}

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
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="p-4">
            <SkeletonFilas n={6} />
          </div>
        </Card>
      ) : evals.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-lg font-bold text-primary-900">Sin evaluaciones en el rango</p>
            <p className="text-sm text-slate-500">Ajusta los filtros o apertura una evaluación con el botón superior.</p>
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
                  <th className="px-4 py-3">Estado</th>
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
                    <td className="px-4 py-3">
                      <Badge color={COLOR_ESTADO[ev.estado]}>{ETIQUETA_ESTADO[ev.estado]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Puntaje value={ev.puntuacion} />
                        {ev.puntuacion != null ? (
                          <Badge color={ev.puntuacion >= 80 ? 2 : ev.puntuacion >= 60 ? 3 : 4}>
                            {ev.puntuacion >= 80 ? 'Cumple' : ev.puntuacion >= 60 ? 'Riesgo' : 'No cumple'}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {esLider && ev.estado === 'PROGRAMADA' && ev.fecha <= hoy ? (
                          <Button variant="primary" className="min-h-0 gap-1.5 px-3 py-1.5" disabled={gestionando} onClick={() => void abrir(ev)}>
                            <Play className="h-4 w-4" /> Abrir
                          </Button>
                        ) : null}
                        {esLider && ev.estado === 'PROGRAMADA' && ev.fecha > hoy ? (
                          <span className="text-xs font-semibold text-slate-400">
                            Se abre el {new Date(`${ev.fecha}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                          </span>
                        ) : null}
                        {esLider && ev.estado === 'ACTIVA' ? (
                          <>
                            <Link
                              to={`/evaluaciones/${ev.id}/conciliacion`}
                              className="inline-flex min-h-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-primary hover:underline"
                              title="Editar los productos de conciliación ya escaneados"
                            >
                              <Pencil className="h-4 w-4" /> Editar
                            </Link>
                            <Button variant="success" className="min-h-0 gap-1.5 px-3 py-1.5" disabled={gestionando} onClick={() => void cerrar(ev)}>
                              <Lock className="h-4 w-4" /> Cerrar
                            </Button>
                          </>
                        ) : null}
                        <Link
                          to={`/evaluaciones/${ev.id}`}
                          className="inline-flex min-h-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                          <Eye className="h-4 w-4" /> Ver
                        </Link>
                        <Button
                          variant="secondary"
                          className="min-h-0 gap-1.5 px-3 py-1.5"
                          disabled={descargando === ev.id}
                          onClick={() => void descargar(ev)}
                        >
                          {descargando === ev.id ? <Spinner size={16} /> : <FileDown className="h-4 w-4" />}
                          {descargando === ev.id ? 'Generando…' : 'PDF'}
                        </Button>
                        {esLider ? (
                          <button
                            onClick={() => setAEliminar(ev)}
                            className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"
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
        texto={`¿Eliminar la evaluación de ${aEliminar?.sucursal?.nombre ?? 'esta sucursal'} (${new Date(`${aEliminar?.fecha}T12:00:00`).toLocaleDateString('es')})? Se borrarán sus respuestas y fotografías.`}
        onConfirm={() => void eliminar()}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  )
}
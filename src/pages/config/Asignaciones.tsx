import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listarUsuarios, listarAsignacionasAdmin, asignarEvaluador, desasignarEvaluador } from '../../lib/data/usuarios'
import { listarSucursalesAdmin } from '../../lib/data/catalog'
import type { Profile, Sucursal } from '../../lib/types'
import { Spinner, cn } from '../../components/ui'
import { useTituloVista } from '../../components/layouts/tituloVista'

export function AsignacionesPage() {
  const [params] = useSearchParams()
  const [evaluadores, setEvaluadores] = useState<Profile[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [asignadas, setAsignadas] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [filtro, setFiltro] = useState('*')
  const preseleccion = params.get('evaluador') ?? ''

  useTituloVista('Asignaciones', 'Asigna sucursales a evaluadores (evidencias del flujo móvil)')

  const cargar = useCallback(async () => {
    const [users, suc] = await Promise.all([listarUsuarios(), listarSucursalesAdmin()])
    const evs = users.filter((u) => u.rol === 'EVALUADOR' && u.activo)
    setEvaluadores(evs)
    setSucursales(suc)
    const asig = await listarAsignacionasAdmin()
    const act = new Set(asig.filter((a) => a.activa).map((a) => `${a.evaluador_id}|${a.sucursal_id}`))
    setAsignadas(act)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const activo = useMemo(
    () => evaluadores.find((e) => e.email === preseleccion)?.id ?? filtro,
    [evaluadores, preseleccion, filtro]
  )

  const visibles = activo === '*' ? evaluadores : evaluadores.filter((e) => e.id === activo)

  function seleccionar(v: string) {
    setFiltro(v)
  }

  async function toggle(evaluadorId: string, sucursalId: string) {
    const key = `${evaluadorId}|${sucursalId}`
    setGuardando(true)
    try {
      if (asignadas.has(key)) {
        await desasignarEvaluador(evaluadorId, sucursalId)
        setAsignadas((prev) => { const n = new Set(prev); n.delete(key); return n })
      } else {
        await asignarEvaluador(evaluadorId, sucursalId)
        setAsignadas((prev) => new Set(prev).add(key))
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => seleccionar('*')}
          className={cn('rounded-full px-3 py-1.5 text-xs font-bold', activo === '*' ? 'bg-primary text-white' : 'border border-slate-200 bg-white text-slate-600')}
        >
          Todos
        </button>
        {evaluadores.map((e) => (
          <button
            key={e.id}
            onClick={() => seleccionar(e.id)}
            className={cn('rounded-full px-3 py-1.5 text-xs font-bold', activo === e.id ? 'bg-primary text-white' : 'border border-slate-200 bg-white text-slate-600')}
          >
            {e.nombre || e.email}
          </button>
        ))}
      </div>

      {cargando ? <div className="flex justify-center py-16"><Spinner /></div> : !evaluadores.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">
          No hay evaluadores activos. Crea usuarios con rol EVALUADOR primero.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibles.map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-3 font-bold text-primary-900">{e.nombre || e.email}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sucursales.map((s) => {
                  const activa = asignadas.has(`${e.id}|${s.id}`)
                  return (
                    <button
                      key={s.id}
                      disabled={guardando}
                      onClick={() => void toggle(e.id, s.id)}
                      className={cn(
                        'rounded-xl border-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors disabled:opacity-50',
                        activa ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-primary'
                      )}
                    >
                      {s.nombre}
                      <span className="mt-0.5 block text-[10px] opacity-70">{activa ? 'Asignada ✓' : 'Sin asignar'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
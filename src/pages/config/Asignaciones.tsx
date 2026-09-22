import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listarUsuarios, listarAsignacionesModulosAdmin, asignarModulo, desasignarModulo } from '../../lib/data/usuarios'
import { listarModulosAdmin } from '../../lib/data/catalog'
import type { Profile, Modulo } from '../../lib/types'
import { Spinner, cn } from '../../components/ui'

export function AsignacionesPage() {
  const [params] = useSearchParams()
  const [evaluadores, setEvaluadores] = useState<Profile[]>([])
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [asignados, setAsignados] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('*')
  const preseleccion = params.get('evaluador') ?? ''

  const cargar = useCallback(async () => {
    const [users, mods] = await Promise.all([listarUsuarios(), listarModulosAdmin()])
    const evs = users.filter((u) => u.rol === 'EVALUADOR' && u.activo)
    setEvaluadores(evs)
    setModulos(mods)
    const asig = await listarAsignacionesModulosAdmin()
    setAsignados(new Set(asig.filter((a) => a.activa).map((a) => `${a.evaluador_id}|${a.modulo_id}`)))
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

  const duenos = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string }>()
    for (const k of asignados) {
      const [eid, mid] = k.split('|')
      const ev = evaluadores.find((x) => x.id === eid)
      if (!m.has(mid)) m.set(mid, { id: eid, nombre: ev?.nombre || ev?.email || 'Otro evaluador' })
    }
    return m
  }, [asignados, evaluadores])

  function seleccionar(v: string) {
    setFiltro(v)
  }

  async function toggle(evaluadorId: string, moduloId: string) {
    const key = `${evaluadorId}|${moduloId}`
    const activo = asignados.has(key)
    setGuardando(key)
    try {
      if (activo) await desasignarModulo(evaluadorId, moduloId)
      else await asignarModulo(evaluadorId, moduloId)
      setAsignados((prev) => {
        const n = new Set(prev)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
    } finally {
      setGuardando(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-primary-900">Asignación de módulos</h2>
        <p className="text-sm text-slate-500">
          Cada módulo lo evalúa un único evaluador. Las sucursales no se restringen: todos evalúan todas.
        </p>
      </div>

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
              {modulos.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {modulos.map((m) => {
                    const key = `${e.id}|${m.id}`
                    const activo = asignados.has(key)
                    const dueno = duenos.get(m.id)
                    const ajeno = dueno !== undefined && dueno.id !== e.id
                    return (
                      <button
                        key={m.id}
                        disabled={guardando === key || ajeno}
                        onClick={() => void toggle(e.id, m.id)}
                        title={ajeno ? `Asignado a ${dueno.nombre}` : undefined}
                        className={cn(
                          'truncate rounded-xl border-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors disabled:opacity-50',
                          activo
                            ? 'border-primary bg-primary text-white'
                            : ajeno
                              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-primary'
                        )}
                      >
                        {m.nombre}
                        <span className="mt-0.5 block text-[10px] opacity-70">
                          {activo ? 'Asignado' : ajeno ? `Otra persona · ${dueno.nombre}` : 'Sin asignar'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-400">No hay módulos creados.</p>
              )}
              <p className="mt-4 rounded-xl bg-primary-50 px-3 py-2 text-[11px] leading-relaxed text-primary-700">
                Regla de negocio: un módulo solo puede estar asignado a un evaluador a la vez. Si un evaluador no tiene módulos, no evaluará este módulo.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}